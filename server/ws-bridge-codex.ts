/**
 * CodexBridge — `BridgeBackend` implementation for OpenAI Codex.
 *
 * Codex's adapter (`CodexAdapter`) speaks Codex JSON-RPC and translates events
 * into the standard `BrowserIncomingMessage` shape on its own — most of this
 * file is just plumbing: forward adapter events to browsers, record assistant
 * / result entries in `messageHistory`, track permission requests. Compared
 * to `KimiBridge`, very little envelope synthesis is needed because Codex's
 * adapter already emits `session_init` / `session_update` / `result` / etc.
 */

import type {
  BrowserOutgoingMessage,
  SessionState,
} from "./session-types.js";
import type { CodexAdapter } from "../backends/codex/codex-adapter.js";
import type { Session } from "./ws-bridge-types.js";
import { enqueueCheckpoint, isShadowGitAvailable, nextTurnIndex } from "./shadow-git.js";
import type { BridgeBackend, BridgeBackendDeps, RouteResult } from "./ws-bridge-backend.js";
import { stampFileRefs } from "./file-ref.js";

export class CodexBridge implements BridgeBackend {
  readonly backendType = "codex" as const;

  constructor(
    private readonly sessionId: string,
    private readonly session: Session,
    private readonly adapter: CodexAdapter,
    private readonly deps: BridgeBackendDeps,
  ) {}

  attach(): void {
    this.adapter.onBrowserMessage((msg) => this.onAdapterMessage(msg));

    this.adapter.onSessionMeta((meta) => {
      if (meta.cliSessionId) {
        this.deps.onAgentSessionId?.(this.sessionId, meta.cliSessionId);
      }
    });

    this.adapter.onDisconnect(() => {
      this.deps.broadcastToBrowsers(this.session, { type: "cli_disconnected" });
      for (const [reqId] of this.session.pendingPermissions) {
        this.deps.broadcastToBrowsers(this.session, {
          type: "permission_cancelled",
          request_id: reqId,
        });
      }
      this.session.pendingPermissions.clear();
    });

    this.deps.broadcastToBrowsers(this.session, { type: "cli_connected" });

    // Flush any user messages queued before the adapter was ready — pass each
    // straight through `sendBrowserMessage` (codex accepts the same envelope
    // shape browsers send).
    if (this.session.pendingMessages.length > 0) {
      console.log(
        `[ws-bridge] Flushing ${this.session.pendingMessages.length} queued message(s) via Codex adapter for session ${this.sessionId}`,
      );
      const queued = this.session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        try {
          const parsed = JSON.parse(ndjson) as BrowserOutgoingMessage;
          this.adapter.sendBrowserMessage(parsed);
        } catch (err) {
          console.error(
            `[ws-bridge] Failed to parse/send queued message for session ${this.sessionId}:`,
            err,
          );
        }
      }
    }
  }

  /**
   * Server-injected user message — greeting, env tag, handoff cancel notice.
   * Not recorded in history (matches `injectGreeting`'s contract: synthetic
   * prompts never appear in the user-visible chat).
   */
  injectUserMessage(content: string): void {
    this.session.cliIdle = false;
    this.adapter.sendBrowserMessage({ type: "user_message", content });
  }

  routeBrowserMessage(msg: BrowserOutgoingMessage): RouteResult {
    switch (msg.type) {
      case "user_message":
        this.handleBrowserUserMessage(msg);
        return "handled";
      case "permission_response":
        this.adapter.sendBrowserMessage(msg);
        this.session.pendingPermissions.delete(msg.request_id);
        return "handled";
      case "interrupt":
        this.adapter.sendBrowserMessage(msg);
        return "handled";
      case "set_model":
        this.adapter.sendBrowserMessage(msg);
        this.session.state.model = (msg as { model: string }).model;
        return "handled";
      default:
        // Bridge-internal types (viewer_action_response, viewer_notification,
        // session_subscribe, session_ack, end_session, stop_task,
        // update_environment_variables) — fall through to WsBridge.
        return "passthrough";
    }
  }

  async disconnect(): Promise<void> {
    return this.adapter.disconnect();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private handleBrowserUserMessage(msg: {
    type: "user_message";
    content: string;
    session_id?: string;
    images?: { media_type: string; data: string }[];
    files?: { name: string; media_type: string; data: string; size: number }[];
  }): void {
    // Funnel uploads + env-context drain + history push through the bridge's
    // shared ingest path. Codex's adapter packs inline images as data URLs,
    // so we declare inline support; oversized images still land on disk and
    // get path-only references in the upload notification.
    const { textContent, inlineImages } = this.deps.prepareIncomingUserMessage(
      this.session,
      msg,
      { inlineImagesSupported: true },
    );
    this.session.cliIdle = false;
    this.adapter.sendBrowserMessage({
      type: "user_message",
      content: textContent,
      images: inlineImages.length > 0 ? inlineImages : undefined,
    });
  }

  private onAdapterMessage(msg: Parameters<Parameters<CodexAdapter["onBrowserMessage"]>[0]>[0]): void {
    // Update session state for init/update messages. The adapter's partial
    // session is merged with the bridge's full state (which includes
    // `agent_capabilities` etc.) — then broadcast the merged state.
    if (msg.type === "session_init") {
      this.session.state = { ...this.session.state, ...msg.session, backend_type: "codex" } as SessionState;
      this.deps.broadcastToBrowsers(this.session, {
        type: "session_init",
        session: { ...this.session.state, cli_busy: !this.session.cliIdle },
      });
      return;
    } else if (msg.type === "session_update") {
      this.session.state = { ...this.session.state, ...msg.session, backend_type: "codex" } as SessionState;
      this.deps.broadcastToBrowsers(this.session, {
        type: "session_update",
        session: { ...this.session.state, cli_busy: !this.session.cliIdle },
      });
      return;
    } else if (msg.type === "status_change") {
      this.session.state.is_compacting = msg.status === "compacting";
      this.session.cliIdle = msg.status === "idle";
    }

    // Track message history for replay.
    if (msg.type === "assistant") {
      if (Array.isArray(msg.message?.content)) {
        stampFileRefs(msg.message.content, "codex", this.deps.workspace);
      }
      const assistantMsg = { ...msg, timestamp: msg.timestamp || Date.now() };
      // Replace any prior entry with the same id (codex deltas resolve to a
      // final message; we keep just the final).
      const msgId = (msg as { message?: { id?: string } }).message?.id;
      let existingIdx = -1;
      for (let i = this.session.messageHistory.length - 1; i >= 0; i--) {
        const h = this.session.messageHistory[i];
        if (h.type === "assistant" && (h as { message?: { id?: string } }).message?.id === msgId) {
          existingIdx = i;
          break;
        }
      }
      if (existingIdx !== -1) {
        this.session.messageHistory[existingIdx] = assistantMsg;
      } else {
        this.session.messageHistory.push(assistantMsg);
      }
    } else if (msg.type === "result") {
      this.session.messageHistory.push(msg);
      if (this.deps.workspace && isShadowGitAvailable(this.deps.workspace)) {
        enqueueCheckpoint(this.deps.workspace, nextTurnIndex(this.deps.workspace));
      }
    }

    // Track permission requests so we can render the prompt UI.
    if (msg.type === "permission_request") {
      this.session.pendingPermissions.set(msg.request.request_id, msg.request);
    }

    this.deps.broadcastToBrowsers(this.session, msg);
  }
}
