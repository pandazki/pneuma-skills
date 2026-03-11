/**
 * ws-bridge-codex — Codex adapter integration for WsBridge.
 *
 * When a Codex session is active, browser messages are routed through the
 * CodexAdapter instead of the CLI WebSocket. The adapter translates between
 * Codex JSON-RPC and the standard BrowserIncomingMessage format.
 */

import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  SessionState,
} from "./session-types.js";
import type { CodexAdapter } from "../backends/codex/codex-adapter.js";
import type { Session } from "./ws-bridge-types.js";

export interface CodexBridgeDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession?: (session: Session) => void;
}

/**
 * Attach CodexAdapter event handlers to a WsBridge session.
 *
 * Called when a Codex backend launches — the adapter emits browser-format
 * messages that get broadcast to connected browsers, just like Claude's
 * NDJSON path does.
 */
export function attachCodexAdapterHandlers(
  sessionId: string,
  session: Session,
  adapter: CodexAdapter,
  deps: CodexBridgeDeps,
): void {
  adapter.onBrowserMessage((msg) => {
    // Update session state for init/update messages
    if (msg.type === "session_init") {
      session.state = { ...session.state, ...msg.session, backend_type: "codex" };
      deps.persistSession?.(session);
    } else if (msg.type === "session_update") {
      session.state = { ...session.state, ...msg.session, backend_type: "codex" };
      deps.persistSession?.(session);
    } else if (msg.type === "status_change") {
      session.state.is_compacting = msg.status === "compacting";
      session.cliIdle = msg.status === "idle";
      deps.persistSession?.(session);
    }

    // Track message history for replay
    if (msg.type === "assistant") {
      const assistantMsg = { ...msg, timestamp: msg.timestamp || Date.now() };
      // Replace existing entry with same ID to avoid duplicates
      const msgId = (msg as { message?: { id?: string } }).message?.id;
      let existingIdx = -1;
      for (let i = session.messageHistory.length - 1; i >= 0; i--) {
        const h = session.messageHistory[i];
        if (h.type === "assistant" && (h as { message?: { id?: string } }).message?.id === msgId) {
          existingIdx = i;
          break;
        }
      }
      if (existingIdx !== -1) {
        session.messageHistory[existingIdx] = assistantMsg;
      } else {
        session.messageHistory.push(assistantMsg);
      }
      deps.persistSession?.(session);
    } else if (msg.type === "result") {
      session.messageHistory.push(msg);
      deps.persistSession?.(session);
    }

    // Track permission requests
    if (msg.type === "permission_request") {
      session.pendingPermissions.set(msg.request.request_id, msg.request);
      deps.persistSession?.(session);
    }

    // Broadcast to all connected browsers
    deps.broadcastToBrowsers(session, msg);
  });

  adapter.onDisconnect(() => {
    deps.broadcastToBrowsers(session, { type: "cli_disconnected" });
    // Cancel pending permissions
    for (const [reqId] of session.pendingPermissions) {
      deps.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
    }
    session.pendingPermissions.clear();
  });
}
