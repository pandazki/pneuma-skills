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
  private onCLISessionId: ((sessionId: string, cliSessionId: string) => void) | null = null;
  private userMsgCounter = 0;

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

  // ── Session management ──────────────────────────────────────────────────

  getOrCreateSession(sessionId: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        cliSocket: null,
        browserSockets: new Set(),
        state: makeDefaultState(sessionId),
        pendingPermissions: new Map(),
        pendingControlRequests: new Map(),
        messageHistory: [],
        pendingMessages: [],
        nextEventSeq: 1,
        eventBuffer: [],
        lastAckSeq: 0,
        processedClientMessageIds: [],
        processedClientMessageIdSet: new Set(),
      };
      this.sessions.set(sessionId, session);
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
    session.messageHistory = history;
  }

  closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

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

    // Notify if CLI is not connected
    if (!session.cliSocket) {
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

    this.routeBrowserMessage(session, msg, ws);
  }

  handleBrowserClose(ws: ServerWebSocket<SocketData>) {
    const sessionId = (ws.data as BrowserSocketData).sessionId;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.browserSockets.delete(ws);
    console.log(`[ws-bridge] Browser disconnected for session ${sessionId} (${session.browserSockets.size} browsers)`);
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
    session.messageHistory.push(browserMsg);
    this.broadcastToBrowsers(session, browserMsg);
  }

  private handleResultMessage(session: Session, msg: CLIResultMessage) {
    session.state.total_cost_usd = msg.total_cost_usd;
    session.state.num_turns = msg.num_turns;

    if (typeof msg.total_lines_added === "number") {
      session.state.total_lines_added = msg.total_lines_added;
    }
    if (typeof msg.total_lines_removed === "number") {
      session.state.total_lines_removed = msg.total_lines_removed;
    }

    // Compute context usage from modelUsage
    if (msg.modelUsage) {
      for (const usage of Object.values(msg.modelUsage)) {
        if (usage.contextWindow > 0) {
          const pct = Math.round(
            ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100
          );
          session.state.context_used_percent = Math.max(0, Math.min(pct, 100));
        }
      }
    }

    const browserMsg: BrowserIncomingMessage = {
      type: "result",
      data: msg,
    };
    session.messageHistory.push(browserMsg);
    this.broadcastToBrowsers(session, browserMsg);
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
      if (session.state.permissionMode === "bypassPermissions") {
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
    }
  }

  private handleUserMessage(
    session: Session,
    msg: { type: "user_message"; content: string; session_id?: string; images?: { media_type: string; data: string }[] }
  ) {
    // Store user message in history for replay
    const ts = Date.now();
    session.messageHistory.push({
      type: "user_message",
      content: msg.content,
      timestamp: ts,
      id: `user-${ts}-${this.userMsgCounter++}`,
    });

    // Build content: if images are present, use content block array; otherwise plain string
    let content: string | unknown[];
    if (msg.images?.length) {
      const blocks: unknown[] = [];
      for (const img of msg.images) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
      blocks.push({ type: "text", text: msg.content });
      content = blocks;
    } else {
      content = msg.content;
    }

    const ndjson = JSON.stringify({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: msg.session_id || session.state.session_id || "",
    });
    this.sendToCLI(session, ndjson);
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
