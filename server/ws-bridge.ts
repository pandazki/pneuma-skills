import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";
import { setBridgeSocket, handleBridgeResult } from "./native-bridge.js";
import type { ServerWebSocket } from "bun";
import type {
  CLIMessage,
  CLISystemMessage,
  CLIAssistantMessage,
  CLIResultMessage,
  CLIStreamEventMessage,
  CLIToolProgressMessage,
  CLIToolUseSummaryMessage,
  CLIControlRequestMessage,
  CLIAuthStatusMessage,
  CLIUserMessage,
  CLIControlCancelRequestMessage,
  CLIStreamlinedTextMessage,
  CLIStreamlinedToolUseSummaryMessage,
  CLIPromptSuggestionMessage,
  BrowserOutgoingMessage,
  BrowserIncomingMessage,
  PermissionRequest,
} from "./session-types.js";
import type {
  CLITransport,
  Session,
  SocketData,
  CLISocketData,
  BrowserSocketData,
} from "./ws-bridge-types.js";
import { makeDefaultState } from "./ws-bridge-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getBackendCapabilities } from "../backends/index.js";
import { isPneumaMarkerOnly } from "../core/utils/pneuma-markers.js";
export type { SocketData } from "./ws-bridge-types.js";
import {
  isDuplicateClientMessage,
  rememberClientMessage,
  isHistoryBackedEvent,
  sequenceEvent,
} from "./ws-bridge-replay.js";
import {
  handleInterrupt,
  handleControlResponse,
} from "./ws-bridge-controls.js";
import {
  handleSessionSubscribe,
  handleSessionAck,
  handlePermissionResponse,
} from "./ws-bridge-browser.js";
import { handleViewerActionResponse } from "./ws-bridge-viewer.js";
import { stampFileRefs } from "./file-ref.js";
import type { CodexAdapter } from "../backends/codex/codex-adapter.js";
import { CodexBridge } from "./ws-bridge-codex.js";
import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import { KimiBridge } from "./ws-bridge-kimi.js";
import type { BridgeBackend, BridgeBackendDeps } from "./ws-bridge-backend.js";

// ─── Bridge ───────────────────────────────────────────────────────────────────

export class WsBridge {
  private static readonly EVENT_BUFFER_LIMIT = 600;
  private static readonly PROCESSED_CLIENT_MSG_ID_LIMIT = 1000;
  private static readonly IDEMPOTENT_BROWSER_MESSAGE_TYPES = new Set<string>([
    "user_message",
    "permission_response",
    "interrupt",
  ]);
  private sessions = new Map<string, Session>();
  /**
   * Per-session bridge backend handlers — currently codex and kimi-cli;
   * Claude Code uses the legacy CLI-WebSocket path instead. Replaces the
   * earlier per-backend `Map`s + inline `if (backendType === "...")` branches.
   * `BridgeBackend` defines the lifecycle interface every non-Claude backend
   * implements; see `ws-bridge-backend.ts` for the contract and the rationale.
   */
  private streamingBackends = new Map<string, BridgeBackend>();
  private onCLISessionId: ((sessionId: string, cliSessionId: string) => void) | null = null;
  private userMsgCounter = 0;
  private workspace = "";
  private imageCounter = 0;
  private fileCounter = 0;

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  /**
   * Build the cross-cutting deps every `BridgeBackend` needs. Public so the
   * CLI launcher (`bin/pneuma.ts`) can hand them to
   * `BackendModule.createBridgeBackend()` — the polymorphic path that replaced
   * the per-backend `attach*Adapter` switches. Cheap to call per-attach;
   * closes over the bridge instance so per-backend handlers don't have to
   * know about the bridge's internals.
   */
  bridgeBackendDeps(): BridgeBackendDeps {
    return {
      broadcastToBrowsers: (s, msg) => this.broadcastToBrowsers(s, msg),
      workspace: this.workspace,
      onAgentSessionId: (sessionId, agentSessionId) => {
        if (this.onCLISessionId) this.onCLISessionId(sessionId, agentSessionId);
      },
      getOrCreateSession: (sessionId, backendType) =>
        this.getOrCreateSession(sessionId, backendType),
      prepareIncomingUserMessage: (session, msg, opts) =>
        this.prepareIncomingUserMessage(session, msg, opts),
    };
  }

  /**
   * Polymorphic attach for any `BridgeBackend` (codex, kimi-cli, …). Built
   * by `BackendModule.createBridgeBackend()` and handed in here so the bridge
   * never has to ask "which backend is this?" — the only place left that
   * does per-backend wiring is the manifest itself.
   *
   * The legacy `attachCodexAdapter` / `attachKimiAdapter` helpers below are
   * thin wrappers that build the bridge inline; they're retained for tests
   * (`server/__tests__/ws-bridge-{codex,kimi}.test.ts`) that want to attach
   * a fake adapter without standing up the whole `BackendModule`.
   */
  attachStreamingBackend(sessionId: string, bridgeBackend: BridgeBackend): void {
    this.streamingBackends.set(sessionId, bridgeBackend);
    bridgeBackend.attach();
  }

  /**
   * Attach a Codex adapter — wraps it in a `CodexBridge` and registers it as
   * the active streaming backend for the session. Test-friendly entry point
   * that bypasses `BackendModule.createBridgeBackend()`.
   */
  attachCodexAdapter(sessionId: string, adapter: CodexAdapter): void {
    const session = this.getOrCreateSession(sessionId, "codex");
    const bridge = new CodexBridge(sessionId, session, adapter, this.bridgeBackendDeps());
    this.attachStreamingBackend(sessionId, bridge);
  }

  /**
   * Attach a Kimi adapter — wraps it in a `KimiBridge` and registers it as
   * the active streaming backend for the session. Test-friendly entry point
   * that bypasses `BackendModule.createBridgeBackend()`.
   */
  attachKimiAdapter(sessionId: string, adapter: KimiAdapter): void {
    const session = this.getOrCreateSession(sessionId, "kimi-cli");
    const bridge = new KimiBridge(sessionId, session, adapter, this.bridgeBackendDeps());
    this.attachStreamingBackend(sessionId, bridge);
  }

  /** Backwards-compat predicates kept for the few callers that gate on backend identity. */
  isCodexSession(sessionId: string): boolean {
    return this.streamingBackends.get(sessionId)?.backendType === "codex";
  }
  isKimiSession(sessionId: string): boolean {
    return this.streamingBackends.get(sessionId)?.backendType === "kimi-cli";
  }

  /**
   * Send a greeting message to the CLI without recording it in messageHistory.
   * The user never sees the prompt — only the agent's response appears in chat.
   */
  injectGreeting(sessionId: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.cliIdle = false;

    const backend = this.streamingBackends.get(sessionId);
    if (backend) {
      backend.injectUserMessage(content);
      return;
    }

    const ndjson = JSON.stringify({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: session.state.session_id || "",
    });
    this.sendToCLI(session, ndjson);
  }

  /** Register a callback for when we learn the CLI's internal session ID. */
  onCLISessionIdReceived(cb: (sessionId: string, cliSessionId: string) => void): void {
    this.onCLISessionId = cb;
  }

  /**
   * Inject a synthetic user message into a session. Used by server-side
   * code paths (handoff cancel, session-start `<pneuma:env>` tags, etc.)
   * to dispatch chat-tag signals to the agent the same way a real browser
   * `user_message` would — recorded in history, broadcast to browsers,
   * delivered to the CLI / Codex transport.
   *
   * Plain text only — images/files would only confuse a synthesized signal
   * and the existing `handleUserMessage` path is the one to use for those.
   */
  sendUserMessage(sessionId: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    const backend = this.streamingBackends.get(sessionId);
    if (backend) {
      backend.routeBrowserMessage({ type: "user_message", content });
    } else {
      this.handleUserMessage(session, { type: "user_message", content });
    }
    // The browser-originated path doesn't broadcast (the originating tab
    // already rendered the message optimistically), but a server-injected
    // tag has no optimistic source — we have to push it explicitly.
    this.broadcastToBrowsers(session, {
      type: "user_message",
      content,
      timestamp: Date.now(),
    });
  }

  /** Push a message to all connected browsers for a session. */
  broadcastToSession(sessionId: string, msg: BrowserIncomingMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.broadcastToBrowsers(session, msg);
  }

  /**
   * Register a `<pneuma:env>` (or any other system signal) tag.
   *
   * Two modes:
   *
   * **Default (pending)** — the tag:
   *   - lands in `messageHistory` so reload reconstructs the banner
   *   - broadcasts to browsers so the banner renders live
   *   - is buffered on the session, and gets prepended to the CLI-bound
   *     content of the *next* real user message (then discarded)
   *
   *   Right for `reason="opened"` / `reason="resumed"`: the user hasn't
   *   asked for anything yet, so the agent stays idle. When the user
   *   does type, the prepended env tag gives the agent the session-
   *   lineage / locale context it needs to reason about that input.
   *
   * **Immediate (`opts.immediate = true`)** — same history + broadcast
   * but the tag is ALSO delivered to the CLI right now via the same path
   * a real user message would take. The agent processes it immediately
   * and starts work without waiting for further user input.
   *
   *   Right for `reason="handed-off"` / `reason="switched"`: the source
   *   agent already supplied intent / summary / files / transcript via
   *   `inbound-handoff.json` + the `pneuma:handoff` CLAUDE.md block.
   *   The user already approved this handoff (or invoked it from a
   *   slash command). Waiting for them to type "do it" before the
   *   target agent moves is a deadlock — and worse, on Claude Code
   *   it leaves the CLI subprocess sitting on stdin with no input,
   *   so `system.init` never fires and the model picker shows
   *   "no model" indefinitely.
   */
  enqueueEnvContext(sessionId: string, tag: string, opts?: { immediate?: boolean }): void {
    if (opts?.immediate) {
      // Active dispatch — `sendUserMessage` handles history push,
      // CLI delivery (via the same `handleUserMessage` path browser
      // messages use), and the broadcast in one shot. Skip the
      // pending queue entirely.
      this.sendUserMessage(sessionId, tag);
      return;
    }
    const session = this.getOrCreateSession(sessionId);
    const ts = Date.now();
    session.pendingEnvContext.push(tag);
    session.messageHistory.push({
      type: "user_message",
      content: tag,
      timestamp: ts,
      id: `env-${ts}-${this.userMsgCounter++}`,
    });
    this.broadcastToBrowsers(session, {
      type: "user_message",
      content: tag,
      timestamp: ts,
    });
  }

  /**
   * Enqueue a server-originated system tag (e.g. the borrow return-leg's
   * `<pneuma:borrow-returned>`) for delivery to the agent at a turn boundary.
   *
   * Unlike `enqueueEnvContext`, which buffers until the *user* next types, a
   * system signal must reach the agent on its own — but never mid-turn. So:
   *
   *   - **CLI idle** → dispatch now via `sendUserMessage` (history + broadcast
   *     + CLI delivery in one shot). The agent picks it up immediately.
   *   - **CLI busy** → push onto `pendingSystemSignals`; the turn's `result`
   *     message flushes one queued signal (same gate as `pendingNotifications`),
   *     so the host agent A is poked at a safe boundary, not interrupted.
   *
   * This is the non-interruptive poke the borrow round-trip needs (design §6.3):
   * B finishes, the server enqueues the returned tag here, A sees it on its
   * next idle and reads the result artifact.
   */
  enqueueSystemSignal(sessionId: string, tag: string): void {
    const session = this.getOrCreateSession(sessionId);
    if (session.cliIdle) {
      this.sendUserMessage(sessionId, tag);
      return;
    }
    if (!session.pendingSystemSignals) session.pendingSystemSignals = [];
    session.pendingSystemSignals.push(tag);
    console.log(
      `[ws-bridge] System signal queued (CLI busy): ${session.pendingSystemSignals.length} in queue`,
    );
  }

  /**
   * Push a message to every connected browser across all sessions. Used by
   * system-wide notifications (e.g. `libraries_updated`) where the launcher
   * UI has no specific session affinity. Quiet no-op when nothing is
   * connected — callers can fire-and-forget.
   */
  broadcastAll(msg: BrowserIncomingMessage): void {
    for (const session of this.sessions.values()) {
      try {
        this.broadcastToBrowsers(session, msg);
      } catch {
        // One session's failure must not block the others.
      }
    }
  }

  /** Dispatch a viewer action to the active browser session, return the result. */
  async dispatchViewerAction(
    actionId: string,
    params?: Record<string, unknown>,
  ): Promise<import("../core/types/viewer-contract.js").ViewerActionResult> {
    const sessionId = this.getActiveSessionId();
    if (!sessionId) {
      return { success: false, message: "No active session" };
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.browserSockets.size === 0) {
      return { success: false, message: "No browser connected" };
    }
    const { sendViewerActionRequest } = await import("./ws-bridge-viewer.js");
    return sendViewerActionRequest(
      session,
      actionId,
      params,
      (msg) => this.broadcastToBrowsers(session, msg),
    );
  }

  /** Return the session ID that currently has a CLI connection, if any. */
  getActiveSessionId(): string | null {
    for (const [id, session] of this.sessions) {
      // CLI WebSocket (Claude) OR any streaming-backend (codex / kimi-cli).
      if (session.cliSocket || this.streamingBackends.has(id)) return id;
    }
    return null;
  }

  // ── Session management ──────────────────────────────────────────────────

  getOrCreateSession(sessionId: string, backendType?: AgentBackendType): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        cliSocket: null,
        browserSockets: new Set(),
        state: makeDefaultState(sessionId, backendType),
        pendingPermissions: new Map(),
        pendingControlRequests: new Map(),
        pendingViewerActions: new Map(),
        cliIdle: true,
        pendingNotifications: [],
        pendingSystemSignals: [],
        messageHistory: [],
        pendingEnvContext: [],
        suppressingPostAskq: false,
        pendingMessages: [],
        nextEventSeq: 1,
        eventBuffer: [],
        lastAckSeq: 0,
        processedClientMessageIds: [],
        processedClientMessageIdSet: new Set(),
      };
      this.sessions.set(sessionId, session);
    } else if (backendType) {
      session.state.backend_type = backendType;
      session.state.agent_capabilities = getBackendCapabilities(backendType);
    }
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  isCliConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.cliSocket;
  }

  removeSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  /** Get the message history for a session (for persistence). */
  getMessageHistory(sessionId: string): BrowserIncomingMessage[] {
    const session = this.sessions.get(sessionId);
    return session?.messageHistory ?? [];
  }

  /** Load persisted message history into a session. */
  loadMessageHistory(sessionId: string, history: BrowserIncomingMessage[]): void {
    const session = this.getOrCreateSession(sessionId);
    // Deduplicate assistant messages with the same ID (legacy files may have duplicates)
    // Also drop transient `system_event`s that pre-3.8.0 persisted to disk
    // (`hook_started` / `hook_response`); they're live-status pings that
    // bloated history.json by 10–100× and the browser doesn't render them,
    // so they served no replay purpose. Newer code opts them out of
    // persistence at write time; this strips any that landed before the fix.
    const deduped: BrowserIncomingMessage[] = [];
    const assistantIdToIdx = new Map<string, number>();
    for (const msg of history) {
      if (msg.type === "system_event") {
        const sub = (msg as { event?: { subtype?: string } }).event?.subtype;
        if (sub === "hook_started" || sub === "hook_response" || sub === "hook_progress") continue;
      }
      if (msg.type === "assistant" && msg.message?.id) {
        const existing = assistantIdToIdx.get(msg.message.id);
        if (existing !== undefined) {
          deduped[existing] = msg; // replace with latest
          continue;
        }
        assistantIdToIdx.set(msg.message.id, deduped.length);
      }
      deduped.push(msg);
    }
    session.messageHistory = deduped;
  }

  closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up the streaming backend (codex / kimi-cli) if attached.
    const backend = this.streamingBackends.get(sessionId);
    if (backend) {
      backend.disconnect().catch(() => {});
      this.streamingBackends.delete(sessionId);
    }

    if (session.cliSocket) {
      try { session.cliSocket.close(); } catch {}
      session.cliSocket = null;
    }

    for (const ws of session.browserSockets) {
      try { ws.close(); } catch {}
    }
    session.browserSockets.clear();

    this.sessions.delete(sessionId);
  }

  // ── CLI transport handlers (legacy WS + new stdio share these) ──────────

  /**
   * Attach a CLI transport to a session — fires `cli_connected` to browsers
   * and flushes any user messages that arrived before the CLI was ready.
   * Used by both the legacy WS path (wrapping a `ServerWebSocket`) and the
   * new stdio path (wrapping a stdin pipe).
   */
  attachCLITransport(sessionId: string, transport: CLITransport): void {
    const session = this.getOrCreateSession(sessionId);
    session.cliSocket = transport;
    console.log(`[ws-bridge] CLI connected for session ${sessionId}`);
    this.broadcastToBrowsers(session, { type: "cli_connected" });

    if (session.pendingMessages.length > 0) {
      console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) on CLI connect for session ${sessionId}`);
      const queued = session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        this.sendToCLI(session, ndjson);
      }
    }
  }

  /**
   * Detach the CLI transport for a session. Cancels in-flight permission
   * requests and tells browsers the CLI is gone.
   */
  detachCLITransport(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.cliSocket = null;
    console.log(`[ws-bridge] CLI disconnected for session ${sessionId}`);
    this.broadcastToBrowsers(session, { type: "cli_disconnected" });

    for (const [reqId] of session.pendingPermissions) {
      this.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
    }
    session.pendingPermissions.clear();
    session.suppressingPostAskq = false;
  }

  /**
   * Feed an NDJSON payload from the CLI side (one or many newline-delimited
   * JSON objects). Each line is parsed and routed through the existing
   * `routeCLIMessage` pipeline. Used by both the WS path (raw frame) and
   * the stdio path (one stdout chunk at a time).
   */
  feedCLIMessage(sessionId: string, raw: string | Buffer): void {
    const data = typeof raw === "string" ? raw : raw.toString("utf-8");
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const lines = data.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let msg: CLIMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        console.warn(`[ws-bridge] Failed to parse CLI message: ${line.substring(0, 200)}`);
        continue;
      }
      this.routeCLIMessage(session, msg);
    }
  }

  // ── Legacy CLI WebSocket handlers (delegate to transport methods above) ──

  handleCLIOpen(ws: ServerWebSocket<SocketData>, sessionId: string) {
    this.attachCLITransport(sessionId, {
      send: (line) => ws.send(line),
      close: () => { try { ws.close(); } catch {} },
    });
  }

  handleCLIMessage(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
    const sessionId = (ws.data as CLISocketData).sessionId;
    this.feedCLIMessage(sessionId, raw);
  }

  handleCLIClose(ws: ServerWebSocket<SocketData>) {
    const sessionId = (ws.data as CLISocketData).sessionId;
    this.detachCLITransport(sessionId);
  }

  // ── Browser WebSocket handlers ──────────────────────────────────────────

  handleBrowserOpen(ws: ServerWebSocket<SocketData>, sessionId: string) {
    const session = this.getOrCreateSession(sessionId);
    const browserData = ws.data as BrowserSocketData;
    browserData.subscribed = false;
    browserData.lastAckSeq = 0;
    session.browserSockets.add(ws);
    console.log(`[ws-bridge] Browser connected for session ${sessionId} (${session.browserSockets.size} browsers)`);

    // Send current session state as snapshot. `cli_busy` is computed
    // here (inverse of the internal `cliIdle` flag) so the joining
    // browser can hydrate `sessionStatus` / `turnInProgress` from the
    // actual live state — otherwise an auto-spawn (project-onboard)
    // or post-handoff target would stream into a UI that thinks the
    // agent is idle.
    const snapshot: BrowserIncomingMessage = {
      type: "session_init",
      session: { ...session.state, cli_busy: !session.cliIdle },
    };
    this.sendToBrowser(ws, snapshot);

    // Replay message history so the browser can reconstruct the conversation
    if (session.messageHistory.length > 0) {
      this.sendToBrowser(ws, {
        type: "message_history",
        messages: session.messageHistory,
      });
    }

    // Send any pending permission requests
    for (const perm of session.pendingPermissions.values()) {
      this.sendToBrowser(ws, { type: "permission_request", request: perm });
    }

    // Notify if CLI is not connected (skip for Codex / Kimi — both use stdio, not WebSocket)
    if (!session.cliSocket && !this.streamingBackends.has(sessionId)) {
      this.sendToBrowser(ws, { type: "cli_disconnected" });
    }
  }

  handleBrowserMessage(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
    const data = typeof raw === "string" ? raw : raw.toString("utf-8");
    const sessionId = (ws.data as BrowserSocketData).sessionId;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    let msg: BrowserOutgoingMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      console.warn(`[ws-bridge] Failed to parse browser message: ${data.substring(0, 200)}`);
      return;
    }

    if ((msg as any).type === "native_bridge_register") {
      setBridgeSocket(ws as any, (msg as any).capabilities);
      console.log("[ws-bridge] Native bridge registered");
      return;
    }
    if ((msg as any).type === "native_result") {
      handleBridgeResult((msg as any).requestId, {
        ok: (msg as any).ok,
        result: (msg as any).result,
        error: (msg as any).error,
      });
      return;
    }

    this.routeBrowserMessage(session, msg, ws);
  }

  handleBrowserClose(ws: ServerWebSocket<SocketData>) {
    const sessionId = (ws.data as BrowserSocketData).sessionId;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.browserSockets.delete(ws);
    console.log(`[ws-bridge] Browser disconnected for session ${sessionId} (${session.browserSockets.size} browsers)`);
    // Clean up native bridge if the desktop renderer disconnected
    setBridgeSocket(null);
  }

  // ── CLI message routing ─────────────────────────────────────────────────

  private routeCLIMessage(session: Session, msg: CLIMessage) {
    switch (msg.type) {
      case "system":
        this.handleSystemMessage(session, msg);
        break;

      case "assistant":
        this.handleAssistantMessage(session, msg);
        break;

      case "result":
        this.handleResultMessage(session, msg);
        break;

      case "stream_event":
        this.handleStreamEvent(session, msg);
        break;

      case "control_request":
        this.handleControlRequest(session, msg);
        break;

      case "tool_progress":
        this.handleToolProgress(session, msg);
        break;

      case "tool_use_summary":
        this.handleToolUseSummary(session, msg);
        break;

      case "auth_status":
        this.handleAuthStatus(session, msg);
        break;

      case "control_response":
        handleControlResponse(session, msg, (message) => console.warn(message));
        break;

      case "keep_alive":
        // Silently consume keepalives
        break;

      case "user":
        // CLI echoes slash-command output as a user message with <local-command-stdout>
        this.handleCLIUserEcho(session, msg);
        break;

      case "rate_limit_event":
        // Silently consume rate limit events
        break;

      case "control_cancel_request":
        this.handleControlCancelRequest(session, msg);
        break;

      case "streamlined_text":
        this.handleStreamlinedText(session, msg);
        break;

      case "streamlined_tool_use_summary":
        this.handleStreamlinedToolUseSummary(session, msg);
        break;

      case "prompt_suggestion":
        this.handlePromptSuggestion(session, msg);
        break;

      default:
        console.warn(`[ws-bridge] Unhandled CLI message type: ${(msg as any).type}`);
        break;
    }
  }

  private handleSystemMessage(session: Session, msg: CLISystemMessage) {
    if (msg.subtype === "init") {
      // Store the CLI's internal session_id so we can --resume on relaunch
      if (msg.session_id && this.onCLISessionId) {
        this.onCLISessionId(session.id, msg.session_id);
      }

      session.state.model = msg.model;
      session.state.cwd = msg.cwd;
      session.state.tools = msg.tools;
      session.state.permissionMode = msg.permissionMode;
      session.state.agent_version = msg.claude_code_version;
      session.state.claude_code_version = msg.claude_code_version;
      session.state.mcp_servers = msg.mcp_servers;
      session.state.agents = msg.agents ?? [];
      session.state.slash_commands = msg.slash_commands ?? [];
      session.state.skills = msg.skills ?? [];
      if ((msg as any).pid) session.state.pid = (msg as any).pid;
      if ((msg as any).fast_mode_state !== undefined) session.state.fast_mode_state = (msg as any).fast_mode_state;

      this.broadcastToBrowsers(session, {
        type: "session_init",
        session: { ...session.state, cli_busy: !session.cliIdle },
      });

      // Flush any messages queued before CLI was initialized
      if (session.pendingMessages.length > 0) {
        console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) after init for session ${session.id}`);
        const queued = session.pendingMessages.splice(0);
        for (const ndjson of queued) {
          this.sendToCLI(session, ndjson);
        }
      }
      return;
    }

    if (msg.subtype === "status") {
      session.state.is_compacting = msg.status === "compacting";

      if (msg.permissionMode) {
        session.state.permissionMode = msg.permissionMode;
      }

      this.broadcastToBrowsers(session, {
        type: "status_change",
        status: msg.status ?? null,
      });
      return;
    }

    if (msg.subtype === "compact_boundary") {
      session.state.context_used_percent = 0;
      this.forwardSystemEvent(session, {
        subtype: "compact_boundary",
        compact_metadata: msg.compact_metadata,
        uuid: msg.uuid,
        session_id: msg.session_id,
      });
      return;
    }

    if (msg.subtype === "task_notification") {
      this.forwardSystemEvent(session, {
        subtype: "task_notification",
        task_id: msg.task_id,
        status: msg.status,
        output_file: msg.output_file,
        summary: msg.summary,
        uuid: msg.uuid,
        session_id: msg.session_id,
      });
      return;
    }

    if (msg.subtype === "files_persisted") {
      this.forwardSystemEvent(session, {
        subtype: "files_persisted",
        files: msg.files,
        failed: msg.failed,
        processed_at: msg.processed_at,
        uuid: msg.uuid,
        session_id: msg.session_id,
      });
      return;
    }

    if (msg.subtype === "hook_started") {
      this.forwardSystemEvent(session, {
        subtype: "hook_started",
        hook_id: msg.hook_id,
        hook_name: msg.hook_name,
        hook_event: msg.hook_event,
        uuid: msg.uuid,
        session_id: msg.session_id,
      }, { persistInHistory: false });
      return;
    }

    if (msg.subtype === "hook_progress") {
      this.forwardSystemEvent(session, {
        subtype: "hook_progress",
        hook_id: msg.hook_id,
        hook_name: msg.hook_name,
        hook_event: msg.hook_event,
        stdout: msg.stdout,
        stderr: msg.stderr,
        output: msg.output,
        uuid: msg.uuid,
        session_id: msg.session_id,
      }, { persistInHistory: false });
      return;
    }

    if (msg.subtype === "hook_response") {
      this.forwardSystemEvent(session, {
        subtype: "hook_response",
        hook_id: msg.hook_id,
        hook_name: msg.hook_name,
        hook_event: msg.hook_event,
        output: msg.output,
        stdout: msg.stdout,
        stderr: msg.stderr,
        exit_code: msg.exit_code,
        outcome: msg.outcome,
        uuid: msg.uuid,
        session_id: msg.session_id,
      }, { persistInHistory: false });
      return;
    }
  }

  private forwardSystemEvent(
    session: Session,
    event: Extract<BrowserIncomingMessage, { type: "system_event" }>["event"],
    options: { persistInHistory?: boolean } = {},
  ) {
    const browserMsg: BrowserIncomingMessage = {
      type: "system_event",
      event,
      timestamp: Date.now(),
    };

    if (options.persistInHistory !== false) {
      session.messageHistory.push(browserMsg);
    }

    this.broadcastToBrowsers(session, browserMsg);
  }

  private handleAssistantMessage(session: Session, msg: CLIAssistantMessage) {
    // Drop the model's reactionary turn that follows the SDK's auto-deny
    // of an AskUserQuestion tool_use. The picker is still on screen
    // waiting for the user to actually click an option; meanwhile the
    // model has seen an `is_error` tool_result and is busy emitting
    // "since you didn't answer..." filler. That bubble is noise.
    // `suppressingPostAskq` gets set after the assistant message that
    // CONTAINED the AskUserQuestion broadcasts normally; we drop only
    // the next one(s) before the user submits.
    if (session.suppressingPostAskq) {
      return;
    }

    // Compatibility shim for Claude Code 2.x: the CLI no longer sends a
    // `can_use_tool` permission request for AskUserQuestion in any
    // permission mode. Instead it auto-denies the tool with an
    // `is_error: true` tool_result whose content is the tool's
    // `checkPermissions().message` ("Answer questions?"). To keep the
    // existing in-chat picker UI working we (a) fabricate a synthetic
    // permission record so the browser shows the picker, and (b) when the
    // user submits an answer, send it back as a plain user message rather
    // than a tool_result (the auto-deny already won the tool_use_id race).
    // The agent reads the natural-language follow-up message and continues.
    let containedAskq = false;
    const content = (msg.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: string; name?: string; id?: string; input?: Record<string, unknown> };
        if (b.type !== "tool_use" || b.name !== "AskUserQuestion" || !b.id) continue;
        const synthId = `synthetic:${b.id}`;
        if (session.pendingPermissions.has(synthId)) continue;
        let alreadyHasPerm = false;
        for (const p of session.pendingPermissions.values()) {
          if (p.tool_use_id === b.id) { alreadyHasPerm = true; break; }
        }
        if (alreadyHasPerm) continue;
        const perm: PermissionRequest = {
          request_id: synthId,
          tool_name: "AskUserQuestion",
          input: b.input ?? {},
          tool_use_id: b.id,
          timestamp: Date.now(),
        };
        session.pendingPermissions.set(synthId, perm);
        this.broadcastToBrowsers(session, {
          type: "permission_request",
          request: perm,
        });
        containedAskq = true;
      }
    }
    if (Array.isArray(msg.message?.content)) {
      stampFileRefs(msg.message.content, "claude-code", this.workspace);
    }
    const browserMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: msg.message,
      parent_tool_use_id: msg.parent_tool_use_id,
      timestamp: Date.now(),
    };
    // CLI sends multiple assistant messages with the same ID (thinking then text blocks).
    // Replace existing history entry to avoid duplicates on replay.
    const existingIdx = session.messageHistory.findLastIndex(
      (h) => h.type === "assistant" && h.message.id === msg.message.id,
    );
    if (existingIdx !== -1) {
      session.messageHistory[existingIdx] = browserMsg;
    } else {
      // On `--resume`, the CLI replays the conversation and re-emits the
      // last assistant message with a fresh `message.id`. Without a content
      // check the persisted history grows a duplicate every reopen (the
      // same reply rendered twice in chat). If the new message text matches
      // the last persisted assistant message AND no real user / tool turn
      // has happened since (system events / env tags don't count), treat
      // it as a resume re-emit and overwrite that entry rather than append.
      const lastAssistantIdx = session.messageHistory.findLastIndex((h) => h.type === "assistant");
      if (lastAssistantIdx !== -1) {
        const lastAssistant = session.messageHistory[lastAssistantIdx] as Extract<
          BrowserIncomingMessage,
          { type: "assistant" }
        >;
        const sameText =
          WsBridge.assistantTextContent(lastAssistant.message.content) ===
          WsBridge.assistantTextContent(msg.message.content as unknown[]);
        const hasMeaningfulInputSince = WsBridge.hasMeaningfulUserInputSince(
          session.messageHistory,
          lastAssistantIdx,
        );
        if (sameText && !hasMeaningfulInputSince && lastAssistant.message.id !== msg.message.id) {
          session.messageHistory[lastAssistantIdx] = browserMsg;
          this.broadcastToBrowsers(session, browserMsg);
          return;
        }
      }
      session.messageHistory.push(browserMsg);
    }
    this.broadcastToBrowsers(session, browserMsg);
    // The message that just delivered an AskUserQuestion to the user
    // opens the suppression window — any model output that arrives next
    // (before the user clicks an answer) is the SDK-auto-deny reaction
    // and gets dropped on the floor. The window closes when the picker
    // is resolved or cancelled (see handlePermissionResponse,
    // detachCLITransport, the CLI `permission_cancelled` path).
    if (containedAskq) {
      session.suppressingPostAskq = true;
      // Genuinely PAUSE the agent. In `--print --permission-mode
      // bypassPermissions`, the SDK does not gate AskUserQuestion via
      // `can_use_tool`; it auto-denies the tool with an `is_error`
      // tool_result and the model AUTO-CONTINUES a reactionary turn,
      // executing tools (e.g. Write) on a guess before the user ever picks.
      // Suppressing the display only hides bubbles — it cannot stop that
      // work. Interrupting aborts the reactionary turn (verified ~7ms to
      // land, turn ends ~30ms after the tool_use, before any reactionary
      // tool runs). The picker stays up; when the user answers,
      // handlePermissionResponse delivers it as a fresh user turn and the
      // model resumes cleanly.
      handleInterrupt(session, this.sendToCLI.bind(this));
    }
  }

  private static assistantTextContent(content: unknown): string {
    if (!Array.isArray(content)) return "";
    const out: string[] = [];
    for (const block of content) {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && typeof b.text === "string") out.push(b.text);
    }
    return out.join("\n").trim();
  }

  /**
   * "Meaningful" user input excludes purely-marker user messages — env
   * tags, viewer notifications, and other `<pneuma:*>` envelopes that
   * Pneuma synthesises on session open / refresh / handoff. Without this
   * filter the resume-dedup path mis-classifies an auto-redispatched
   * `<pneuma:env reason="opened">` as fresh user input and keeps the
   * duplicate greeting.
   */
  private static hasMeaningfulUserInputSince(
    history: BrowserIncomingMessage[],
    afterIdx: number,
  ): boolean {
    for (let i = afterIdx + 1; i < history.length; i++) {
      const h = history[i];
      if (h.type !== "user_message") continue;
      const raw = (h as { content?: unknown }).content;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        // Pure pneuma envelope (self-closing or paired) — not real input.
        if (isPneumaMarkerOnly(trimmed)) continue;
        return true;
      }
      if (Array.isArray(raw) && raw.length > 0) return true;
    }
    return false;
  }

  private handleResultMessage(session: Session, msg: CLIResultMessage) {
    session.cliIdle = true;

    // Paused on an AskUserQuestion picker: the only `result` that can arrive
    // here is the interrupt-aborted reactionary turn (subtype
    // error_during_execution). Don't surface it as an error, don't record
    // its phantom cost/turns, don't checkpoint the half-state, and don't
    // flush queued viewer notifications (that would start a new turn
    // mid-pause). Settle the UI to idle; the picker resolution starts the
    // real next turn (where suppression is already cleared).
    if (session.suppressingPostAskq) {
      this.broadcastToBrowsers(session, { type: "status_change", status: "idle" });
      return;
    }

    session.state.total_cost_usd = msg.total_cost_usd;
    session.state.num_turns = msg.num_turns;

    if (typeof msg.total_lines_added === "number") {
      session.state.total_lines_added = msg.total_lines_added;
    }
    if (typeof msg.total_lines_removed === "number") {
      session.state.total_lines_removed = msg.total_lines_removed;
    }

    const browserMsg: BrowserIncomingMessage = {
      type: "result",
      data: msg,
    };
    session.messageHistory.push(browserMsg);
    this.broadcastToBrowsers(session, browserMsg);

    // Push computed session stats so the browser doesn't need to recompute from result data
    this.broadcastToBrowsers(session, {
      type: "session_update",
      session: {
        total_cost_usd: session.state.total_cost_usd,
        num_turns: session.state.num_turns,
        context_used_percent: session.state.context_used_percent,
        total_lines_added: session.state.total_lines_added,
        total_lines_removed: session.state.total_lines_removed,
      },
    });

    // Capture shadow git checkpoint after turn completes
    if (this.workspace && isShadowGitAvailable(this.workspace)) {
      const turnIndex = session.state.num_turns ?? 0;
      enqueueCheckpoint(this.workspace, turnIndex);
    }

    // Flush ONE queued signal per turn boundary — flushing starts a new turn
    // (sets `cliIdle = false`), and the next item drains when that turn ends.
    // Viewer notifications take priority over system signals, but both ride
    // this same idle gate so neither starves the other (design §13.2).
    if (session.pendingNotifications?.length > 0) {
      const next = session.pendingNotifications.shift()!;
      const { images, ...notification } = next;
      console.log(`[ws-bridge] Flushing queued viewer notification: ${next.type} (${session.pendingNotifications.length} remaining)`);
      this.sendViewerNotificationToCLI(session, notification, images);
    } else if (session.pendingSystemSignals?.length > 0) {
      const tag = session.pendingSystemSignals.shift()!;
      console.log(`[ws-bridge] Flushing queued system signal (${session.pendingSystemSignals.length} remaining)`);
      this.sendUserMessage(session.id, tag);
    }

  }

  private handleStreamEvent(session: Session, msg: CLIStreamEventMessage) {
    // Same window as handleAssistantMessage — drop streaming partials of
    // the reactionary turn that follows the AskUserQuestion auto-deny.
    // Otherwise the browser's `streaming` state accumulates the
    // "since you didn't answer..." text and shows it as a ghost bubble
    // with a blinking cursor next to the still-pending picker.
    if (session.suppressingPostAskq) return;
    this.broadcastToBrowsers(session, {
      type: "stream_event",
      event: msg.event,
      parent_tool_use_id: msg.parent_tool_use_id,
    });
  }

  private handleControlRequest(session: Session, msg: CLIControlRequestMessage) {
    if (msg.request.subtype === "can_use_tool") {
      // In bypassPermissions mode, auto-approve all tool requests
      // EXCEPT AskUserQuestion — it always requires user interaction
      if (session.state.permissionMode === "bypassPermissions" && msg.request.tool_name !== "AskUserQuestion") {
        const ndjson = JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: {
              behavior: "allow",
              updatedInput: msg.request.input,
            },
          },
        });
        this.sendToCLI(session, ndjson);
        return;
      }

      const perm: PermissionRequest = {
        request_id: msg.request_id,
        tool_name: msg.request.tool_name,
        input: msg.request.input,
        permission_suggestions: msg.request.permission_suggestions,
        description: msg.request.description,
        tool_use_id: msg.request.tool_use_id,
        agent_id: msg.request.agent_id,
        title: msg.request.title,
        display_name: msg.request.display_name,
        blocked_path: msg.request.blocked_path,
        decision_reason: msg.request.decision_reason,
        timestamp: Date.now(),
      };
      session.pendingPermissions.set(msg.request_id, perm);

      this.broadcastToBrowsers(session, {
        type: "permission_request",
        request: perm,
      });
    }
  }

  private handleToolProgress(session: Session, msg: CLIToolProgressMessage) {
    this.broadcastToBrowsers(session, {
      type: "tool_progress",
      tool_use_id: msg.tool_use_id,
      tool_name: msg.tool_name,
      elapsed_time_seconds: msg.elapsed_time_seconds,
    });
  }

  private handleToolUseSummary(session: Session, msg: CLIToolUseSummaryMessage) {
    this.broadcastToBrowsers(session, {
      type: "tool_use_summary",
      summary: msg.summary,
      tool_use_ids: msg.preceding_tool_use_ids,
    });
  }

  private handleCLIUserEcho(session: Session, msg: CLIUserMessage) {
    // CLI echoes slash-command output as a user message with <local-command-stdout>
    const raw = typeof msg.message.content === "string" ? msg.message.content : "";
    const match = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    let content = match ? match[1].trim() : raw.trim();
    if (!content) return;

    // Strip ANSI escape codes
    // eslint-disable-next-line no-control-regex
    content = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

    // Detect /context output: "Context Usage" heading + "X / Y" token fraction
    const isContextOutput = /context\s+usage/i.test(content)
      && /\d[\d,.]*k?\s*\/\s*\d[\d,.]*k?/.test(content);

    if (isContextOutput) {
      const pctMatch = content.match(/(\d+)%/);
      if (pctMatch) {
        const pct = parseInt(pctMatch[1], 10);
        if (pct >= 0 && pct <= 100) {
          session.state.context_used_percent = pct;
          this.broadcastToBrowsers(session, {
            type: "session_update",
            session: { context_used_percent: pct },
          });
        }
      }
    }

    const browserMsg: BrowserIncomingMessage = {
      type: "command_output",
      content,
      ...(isContextOutput ? { subtype: "context" as const } : {}),
    };
    session.messageHistory.push(browserMsg);
    this.broadcastToBrowsers(session, browserMsg);
  }

  private handleAuthStatus(session: Session, msg: CLIAuthStatusMessage) {
    this.broadcastToBrowsers(session, {
      type: "auth_status",
      isAuthenticating: msg.isAuthenticating,
      output: msg.output,
      error: msg.error,
    });
  }

  private handleControlCancelRequest(session: Session, msg: CLIControlCancelRequestMessage) {
    // CLI cancelled a pending permission request — remove from pending and notify browser
    const pending = session.pendingPermissions.get(msg.request_id);
    session.pendingPermissions.delete(msg.request_id);
    // If the cancelled perm was the AskUserQuestion we were waiting on,
    // close the suppression window. There's no follow-up coming, so the
    // model's next output (whatever it is) should reach the user.
    if (pending?.tool_name === "AskUserQuestion") {
      session.suppressingPostAskq = false;
    }
    this.broadcastToBrowsers(session, {
      type: "permission_cancelled",
      request_id: msg.request_id,
    });
  }

  private handleStreamlinedText(session: Session, msg: CLIStreamlinedTextMessage) {
    // Same suppression window as handleAssistantMessage / handleStreamEvent —
    // drop any text from the interrupt-aborted post-AskUserQuestion turn.
    if (session.suppressingPostAskq) return;
    this.broadcastToBrowsers(session, {
      type: "streamlined_text",
      text: msg.text,
      parent_tool_use_id: msg.parent_tool_use_id ?? null,
    });
  }

  private handleStreamlinedToolUseSummary(session: Session, msg: CLIStreamlinedToolUseSummaryMessage) {
    if (session.suppressingPostAskq) return;
    this.broadcastToBrowsers(session, {
      type: "streamlined_tool_use_summary",
      summary: msg.summary,
      tool_use_ids: msg.tool_use_ids,
    });
  }

  private handlePromptSuggestion(session: Session, msg: CLIPromptSuggestionMessage) {
    this.broadcastToBrowsers(session, {
      type: "prompt_suggestion",
      suggestions: msg.suggestions,
    });
  }

  // ── Browser message routing ─────────────────────────────────────────────

  private routeBrowserMessage(
    session: Session,
    msg: BrowserOutgoingMessage,
    ws?: ServerWebSocket<SocketData>,
  ) {
    if (msg.type === "session_subscribe") {
      handleSessionSubscribe(
        session,
        ws,
        msg.last_seq,
        this.sendToBrowser.bind(this),
        isHistoryBackedEvent,
      );
      return;
    }

    if (msg.type === "session_ack") {
      handleSessionAck(session, ws, msg.last_seq);
      return;
    }

    if (
      WsBridge.IDEMPOTENT_BROWSER_MESSAGE_TYPES.has(msg.type)
      && "client_msg_id" in msg
      && msg.client_msg_id
    ) {
      if (isDuplicateClientMessage(session, msg.client_msg_id)) {
        return;
      }
      rememberClientMessage(
        session,
        msg.client_msg_id,
        WsBridge.PROCESSED_CLIENT_MSG_ID_LIMIT,
      );
    }

    // Streaming-backend dispatch (codex / kimi-cli). Each backend's
    // `BridgeBackend.routeBrowserMessage` returns:
    //   - `"handled"` → backend consumed the message; stop
    //   - `"unsupported"` → backend explicitly doesn't support this type
    //     (e.g. kimi has no permission flow); drop without falling through
    //   - `"passthrough"` → bridge-internal types (viewer_action_response,
    //     viewer_notification, session_subscribe, etc.) — fall through to
    //     the bridge's own handlers below.
    const streamingBackend = this.streamingBackends.get(session.id);
    if (streamingBackend) {
      const result = streamingBackend.routeBrowserMessage(msg);
      if (result === "handled" || result === "unsupported") return;

      // Bridge-internal viewer messages — same handling for every backend.
      switch (msg.type) {
        case "viewer_action_response":
          handleViewerActionResponse(session, msg);
          return;
        case "viewer_notification":
          this.handleViewerNotification(session, msg);
          return;
      }
    }

    switch (msg.type) {
      case "user_message":
        this.handleUserMessage(session, msg);
        break;

      case "permission_response":
        handlePermissionResponse(session, msg, this.sendToCLI.bind(this));
        break;

      case "interrupt":
        handleInterrupt(session, this.sendToCLI.bind(this));
        break;

      case "set_model": {
        const ndjson = JSON.stringify({ type: "set_model", model: msg.model });
        this.sendToCLI(session, ndjson);
        // Optimistic update
        session.state.model = msg.model;
        this.broadcastToBrowsers(session, {
          type: "session_update",
          session: { model: msg.model },
        });
        break;
      }

      case "viewer_action_response":
        handleViewerActionResponse(session, msg);
        break;

      case "viewer_notification":
        this.handleViewerNotification(session, msg);
        break;

      case "end_session": {
        const ndjson = JSON.stringify({
          type: "control_request",
          request: { subtype: "end_session" },
        });
        this.sendToCLI(session, ndjson);
        break;
      }

      case "stop_task": {
        const ndjson = JSON.stringify({
          type: "control_request",
          request: { subtype: "stop_task" },
        });
        this.sendToCLI(session, ndjson);
        break;
      }

      case "update_environment_variables": {
        const ndjson = JSON.stringify({
          type: "update_environment_variables",
          variables: msg.variables,
        });
        this.sendToCLI(session, ndjson);
        break;
      }
    }
  }

  private saveImageToDisk(mediaType: string, base64Data: string): string {
    const uploadsDir = join(this.workspace, ".pneuma", "uploads");
    mkdirSync(uploadsDir, { recursive: true });

    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    const ext = extMap[mediaType] || "png";
    const filename = `img-${Math.floor(Date.now() / 1000)}-${++this.imageCounter}.${ext}`;
    const filePath = join(uploadsDir, filename);

    const buffer = Buffer.from(base64Data, "base64");
    writeFileSync(filePath, buffer);

    return filePath;
  }

  private saveFileToDisk(name: string, mediaType: string, base64Data: string): string {
    const uploadsDir = join(this.workspace, ".pneuma", "uploads");
    mkdirSync(uploadsDir, { recursive: true });

    // Sanitize filename: remove path separators and control chars
    const safeName = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(0, 200);
    const filename = `${Math.floor(Date.now() / 1000)}-${++this.fileCounter}-${safeName}`;
    const filePath = join(uploadsDir, filename);

    const buffer = Buffer.from(base64Data, "base64");
    writeFileSync(filePath, buffer);

    return filePath;
  }

  private static isTextMimeType(mediaType: string): boolean {
    if (mediaType.startsWith("text/")) return true;
    const textTypes = [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
      "application/x-sh",
      "application/sql",
      "application/graphql",
      "application/ld+json",
    ];
    return textTypes.includes(mediaType);
  }

  private static formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Per-backend `handleXUserMessage` methods used to live here. They moved
  // into the corresponding `BridgeBackend` implementations
  // (`CodexBridge.handleBrowserUserMessage`, `KimiBridge.handleBrowserUserMessage`)
  // when the bridge gained the lifecycle-hook architecture — see
  // `server/ws-bridge-backend.ts`. The bridge's own `handleUserMessage`
  // below covers the legacy Claude Code path (CLI WebSocket).

  /**
   * Backend-agnostic ingest for a browser `user_message`. See the JSDoc on
   * `BridgeBackendDeps.prepareIncomingUserMessage` for the contract; the
   * deps method is just a thin pass-through to this one so every bridge
   * backend goes through the same path.
   */
  prepareIncomingUserMessage(
    session: Session,
    msg: {
      content: string;
      images?: { media_type: string; data: string }[];
      files?: { name: string; media_type: string; data: string; size: number }[];
    },
    opts: { inlineImagesSupported: boolean },
  ): { textContent: string; inlineImages: { media_type: string; data: string }[] } {
    const IMAGE_INLINE_LIMIT = 5 * 1024 * 1024; // 5 MB base64 chars ≈ 3.75 MB raw
    const TEXT_INLINE_LIMIT = 32 * 1024;

    // 1. Save non-image files to disk; if small + text-y, inline content
    //    into the notification body so the agent doesn't need a Read tool
    //    call for short text uploads.
    const savedFiles: { path: string; name: string; size: number; mediaType: string; inlineContent?: string }[] = [];
    if (this.workspace && msg.files?.length) {
      for (const file of msg.files) {
        try {
          const filePath = this.saveFileToDisk(file.name, file.media_type, file.data);
          const entry: typeof savedFiles[number] = {
            path: filePath,
            name: file.name,
            size: file.size,
            mediaType: file.media_type,
          };
          if (WsBridge.isTextMimeType(file.media_type) && file.size <= TEXT_INLINE_LIMIT) {
            try {
              entry.inlineContent = readFileSync(filePath, "utf-8");
            } catch {}
          }
          savedFiles.push(entry);
        } catch (err) {
          console.warn("[ws-bridge] Failed to save uploaded file to disk:", err);
        }
      }
    }

    // 2. Save images to disk. `largeImagePaths` marks the ones the bridge
    //    backend must not inline — either over the size budget, or the
    //    backend doesn't accept inline image blocks at all. The agent picks
    //    them up via the disk path embedded in the upload notification.
    const savedImagePaths: string[] = [];
    const largeImagePaths = new Set<string>();
    if (this.workspace && msg.images?.length) {
      for (const img of msg.images) {
        try {
          const savedPath = this.saveImageToDisk(img.media_type, img.data);
          savedImagePaths.push(savedPath);
          if (!opts.inlineImagesSupported || img.data.length > IMAGE_INLINE_LIMIT) {
            largeImagePaths.add(savedPath);
          }
        } catch (err) {
          console.warn("[ws-bridge] Failed to save uploaded image to disk:", err);
        }
      }
    }

    // 3. Persist to history with attachment metadata so a session reopen
    //    restores image previews + file chips in the chat stream. Only the
    //    disk path is stored, not the base64 payload — history.json stays
    //    small; the browser loads bytes through /api/file?path=<abs>.
    const ts = Date.now();
    const historyImages = msg.images?.length
      ? msg.images.map((img, i) => ({ media_type: img.media_type, path: savedImagePaths[i] }))
          .filter((entry): entry is { media_type: string; path: string } => Boolean(entry.path))
      : [];
    const historyFiles = savedFiles.map((f) => ({ name: f.name, size: f.size, path: f.path }));
    session.messageHistory.push({
      type: "user_message",
      content: msg.content,
      timestamp: ts,
      id: `user-${ts}-${this.userMsgCounter++}`,
      ...(historyImages.length ? { images: historyImages } : {}),
      ...(historyFiles.length ? { files: historyFiles } : {}),
    });

    // 4. Drain any pending `<pneuma:env>` context that was queued while the
    //    user wasn't typing. Those tags were already recorded in
    //    messageHistory + shown as chat banners, but they intentionally
    //    never went to the agent as their own user turns (which produced
    //    spurious "welcome back" replies). Now that a real user message is
    //    heading to the agent, fold them in as a one-shot prefix so the
    //    agent sees session-lineage / locale / handoff context.
    let envPrefix = "";
    if (session.pendingEnvContext.length > 0) {
      envPrefix = session.pendingEnvContext.join("\n") + "\n";
      session.pendingEnvContext = [];
    }

    // 5. Assemble the text the agent should receive: envPrefix +
    //    `<uploaded-files>` block + the user's original message.
    const uploadNotice = this.buildUploadNotification(savedImagePaths, savedFiles, largeImagePaths);
    const textContent = envPrefix + uploadNotice + msg.content;

    // 6. Compute inline images (small enough + backend-supported). Bridge
    //    backends decide their own protocol-specific dispatch for these
    //    (Claude → content blocks, Codex → data URL parts, Kimi → nothing).
    const inlineImages = opts.inlineImagesSupported && msg.images?.length
      ? msg.images.filter((img) => img.data.length <= IMAGE_INLINE_LIMIT)
      : [];

    return { textContent, inlineImages };
  }

  private handleUserMessage(
    session: Session,
    msg: { type: "user_message"; content: string; session_id?: string; images?: { media_type: string; data: string }[]; files?: { name: string; media_type: string; data: string; size: number }[] }
  ) {
    const { textContent, inlineImages } = this.prepareIncomingUserMessage(
      session,
      msg,
      { inlineImagesSupported: true },
    );

    // Inline-eligible images become content blocks; otherwise a plain
    // string. (A single-text-block array would be equivalent to the
    // string, so collapse it.)
    let content: string | unknown[];
    if (inlineImages.length > 0) {
      const blocks: unknown[] = inlineImages.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      }));
      blocks.push({ type: "text", text: textContent });
      content = blocks;
    } else {
      content = textContent;
    }

    session.cliIdle = false;
    const ndjson = JSON.stringify({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: msg.session_id || session.state.session_id || "",
    });
    this.sendToCLI(session, ndjson);
  }

  private buildUploadNotification(
    imagePaths: string[],
    files: { path: string; name: string; size: number; mediaType: string; inlineContent?: string }[],
    largeImagePaths?: Set<string>,
  ): string {
    if (imagePaths.length === 0 && files.length === 0) return "";

    const toRel = (p: string) => this.workspace ? relative(this.workspace, p) : p;
    const totalCount = imagePaths.length + files.length;
    const lines: string[] = [];

    lines.push(`<uploaded-files count="${totalCount}" dir=".pneuma/uploads/">`);
    lines.push(`The user provided ${totalCount} file${totalCount !== 1 ? "s" : ""} with this message. They have been saved to .pneuma/uploads/ for your use.`);

    if (imagePaths.length > 0) {
      for (const p of imagePaths) {
        if (largeImagePaths?.has(p)) {
          lines.push(`  <image path="${toRel(p)}" large="true" hint="Image too large for inline preview. Use the Read tool to view it." />`);
        } else {
          lines.push(`  <image path="${toRel(p)}" />`);
        }
      }
    }

    for (const f of files) {
      const sizeStr = WsBridge.formatFileSize(f.size);
      if (f.inlineContent != null) {
        lines.push(`  <file path="${toRel(f.path)}" name="${f.name}" size="${sizeStr}">`);
        lines.push(f.inlineContent);
        lines.push(`  </file>`);
      } else {
        lines.push(`  <file path="${toRel(f.path)}" name="${f.name}" size="${sizeStr}" />`);
      }
    }

    lines.push(`</uploaded-files>`);

    return lines.join("\n") + "\n\n";
  }

  private handleViewerNotification(
    session: Session,
    msg: {
      type: "viewer_notification";
      notification: { type: string; message: string; severity: "info" | "warning" };
      images?: { media_type: string; data: string }[];
    },
  ) {
    // Only handle warning-level notifications
    if (msg.notification.severity !== "warning") return;

    if (!session.cliIdle) {
      // CLI busy — queue for delivery when CLI becomes idle
      if (!session.pendingNotifications) session.pendingNotifications = [];
      session.pendingNotifications.push({ ...msg.notification, images: msg.images });
      console.log(`[ws-bridge] Viewer notification queued (CLI busy): ${msg.notification.type} (${session.pendingNotifications.length} in queue)`);
      return;
    }

    this.sendViewerNotificationToCLI(session, msg.notification, msg.images);
  }

  /** Send a viewer notification to CLI as a user message (not recorded in messageHistory). */
  private sendViewerNotificationToCLI(
    session: Session,
    notification: { type: string; message: string; severity: "info" | "warning" },
    images?: { media_type: string; data: string }[],
  ) {
    session.cliIdle = false;

    const streamingBackend = this.streamingBackends.get(session.id);
    if (streamingBackend) {
      if (images?.length) {
        streamingBackend.routeBrowserMessage({
          type: "user_message",
          content: notification.message,
          images,
        });
      } else {
        streamingBackend.injectUserMessage(notification.message);
      }
      console.log(`[ws-bridge] Viewer notification forwarded to backend: ${notification.type}${images?.length ? ` (with ${images.length} image(s))` : ""}`);
      return;
    }

    if (images?.length) {
      // Use the same path as regular user messages so images get converted to content blocks
      this.handleUserMessage(session, {
        type: "user_message",
        content: notification.message,
        images,
      });
    } else {
      const ndjson = JSON.stringify({
        type: "user",
        message: { role: "user", content: notification.message },
        parent_tool_use_id: null,
        session_id: session.state.session_id || "",
      });
      this.sendToCLI(session, ndjson);
    }
    console.log(`[ws-bridge] Viewer notification forwarded to CLI: ${notification.type}${images?.length ? ` (with ${images.length} image(s))` : ""}`);
  }

  // ── Transport helpers ───────────────────────────────────────────────────

  private sendToCLI(session: Session, ndjson: string) {
    if (!session.cliSocket) {
      console.log(`[ws-bridge] CLI not yet connected for session ${session.id}, queuing message`);
      session.pendingMessages.push(ndjson);
      return;
    }
    try {
      // NDJSON requires a newline delimiter
      session.cliSocket.send(ndjson + "\n");
    } catch (err) {
      console.error(`[ws-bridge] Failed to send to CLI for session ${session.id}:`, err);
    }
  }

  private broadcastToBrowsers(session: Session, msg: BrowserIncomingMessage) {
    const json = JSON.stringify(
      sequenceEvent(
        session,
        msg,
        WsBridge.EVENT_BUFFER_LIMIT,
      ),
    );

    if (session.browserSockets.size === 0 && (globalThis as Record<string, unknown>).PNEUMA_DEBUG) {
      console.warn(`[ws-bridge] No browser sockets for session ${session.id} — dropping ${msg.type}`);
    }

    for (const ws of session.browserSockets) {
      try {
        ws.send(json);
      } catch {
        session.browserSockets.delete(ws);
      }
    }
  }

  private sendToBrowser(ws: ServerWebSocket<SocketData>, msg: BrowserIncomingMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket will be cleaned up on close
    }
  }
}
