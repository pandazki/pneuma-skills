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
  BrowserOutgoingMessage,
  BrowserIncomingMessage,
  PermissionRequest,
} from "./session-types.js";
import type {
  Session,
  SocketData,
  CLISocketData,
  BrowserSocketData,
} from "./ws-bridge-types.js";
import { makeDefaultState } from "./ws-bridge-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getBackendCapabilities } from "../backends/index.js";
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
import type { CodexAdapter } from "../backends/codex/codex-adapter.js";
import { attachCodexAdapterHandlers } from "./ws-bridge-codex.js";

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
  private codexAdapters = new Map<string, CodexAdapter>();
  private onCLISessionId: ((sessionId: string, cliSessionId: string) => void) | null = null;
  private userMsgCounter = 0;
  private workspace = "";
  private imageCounter = 0;
  private fileCounter = 0;

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  /**
   * Attach a Codex adapter to a session.
   * Called when a Codex backend launches — wires adapter events to the bridge.
   */
  attachCodexAdapter(sessionId: string, adapter: CodexAdapter): void {
    const session = this.getOrCreateSession(sessionId, "codex");
    this.codexAdapters.set(sessionId, adapter);

    attachCodexAdapterHandlers(sessionId, session, adapter, {
      broadcastToBrowsers: (s, msg) => this.broadcastToBrowsers(s, msg),
      workspace: this.workspace,
    });

    // Wire session metadata (thread ID) back to the bridge
    adapter.onSessionMeta((meta) => {
      if (meta.cliSessionId && this.onCLISessionId) {
        this.onCLISessionId(sessionId, meta.cliSessionId);
      }
    });

    // When the adapter connects, treat it like CLI connected
    this.broadcastToBrowsers(session, { type: "cli_connected" });

    // Flush any queued messages — parse NDJSON and send through the adapter
    if (session.pendingMessages.length > 0) {
      console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) via Codex adapter for session ${sessionId}`);
      const queued = session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        try {
          const msg = JSON.parse(ndjson);
          adapter.sendBrowserMessage(msg);
        } catch (err) {
          console.error(`[ws-bridge] Failed to parse/send queued message for session ${sessionId}:`, err);
        }
      }
    }
  }

  /** Check if a session is using the Codex adapter (vs CLI WebSocket). */
  isCodexSession(sessionId: string): boolean {
    return this.codexAdapters.has(sessionId);
  }

  /**
   * Send a greeting message to the CLI without recording it in messageHistory.
   * The user never sees the prompt — only the agent's response appears in chat.
   */
  injectGreeting(sessionId: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.cliIdle = false;

    // For Codex sessions, route through the adapter
    const codexAdapter = this.codexAdapters.get(sessionId);
    if (codexAdapter) {
      codexAdapter.sendBrowserMessage({ type: "user_message", content });
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

  /** Push a message to all connected browsers for a session. */
  broadcastToSession(sessionId: string, msg: BrowserIncomingMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.broadcastToBrowsers(session, msg);
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
      // CLI WebSocket (Claude) or Codex adapter (stdio)
      if (session.cliSocket || this.codexAdapters.has(id)) return id;
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
        messageHistory: [],
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
    const deduped: BrowserIncomingMessage[] = [];
    const assistantIdToIdx = new Map<string, number>();
    for (const msg of history) {
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

    // Clean up Codex adapter if present
    const codexAdapter = this.codexAdapters.get(sessionId);
    if (codexAdapter) {
      codexAdapter.disconnect().catch(() => {});
      this.codexAdapters.delete(sessionId);
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

  // ── CLI WebSocket handlers ──────────────────────────────────────────────

  handleCLIOpen(ws: ServerWebSocket<SocketData>, sessionId: string) {
    const session = this.getOrCreateSession(sessionId);
    session.cliSocket = ws;
    console.log(`[ws-bridge] CLI connected for session ${sessionId}`);
    this.broadcastToBrowsers(session, { type: "cli_connected" });

    // Flush any messages queued while waiting for the CLI WebSocket.
    if (session.pendingMessages.length > 0) {
      console.log(`[ws-bridge] Flushing ${session.pendingMessages.length} queued message(s) on CLI connect for session ${sessionId}`);
      const queued = session.pendingMessages.splice(0);
      for (const ndjson of queued) {
        this.sendToCLI(session, ndjson);
      }
    }
  }

  handleCLIMessage(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
    const data = typeof raw === "string" ? raw : raw.toString("utf-8");
    const sessionId = (ws.data as CLISocketData).sessionId;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // NDJSON: split on newlines, parse each line
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

  handleCLIClose(ws: ServerWebSocket<SocketData>) {
    const sessionId = (ws.data as CLISocketData).sessionId;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.cliSocket = null;
    console.log(`[ws-bridge] CLI disconnected for session ${sessionId}`);
    this.broadcastToBrowsers(session, { type: "cli_disconnected" });

    // Cancel any pending permission requests
    for (const [reqId] of session.pendingPermissions) {
      this.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
    }
    session.pendingPermissions.clear();
  }

  // ── Browser WebSocket handlers ──────────────────────────────────────────

  handleBrowserOpen(ws: ServerWebSocket<SocketData>, sessionId: string) {
    const session = this.getOrCreateSession(sessionId);
    const browserData = ws.data as BrowserSocketData;
    browserData.subscribed = false;
    browserData.lastAckSeq = 0;
    session.browserSockets.add(ws);
    console.log(`[ws-bridge] Browser connected for session ${sessionId} (${session.browserSockets.size} browsers)`);

    // Send current session state as snapshot
    const snapshot: BrowserIncomingMessage = {
      type: "session_init",
      session: session.state,
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

    // Notify if CLI is not connected (skip for Codex — it uses stdio, not WebSocket)
    if (!session.cliSocket && !this.codexAdapters.has(sessionId)) {
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

      this.broadcastToBrowsers(session, {
        type: "session_init",
        session: session.state,
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
      });
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
      });
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
      session.messageHistory.push(browserMsg);
    }
    this.broadcastToBrowsers(session, browserMsg);
  }

  private handleResultMessage(session: Session, msg: CLIResultMessage) {
    session.cliIdle = true;
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

    // Flush queued viewer notifications (send only the first; it will trigger a new turn,
    // and subsequent notifications will be sent when that turn completes)
    if (session.pendingNotifications?.length > 0) {
      const next = session.pendingNotifications.shift()!;
      const { images, ...notification } = next;
      console.log(`[ws-bridge] Flushing queued viewer notification: ${next.type} (${session.pendingNotifications.length} remaining)`);
      this.sendViewerNotificationToCLI(session, notification, images);
    }

  }

  private handleStreamEvent(session: Session, msg: CLIStreamEventMessage) {
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

    // For Codex sessions, route applicable messages through the adapter
    const codexAdapter = this.codexAdapters.get(session.id);
    if (codexAdapter) {
      switch (msg.type) {
        case "user_message":
          this.handleCodexUserMessage(session, codexAdapter, msg);
          return;
        case "permission_response":
          codexAdapter.sendBrowserMessage(msg);
          session.pendingPermissions.delete(msg.request_id);
          return;
        case "interrupt":
          codexAdapter.sendBrowserMessage(msg);
          return;
        case "set_model":
          codexAdapter.sendBrowserMessage(msg);
          session.state.model = (msg as { model: string }).model;
          return;
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

  /**
   * Handle user messages for Codex sessions — records history then routes
   * through the CodexAdapter, which translates to JSON-RPC turn/start.
   */
  private handleCodexUserMessage(
    session: Session,
    adapter: CodexAdapter,
    msg: { type: "user_message"; content: string; session_id?: string; images?: { media_type: string; data: string }[]; files?: { name: string; media_type: string; data: string; size: number }[] },
  ): void {
    // Record in history for replay
    const ts = Date.now();
    session.messageHistory.push({
      type: "user_message",
      content: msg.content,
      timestamp: ts,
      id: `user-${ts}-${this.userMsgCounter++}`,
    });

    session.cliIdle = false;
    adapter.sendBrowserMessage({
      type: "user_message",
      content: msg.content,
      images: msg.images,
    });
  }

  private handleUserMessage(
    session: Session,
    msg: { type: "user_message"; content: string; session_id?: string; images?: { media_type: string; data: string }[]; files?: { name: string; media_type: string; data: string; size: number }[] }
  ) {
    // Store user message in history for replay
    const ts = Date.now();
    session.messageHistory.push({
      type: "user_message",
      content: msg.content,
      timestamp: ts,
      id: `user-${ts}-${this.userMsgCounter++}`,
    });

    // Save non-image files to disk and build notification
    const savedImagePaths: string[] = [];
    const largeImagePaths = new Set<string>(); // images too large for inline content blocks
    const savedFiles: { path: string; name: string; size: number; mediaType: string; inlineContent?: string }[] = [];

    if (this.workspace && msg.files?.length) {
      const TEXT_INLINE_LIMIT = 32 * 1024; // 32 KB
      for (const file of msg.files) {
        try {
          const filePath = this.saveFileToDisk(file.name, file.media_type, file.data);
          const entry: typeof savedFiles[number] = {
            path: filePath,
            name: file.name,
            size: file.size,
            mediaType: file.media_type,
          };
          // Inline small text files
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

    // Build content: if images are present, use content block array; otherwise plain string.
    // Large images (>5 MB base64) are saved to disk only — not inlined as content blocks —
    // to avoid exceeding WebSocket payload limits.
    const IMAGE_INLINE_LIMIT = 5 * 1024 * 1024; // 5 MB base64 chars ≈ 3.75 MB raw
    let content: string | unknown[];
    if (msg.images?.length) {
      const blocks: unknown[] = [];

      for (const img of msg.images) {
        if (this.workspace) {
          try {
            const savedPath = this.saveImageToDisk(img.media_type, img.data);
            savedImagePaths.push(savedPath);
            if (img.data.length > IMAGE_INLINE_LIMIT) {
              largeImagePaths.add(savedPath);
            }
          } catch (err) {
            console.warn("[ws-bridge] Failed to save uploaded image to disk:", err);
          }
        }
        // Only inline small images as content blocks
        if (img.data.length <= IMAGE_INLINE_LIMIT) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: img.media_type, data: img.data },
          });
        }
      }

      let textContent = msg.content;
      textContent = this.buildUploadNotification(savedImagePaths, savedFiles, largeImagePaths) + textContent;

      blocks.push({ type: "text", text: textContent });
      // Only use content block array if we actually have inline images
      content = blocks.length > 1 ? blocks : textContent;
    } else if (savedFiles.length > 0) {
      content = this.buildUploadNotification(savedImagePaths, savedFiles) + msg.content;
    } else {
      content = msg.content;
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
