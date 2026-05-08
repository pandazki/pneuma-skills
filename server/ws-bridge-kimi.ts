/**
 * ws-bridge-kimi — KimiAdapter integration for WsBridge.
 *
 * The adapter emits Pneuma-shape messages (already translated from kimi
 * NDJSON); this module wraps each as the standard `assistant` envelope the
 * frontend already knows how to render and broadcasts it. Both kimi's
 * `assistant` (text + tool_use) AND `tool` (tool_result) outputs ride the
 * `assistant` envelope on the way to the browser — the chat panel pairs
 * tool_use / tool_result by `tool_use_id` and renders the result with the
 * compact BashResultBlock / scrollable card styling, NOT as a giant prose
 * bubble. (See `src/components/ChatPanel.tsx:buildGlobalToolUseMap` and the
 * codex-mirroring rationale documented there.)
 *
 * Kimi's stream-json has no `result` envelope or `system.init` envelope, so
 * we synthesise both:
 *   - `session_init` is broadcast at attach time by `WsBridge.attachKimiAdapter`
 *     (one shot, with model + capabilities).
 *   - `result` is synthesised here on every turn yield (assistant message
 *     whose last content block isn't `tool_use`). Without it the frontend's
 *     `sessionStatus` never flips back to "idle" and the input stays disabled
 *     behind a "queue" placeholder.
 */

import { randomBytes } from "node:crypto";
import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";
import type { KimiAdapter } from "../backends/kimi-cli/kimi-adapter.js";
import type { PneumaMessage } from "../backends/kimi-cli/protocol.js";
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";

export interface KimiBridgeDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  workspace?: string;
}

function shortId(): string {
  return randomBytes(3).toString("hex");
}

export function attachKimiAdapterHandlers(
  sessionId: string,
  session: Session,
  adapter: KimiAdapter,
  deps: KimiBridgeDeps,
): void {
  // Track when the current turn started so the synthesised `result` envelope
  // carries a sensible duration for the cost / token UI (we have no real
  // timing data — kimi's stream-json doesn't surface it).
  let turnStartedAt: number | null = null;

  adapter.onMessage((pneuma: PneumaMessage) => {
    if (turnStartedAt === null) turnStartedAt = Date.now();

    // Both assistant and tool_result messages get the `assistant` envelope.
    // The chat panel walks every assistant message's content blocks once to
    // build a global tool_use_id → tool_use map, so a `tool_result` block
    // arriving in a separate message still pairs with its tool_use card.
    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: `kimi-${sessionId}-${Date.now()}-${shortId()}`,
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
    session.messageHistory.push(assistantMsg);
    deps.broadcastToBrowsers(session, assistantMsg);

    // Idle bookkeeping — a turn yields when:
    //   1. the message originated from kimi's `assistant` role (NOT a tool_result), AND
    //   2. its last content block isn't `tool_use` (kimi is calling another tool).
    // Tool_result messages always keep the session busy because the next
    // event will be either another tool round or the wrap-up assistant turn.
    const lastBlock = pneuma.content[pneuma.content.length - 1];
    const isToolResultMsg = pneuma.type === "user";
    const lastIsToolUse = !!lastBlock && lastBlock.type === "tool_use";
    const yielded = !isToolResultMsg && !lastIsToolUse;

    if (!yielded) {
      session.cliIdle = false;
      // Push the busy snapshot so a browser that joined mid-turn (or one
      // catching up after reconnect) sees a fresh `cli_busy: true`.
      deps.broadcastToBrowsers(session, {
        type: "session_update",
        session: { ...session.state, cli_busy: true },
      });
      return;
    }

    // Turn yielded — tally num_turns, broadcast `result` so the frontend
    // flips `sessionStatus` to "idle" and `turnInProgress` to false (the
    // `result` case in `src/ws.ts` is the canonical end-of-turn signal),
    // then push the idle session snapshot.
    const numTurns = (session.state.num_turns ?? 0) + 1;
    session.state.num_turns = numTurns;
    session.cliIdle = true;
    const durationMs = turnStartedAt ? Date.now() - turnStartedAt : 0;
    turnStartedAt = null;

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
        session_id: sessionId,
      },
    };
    session.messageHistory.push(resultMsg);
    deps.broadcastToBrowsers(session, resultMsg);
    deps.broadcastToBrowsers(session, {
      type: "session_update",
      session: { ...session.state, cli_busy: false },
    });

    if (deps.workspace && isShadowGitAvailable(deps.workspace)) {
      enqueueCheckpoint(deps.workspace, numTurns - 1);
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
