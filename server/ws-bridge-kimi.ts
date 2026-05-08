/**
 * ws-bridge-kimi — KimiAdapter integration for WsBridge.
 *
 * The adapter emits Pneuma-shape messages (already translated from kimi
 * NDJSON); this module wraps them in the same `assistant` / `user` envelope
 * the Claude path uses, broadcasts to connected browsers, and maintains the
 * session's idle/busy bookkeeping. Mirror of `ws-bridge-codex.ts`, scoped to
 * the smaller capability surface (no permission flow, no tool_progress).
 */

import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";
import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import type { PneumaMessage } from "../backends/kimi-cli/protocol.js";
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";

export interface KimiBridgeDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession?: (session: Session) => void;
  workspace?: string;
}

/**
 * Attach KimiAdapter event handlers to a WsBridge session.
 *
 * Called when a Kimi backend launches — adapter callbacks emit Pneuma-shape
 * messages; we wrap each in the standard `assistant` / `user` envelope and
 * broadcast it, plus flip the session's `cliIdle` flag so a joining browser
 * (and the post-turn snapshot path) reflects whether the agent is mid-turn.
 */
export function attachKimiAdapterHandlers(
  sessionId: string,
  session: Session,
  adapter: KimiAdapter,
  deps: KimiBridgeDeps,
): void {
  adapter.onMessage((pneuma: PneumaMessage) => {
    if (pneuma.type === "assistant") {
      const browserMsg: BrowserIncomingMessage = {
        type: "assistant",
        message: {
          id: `kimi-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "message",
          role: "assistant",
          model: session.state.model || "kimi",
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
      session.messageHistory.push(browserMsg);
      deps.persistSession?.(session);
      deps.broadcastToBrowsers(session, browserMsg);

      // Idle bookkeeping: an assistant turn whose last block isn't tool_use
      // means the model has yielded back to the user. tool_use means kimi is
      // still working (a tool_result message will follow).
      const lastBlock = pneuma.content[pneuma.content.length - 1];
      const yielded = !lastBlock || lastBlock.type !== "tool_use";
      session.cliIdle = yielded;
      deps.broadcastToBrowsers(session, {
        type: "session_update",
        session: { ...session.state, cli_busy: !yielded },
      });

      if (yielded && deps.workspace && isShadowGitAvailable(deps.workspace)) {
        const turnIndex = session.state.num_turns ?? 0;
        enqueueCheckpoint(deps.workspace, turnIndex);
      }
      return;
    }

    // Pneuma `user` message — kimi emits these for `tool_result` echoes after
    // a tool call. Surface as a chat user_message so the timeline stays
    // coherent; the frontend renders these via the standard user path.
    if (pneuma.type === "user") {
      // tool_result rounds keep us mid-turn until the next assistant message.
      session.cliIdle = false;
      const text = pneuma.content
        .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content : ""))
        .filter((s) => s.length > 0)
        .join("\n");
      const browserMsg: BrowserIncomingMessage = {
        type: "user_message",
        content: text,
        timestamp: Date.now(),
      };
      session.messageHistory.push(browserMsg);
      deps.persistSession?.(session);
      deps.broadcastToBrowsers(session, browserMsg);
      return;
    }
  });

  adapter.onDisconnect(() => {
    deps.broadcastToBrowsers(session, { type: "cli_disconnected" });
    for (const [reqId] of session.pendingPermissions) {
      deps.broadcastToBrowsers(session, { type: "permission_cancelled", request_id: reqId });
    }
    session.pendingPermissions.clear();
  });
}
