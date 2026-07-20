/**
 * KimiBridge — `BridgeBackend` implementation for the Kimi Code ACP backend.
 *
 * Encapsulates every kimi-protocol-specific quirk so `WsBridge` can stay
 * backend-agnostic. The bridge sees only the `BridgeBackend` interface;
 * everything in this file is internal to the kimi integration.
 *
 * What this class owns:
 *
 *   - **Adapter event wiring** — translate the adapter's `PneumaMessage`
 *     events (assistant text/thinking + tool_use, tool_result) into the
 *     `assistant` envelope the chat panel renders. Both assistant output and
 *     tool results ride the SAME `assistant` envelope so the chat panel
 *     pairs `tool_use` / `tool_result` blocks via `tool_use_id`.
 *
 *   - **Real turn lifecycle** — ACP's `session/prompt` resolves at end of
 *     turn with a real `stopReason`, so the `result` envelope is driven by
 *     that signal (`onTurnEnded`), not synthesized from message-shape
 *     heuristics. Streaming deltas (`onStreamDelta`) become
 *     `stream_event:content_block_delta` for live typing feedback; the
 *     `stream_event:message_start` fired on every outbound prompt keeps the
 *     thinking indicator alive before the first token lands.
 *
 *   - **Permission round trip** — ACP's `session/request_permission` blocks
 *     the turn until answered. The adapter surfaces it; we track it in
 *     `session.pendingPermissions`, broadcast `permission_request` (rendered
 *     generically by `PermissionBanner`), and route the browser's
 *     `permission_response` back through `adapter.respondPermission`.
 *
 *   - **Model switching** — the model list arrives with session setup
 *     (`onModels` → `available_models` + current model); browser `set_model`
 *     routes to ACP `session/set_model`.
 *
 *   - **Interrupt** — Stop button → ACP `session/cancel` notification. The
 *     in-flight `session/prompt` then resolves with
 *     `stopReason: "cancelled"`, which lands as a normal turn end — no
 *     synthesized idle transition needed.
 */

import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  ContentBlock,
} from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";
import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import type { PneumaMessage } from "../backends/kimi-cli/protocol.js";
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";
import type { BridgeBackend, BridgeBackendDeps, RouteResult } from "./ws-bridge-backend.js";
import { stampFileRefs } from "./file-ref.js";

/**
 * Browser-outgoing message types kimi explicitly doesn't support. These are
 * dropped (with a debug log) instead of being routed to the adapter — ACP has
 * no verbs for session-lifecycle control or environment mutation. The
 * frontend gates the corresponding UI on `agent_capabilities`; without
 * explicit-drop they would silently grow `session.pendingMessages` forever.
 */
const KIMI_UNSUPPORTED_MESSAGE_TYPES = new Set<BrowserOutgoingMessage["type"]>([
  "end_session",
  "update_environment_variables",
  "stop_task",
]);

/** Minimum interval between `tool_progress` broadcasts per tool call. */
const TOOL_PROGRESS_THROTTLE_MS = 1_000;

export class KimiBridge implements BridgeBackend {
  readonly backendType = "kimi-cli" as const;

  /**
   * Tracks when the current kimi turn started — used for the `result`
   * envelope's `duration_ms`. `null` between turns; set when a prompt is
   * forwarded; reset on turn end.
   */
  private turnStartedAt: number | null = null;

  /** Per-toolCallId progress bookkeeping (start + last broadcast time). */
  private toolProgress = new Map<string, { startedAt: number; lastBroadcastAt: number }>();

  private msgCounter = 0;

  constructor(
    private readonly sessionId: string,
    private readonly session: Session,
    private readonly adapter: KimiAdapter,
    private readonly deps: BridgeBackendDeps,
  ) {}

  attach(): void {
    this.adapter.onMessage((pneuma) => this.onAdapterMessage(pneuma));

    this.adapter.onStreamDelta(({ deltaType, text }) => {
      this.deps.broadcastToBrowsers(this.session, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: deltaType === "thinking"
            ? { type: "thinking_delta", thinking: text }
            : { type: "text_delta", text },
        },
        parent_tool_use_id: null,
      });
    });

    this.adapter.onSessionId((acpSessionId) => {
      this.deps.onAgentSessionId?.(this.sessionId, acpSessionId);
    });

    this.adapter.onTurnEnded(({ stopReason, isError }) => this.onTurnEnded(stopReason, isError));

    this.adapter.onPermissionRequest((req) => {
      const request = {
        request_id: req.requestId,
        tool_name: req.toolName,
        input: {},
        description: req.description || undefined,
        tool_use_id: req.toolUseId,
        timestamp: Date.now(),
      };
      this.session.pendingPermissions.set(req.requestId, request);
      this.deps.broadcastToBrowsers(this.session, { type: "permission_request", request });
    });

    this.adapter.onPermissionCancelled((requestId) => {
      if (!this.session.pendingPermissions.delete(requestId)) return;
      this.deps.broadcastToBrowsers(this.session, {
        type: "permission_cancelled",
        request_id: requestId,
      });
    });

    this.adapter.onModels(({ current, available }) => {
      this.session.state.model = current;
      this.session.state.available_models = available;
      this.broadcastSessionUpdate();
    });

    this.adapter.onCommands((commands) => {
      this.session.state.slash_commands = commands.map((c) => c.name);
      this.broadcastSessionUpdate();
    });

    this.adapter.onMeta(({ agentVersion }) => {
      this.session.state.agent_version = agentVersion;
      this.broadcastSessionUpdate();
    });

    this.adapter.onToolProgress(({ toolCallId, toolName }) => {
      const now = Date.now();
      let entry = this.toolProgress.get(toolCallId);
      if (!entry) {
        entry = { startedAt: now, lastBroadcastAt: 0 };
        this.toolProgress.set(toolCallId, entry);
      }
      if (now - entry.lastBroadcastAt < TOOL_PROGRESS_THROTTLE_MS) return;
      entry.lastBroadcastAt = now;
      this.deps.broadcastToBrowsers(this.session, {
        type: "tool_progress",
        tool_use_id: toolCallId,
        tool_name: toolName,
        elapsed_time_seconds: Math.round((now - entry.startedAt) / 1000),
      });
    });

    this.adapter.onError((message) => {
      this.deps.broadcastToBrowsers(this.session, { type: "error", message });
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

    // ACP delivers model / version / commands asynchronously (session setup),
    // so seed placeholder state and broadcast a `session_init` now — the
    // subsequent `session_update`s fill in the real values.
    if (!this.session.state.model) this.session.state.model = "kimi";
    if (!this.session.state.agent_version) this.session.state.agent_version = "kimi-code";
    this.deps.broadcastToBrowsers(this.session, { type: "cli_connected" });
    this.deps.broadcastToBrowsers(this.session, {
      type: "session_init",
      session: { ...this.session.state, cli_busy: !this.session.cliIdle },
    });

    // Flush user messages queued before the adapter was ready.
    if (this.session.pendingMessages.length > 0) {
      console.log(
        `[ws-bridge] Flushing ${this.session.pendingMessages.length} queued message(s) via Kimi adapter for session ${this.sessionId}`,
      );
      const queued = this.session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        try {
          const parsed: unknown = JSON.parse(ndjson);
          let content: string | null = null;
          if (
            parsed
            && typeof parsed === "object"
            && (parsed as { type?: unknown }).type === "user"
            && typeof (parsed as { message?: { content?: unknown } }).message?.content === "string"
          ) {
            content = (parsed as { message: { content: string } }).message.content;
          } else if (
            parsed
            && typeof parsed === "object"
            && (parsed as { type?: unknown }).type === "user_message"
            && typeof (parsed as { content?: unknown }).content === "string"
          ) {
            content = (parsed as { content: string }).content;
          }
          if (content !== null) this.sendToAdapter(content);
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
   * Not recorded in `messageHistory` (matches the existing `injectGreeting`
   * contract: the user never sees the synthetic prompt).
   */
  injectUserMessage(content: string): void {
    this.session.cliIdle = false;
    this.sendToAdapter(content);
  }

  routeBrowserMessage(msg: BrowserOutgoingMessage): RouteResult {
    if (KIMI_UNSUPPORTED_MESSAGE_TYPES.has(msg.type)) {
      console.debug(
        `[ws-bridge] kimi session ${this.sessionId} ignoring unsupported message type "${msg.type}"`,
      );
      return "unsupported";
    }

    switch (msg.type) {
      case "user_message":
        this.handleBrowserUserMessage(msg);
        return "handled";
      case "permission_response": {
        this.adapter.respondPermission(msg.request_id, msg.behavior);
        this.session.pendingPermissions.delete(msg.request_id);
        return "handled";
      }
      case "set_model": {
        // Optimistic update; ACP's `session/set_model` persists the choice
        // for the session (verified: survives resume).
        const previous = this.session.state.model;
        this.session.state.model = msg.model;
        this.broadcastSessionUpdate();
        this.adapter.setModel(msg.model).catch((err) => {
          console.error(`[ws-bridge] kimi set_model failed for session ${this.sessionId}:`, err);
          this.session.state.model = previous;
          this.broadcastSessionUpdate();
          this.deps.broadcastToBrowsers(this.session, {
            type: "error",
            message: `Failed to switch model to ${msg.model}: ${err instanceof Error ? err.message : err}`,
          });
        });
        return "handled";
      }
      case "interrupt":
        // ACP `session/cancel` notification. The in-flight `session/prompt`
        // resolves with `stopReason: "cancelled"` → normal turn-end path
        // (result envelope + idle snapshot). Pending permission requests are
        // answered `cancelled` by the adapter and cleared here via
        // `onPermissionCancelled`.
        this.adapter.interrupt();
        return "handled";
      default:
        // Bridge-internal types (viewer_action_response, viewer_notification,
        // session_subscribe, session_ack) — fall through so WsBridge handles
        // them via its own helpers.
        return "passthrough";
    }
  }

  async disconnect(): Promise<void> {
    return this.adapter.disconnect();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private broadcastSessionUpdate(): void {
    this.deps.broadcastToBrowsers(this.session, {
      type: "session_update",
      session: { ...this.session.state, cli_busy: !this.session.cliIdle },
    });
  }

  /**
   * Route a browser-originated user message through the agent: ingest any
   * uploaded files / images through the bridge's shared prepare step
   * (saves to `.pneuma/uploads/`, drains queued env tags, pushes history,
   * builds the `<uploaded-files>` notification), then flip cliIdle and
   * queue the ACP prompt. Kimi Code declares `promptCapabilities.image`,
   * so in-budget images ride the prompt array as ACP image content blocks;
   * oversized ones still land on disk and are referenced by path.
   */
  private handleBrowserUserMessage(msg: {
    type: "user_message";
    content: string;
    images?: { media_type: string; data: string }[];
    files?: { name: string; media_type: string; data: string; size: number }[];
  }): void {
    const { textContent, inlineImages } = this.deps.prepareIncomingUserMessage(
      this.session,
      msg,
      { inlineImagesSupported: true },
    );
    this.session.cliIdle = false;
    this.sendToAdapter(textContent, inlineImages.length > 0 ? inlineImages : undefined);
  }

  /**
   * Forward content to the adapter AND fire the synthetic
   * `stream_event:message_start` so the frontend's thinking indicator
   * activates before the first ACP token arrives. Single chokepoint —
   * every kimi-bound user message (browser, server-injected, queue flush)
   * goes through here.
   */
  private sendToAdapter(content: string, images?: { media_type: string; data: string }[]): void {
    if (this.turnStartedAt === null) this.turnStartedAt = Date.now();
    this.adapter.sendUserMessage(content, images);
    this.deps.broadcastToBrowsers(this.session, {
      type: "stream_event",
      event: { type: "message_start" },
      parent_tool_use_id: null,
    });
  }

  private onAdapterMessage(pneuma: PneumaMessage): void {
    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: `kimi-${this.sessionId}-${Date.now()}-${this.msgCounter++}`,
        type: "message",
        role: "assistant",
        model: this.session.state.model || "kimi",
        content: pneuma.content as ContentBlock[],
        stop_reason: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    };
    if (Array.isArray(assistantMsg.message?.content)) {
      stampFileRefs(assistantMsg.message.content, "kimi-cli", this.deps.workspace);
    }
    this.session.messageHistory.push(assistantMsg);
    this.deps.broadcastToBrowsers(this.session, assistantMsg);
  }

  /**
   * Real end-of-turn signal — `session/prompt` resolved (or failed). Emits
   * the canonical `result` envelope, pushes the idle snapshot, and captures
   * the shadow-git checkpoint.
   */
  private onTurnEnded(stopReason: string, isError: boolean): void {
    const numTurns = (this.session.state.num_turns ?? 0) + 1;
    this.session.state.num_turns = numTurns;
    this.session.cliIdle = true;
    const durationMs = this.turnStartedAt ? Date.now() - this.turnStartedAt : 0;
    this.turnStartedAt = null;
    this.toolProgress.clear();

    const resultMsg: BrowserIncomingMessage = {
      type: "result",
      data: {
        type: "result",
        subtype: isError ? "error_during_execution" : "success",
        is_error: isError,
        duration_ms: durationMs,
        duration_api_ms: durationMs,
        num_turns: numTurns,
        total_cost_usd: 0,
        stop_reason: stopReason,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        uuid: `kimi-result-${Date.now()}-${this.msgCounter++}`,
        session_id: this.sessionId,
      },
    };
    this.session.messageHistory.push(resultMsg);
    this.deps.broadcastToBrowsers(this.session, resultMsg);
    this.broadcastSessionUpdate();

    if (this.deps.workspace && isShadowGitAvailable(this.deps.workspace)) {
      enqueueCheckpoint(this.deps.workspace, numTurns - 1);
    }
  }
}
