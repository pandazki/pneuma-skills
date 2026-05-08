/**
 * KimiBridge — `BridgeBackend` implementation for kimi-cli.
 *
 * Encapsulates every kimi-protocol-specific quirk so `WsBridge` can stay
 * backend-agnostic. The bridge sees only the `BridgeBackend` interface;
 * everything in this file is internal to the kimi integration.
 *
 * What this class owns:
 *
 *   - **Adapter event wiring** — translate kimi's `PneumaMessage` events
 *     (assistant text + tool_use, tool_result echoes) into the `assistant`
 *     envelope the chat panel renders. Both kimi-`assistant` and kimi-`tool`
 *     outputs ride the SAME `assistant` envelope so the chat panel pairs
 *     `tool_use` / `tool_result` blocks via `tool_use_id` (see
 *     `src/components/ChatPanel.tsx:buildGlobalToolUseMap`). Without this
 *     a `<system>...</system>`-style tool_result would render as a giant
 *     prose bubble instead of a compact result card.
 *
 *   - **Synthesised envelopes** — kimi's `--print --output-format stream-json`
 *     never emits `system.init` (model/agent_version), `result` (turn end),
 *     or `stream_event:message_start` (turn start). All three are required
 *     for the frontend's status-pill / activity-indicator state machine to
 *     work. We synthesise them here:
 *       * `session_init` — at attach time, with `model: "kimi"` and capabilities
 *       * `result` — on every turn yield (assistant message whose last
 *         content block isn't `tool_use`)
 *       * `stream_event:message_start` — every time we forward a user
 *         message TO kimi (turn start). The frontend's existing
 *         `case "stream_event"` handling sets `activity={phase:"thinking"}`
 *         which gives the user visible feedback while kimi is reasoning
 *         silently before its first emission. Cleared automatically when
 *         the synthesised `result` lands at turn end.
 *
 *   - **Browser → agent message routing** — kimi-cli has a smaller capability
 *     surface than codex (no permission flow, no runtime model switch, no
 *     session control). Messages it can't handle are explicitly dropped
 *     (returned as `"unsupported"`) so they don't queue indefinitely in
 *     `pendingMessages`. The frontend gates the corresponding UI on
 *     `agent_capabilities`; reaching the unsupported branch usually means
 *     a stale UI element or a buggy synthetic dispatcher.
 *
 *   - **Interrupt** — Stop-button → SIGINT to the kimi process. Kimi's
 *     print-mode signal handler aborts the in-flight step but keeps the
 *     process alive for the next user message; we push a `session_update`
 *     with `cli_busy: false` so the input unlocks immediately rather than
 *     waiting for whatever assistant turn kimi might emit on its way out.
 */

import { randomBytes } from "node:crypto";
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

function shortId(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Browser-outgoing message types kimi explicitly doesn't support. These are
 * dropped (with a debug log) instead of being routed to the adapter — kimi-cli
 * has no JSON-RPC verbs for permission approvals, runtime model switches, or
 * session-lifecycle control. The frontend gates the corresponding UI on
 * `agent_capabilities`, so a message in this set reaching us usually means a
 * stale UI element or a buggy synthetic dispatcher; without explicit-drop they
 * would silently grow `session.pendingMessages` forever.
 */
const KIMI_UNSUPPORTED_MESSAGE_TYPES = new Set<BrowserOutgoingMessage["type"]>([
  "permission_response",
  "set_model",
  "end_session",
  "update_environment_variables",
  "stop_task",
]);

export class KimiBridge implements BridgeBackend {
  readonly backendType = "kimi-cli" as const;

  /** Per-session user-message counter (history id suffix). */
  private userMsgCounter = 0;

  /**
   * Tracks when the current kimi turn started — used for the synthesised
   * `result` envelope's `duration_ms`. `null` between turns; set on the
   * first message of a turn (whether forwarded from browser or fired by
   * kimi's adapter). Reset on turn yield.
   */
  private turnStartedAt: number | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly session: Session,
    private readonly adapter: KimiAdapter,
    private readonly deps: BridgeBackendDeps,
  ) {}

  attach(): void {
    this.adapter.onMessage((pneuma) => this.onAdapterMessage(pneuma));
    this.adapter.onSessionId((kimiSessionId) => {
      this.deps.onAgentSessionId?.(this.sessionId, kimiSessionId);
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

    // Kimi-cli's stream-json doesn't include a `system.init` envelope, so
    // the browser would otherwise see "no model" forever. Seed the
    // session-state shape and broadcast it as a `session_init`.
    if (!this.session.state.model) this.session.state.model = "kimi";
    if (!this.session.state.agent_version) this.session.state.agent_version = "kimi-cli";
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
      case "interrupt":
        // SIGINT the kimi process — its print-mode signal handler aborts
        // the in-flight step but keeps the process alive for the next user
        // message. The bridge's broadcast machinery doesn't synthesise a
        // `result` envelope on its own, so we'd otherwise leave the
        // frontend stuck on "Running"; push an idle snapshot so the input
        // unlocks immediately.
        this.adapter.interrupt();
        this.session.cliIdle = true;
        this.deps.broadcastToBrowsers(this.session, {
          type: "session_update",
          session: { ...this.session.state, cli_busy: false },
        });
        this.deps.broadcastToBrowsers(this.session, { type: "status_change", status: "idle" });
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

  /**
   * Route a browser-originated user message through the agent: record in
   * history, flip cliIdle, write to kimi stdin, light up the thinking
   * indicator. Kimi-cli is text-only today (no inline image/file blocks),
   * so attachments would require a separate uploads-on-disk + notification
   * path — out of scope until the backend grows multimodal support.
   */
  private handleBrowserUserMessage(msg: { type: "user_message"; content: string }): void {
    const ts = Date.now();
    this.session.messageHistory.push({
      type: "user_message",
      content: msg.content,
      timestamp: ts,
      id: `user-${ts}-${this.userMsgCounter++}`,
    });
    this.session.cliIdle = false;
    this.sendToAdapter(msg.content);
  }

  /**
   * Forward content to kimi stdin AND fire the synthetic
   * `stream_event:message_start` so the frontend's thinking indicator
   * activates. Single chokepoint — every kimi-bound user message (browser,
   * server-injected, queue flush) goes through here.
   */
  private sendToAdapter(content: string): void {
    this.adapter.sendUserMessage(content);
    this.deps.broadcastToBrowsers(this.session, {
      type: "stream_event",
      event: { type: "message_start" },
      parent_tool_use_id: null,
    });
  }

  private onAdapterMessage(pneuma: PneumaMessage): void {
    if (this.turnStartedAt === null) this.turnStartedAt = Date.now();

    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: `kimi-${this.sessionId}-${Date.now()}-${shortId()}`,
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
    this.session.messageHistory.push(assistantMsg);
    this.deps.broadcastToBrowsers(this.session, assistantMsg);

    // Idle bookkeeping — a turn yields when:
    //   1. the message originated from kimi's `assistant` role (NOT a tool_result), AND
    //   2. its last content block isn't `tool_use` (kimi will call another tool next).
    const lastBlock = pneuma.content[pneuma.content.length - 1];
    const isToolResultMsg = pneuma.type === "user";
    const lastIsToolUse = !!lastBlock && lastBlock.type === "tool_use";
    const yielded = !isToolResultMsg && !lastIsToolUse;

    if (!yielded) {
      this.session.cliIdle = false;
      this.deps.broadcastToBrowsers(this.session, {
        type: "session_update",
        session: { ...this.session.state, cli_busy: true },
      });
      return;
    }

    // Turn yielded — tally num_turns, fire the synthesised `result` envelope
    // (the canonical end-of-turn signal — see `case "result"` in `src/ws.ts`),
    // then push the idle session snapshot.
    const numTurns = (this.session.state.num_turns ?? 0) + 1;
    this.session.state.num_turns = numTurns;
    this.session.cliIdle = true;
    const durationMs = this.turnStartedAt ? Date.now() - this.turnStartedAt : 0;
    this.turnStartedAt = null;

    const resultMsg: BrowserIncomingMessage = {
      type: "result",
      data: {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: durationMs,
        duration_api_ms: durationMs,
        num_turns: numTurns,
        total_cost_usd: 0,
        stop_reason: "end_turn",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        uuid: `kimi-result-${Date.now()}-${shortId()}`,
        session_id: this.sessionId,
      },
    };
    this.session.messageHistory.push(resultMsg);
    this.deps.broadcastToBrowsers(this.session, resultMsg);
    this.deps.broadcastToBrowsers(this.session, {
      type: "session_update",
      session: { ...this.session.state, cli_busy: false },
    });

    if (this.deps.workspace && isShadowGitAvailable(this.deps.workspace)) {
      enqueueCheckpoint(this.deps.workspace, numTurns - 1);
    }
  }
}
