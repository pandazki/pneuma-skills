import type { ServerWebSocket } from "bun";
import type { BrowserSocketData, Session, SocketData } from "./ws-bridge-types.js";
import type {
  BrowserIncomingMessage,
  ReplayableBrowserIncomingMessage,
} from "./session-types.js";

/**
 * Infer the CLI's current status from server-side session state.
 * Used as a ground-truth correction after event replay to prevent
 * stale "running"/"generating" state when `result` was pruned from
 * the event buffer.
 */
function inferCliStatus(session: Session): "idle" | "running" | "compacting" | null {
  if (session.state.is_compacting) return "compacting";
  const last = session.messageHistory[session.messageHistory.length - 1];
  if (!last) return "idle";
  if (last.type === "result") return "idle";
  if (last.type === "assistant") return "running";
  return "idle";
}

export function handleSessionSubscribe(
  session: Session,
  ws: ServerWebSocket<SocketData> | undefined,
  lastSeq: number,
  sendToBrowser: (ws: ServerWebSocket<SocketData>, msg: BrowserIncomingMessage) => void,
  isHistoryBackedEvent: (msg: ReplayableBrowserIncomingMessage) => boolean,
): void {
  if (!ws) return;
  const data = ws.data as BrowserSocketData;
  data.subscribed = true;
  const lastAckSeq = Number.isFinite(lastSeq) ? Math.max(0, Math.floor(lastSeq)) : 0;
  data.lastAckSeq = lastAckSeq;

  if (session.eventBuffer.length === 0) return;
  if (lastAckSeq >= session.nextEventSeq - 1) return;

  const earliest = session.eventBuffer[0]?.seq ?? session.nextEventSeq;
  const hasGap = lastAckSeq > 0 && lastAckSeq < earliest - 1;
  if (hasGap) {
    sendToBrowser(ws, {
      type: "message_history",
      messages: session.messageHistory,
    });
    const transientMissed = session.eventBuffer
      .filter((evt) => evt.seq > lastAckSeq && !isHistoryBackedEvent(evt.message));
    if (transientMissed.length > 0) {
      sendToBrowser(ws, {
        type: "event_replay",
        events: transientMissed,
      });
    }
    sendToBrowser(ws, { type: "status_change", status: inferCliStatus(session) });
    return;
  }

  // No-gap path: browser is current on the seq counter (or never received
  // any events yet). Fast-forward the transient ones. History-backed events
  // (assistant / result / user_message / etc.) are excluded because the
  // initial `session_init → message_history` already carried them; double-
  // sending here causes the chat to render duplicate user-injected tags
  // (e.g. two `<pneuma:env>` pills on a fresh session — once via
  // message_history and again via this event_replay).
  const missed = session.eventBuffer.filter(
    (evt) => evt.seq > lastAckSeq && !isHistoryBackedEvent(evt.message),
  );
  if (missed.length > 0) {
    sendToBrowser(ws, {
      type: "event_replay",
      events: missed,
    });
  }
  // Status_change is independent of whether transient events were replayed —
  // a fresh subscriber needs the current cli status either way (so the
  // chat input enables/disables the Send button correctly).
  sendToBrowser(ws, { type: "status_change", status: inferCliStatus(session) });
}

export function handleSessionAck(
  session: Session,
  ws: ServerWebSocket<SocketData> | undefined,
  lastSeq: number,
): void {
  const normalized = Number.isFinite(lastSeq) ? Math.max(0, Math.floor(lastSeq)) : 0;
  if (ws) {
    const data = ws.data as BrowserSocketData;
    const prior = typeof data.lastAckSeq === "number" ? data.lastAckSeq : 0;
    data.lastAckSeq = Math.max(prior, normalized);
  }
  if (normalized > session.lastAckSeq) {
    session.lastAckSeq = normalized;
  }
}

export function handlePermissionResponse(
  session: Session,
  msg: {
    type: "permission_response";
    request_id: string;
    behavior: "allow" | "deny";
    updated_input?: Record<string, unknown>;
    updated_permissions?: unknown[];
    message?: string;
  },
  sendToCLI: (session: Session, ndjson: string) => void,
): void {
  const pending = session.pendingPermissions.get(msg.request_id);
  session.pendingPermissions.delete(msg.request_id);

  // Compatibility shim for Claude Code 2.x AskUserQuestion: the CLI does not
  // send a can_use_tool gate for AskUserQuestion any more (it auto-denies
  // the tool with an is_error tool_result before the user can pick). The WS
  // bridge fabricates a synthetic perm in handleAssistantMessage so the
  // picker still renders. Here we translate the user's submission into a
  // plain user message; the agent reads it as a natural-language follow-up
  // after seeing the auto-deny.
  if (msg.request_id.startsWith("synthetic:") && pending) {
    // Picker resolved — close the post-auto-deny suppression window so
    // the model's reply to the follow-up answer flows through normally.
    session.suppressingPostAskq = false;
    const ndjson = buildAskUserQuestionFollowupMessage(session, pending, msg);
    sendToCLI(session, ndjson);
    return;
  }

  if (msg.behavior === "allow") {
    const response: Record<string, unknown> = {
      behavior: "allow",
      updatedInput: msg.updated_input ?? pending?.input ?? {},
    };
    if (msg.updated_permissions?.length) {
      response.updatedPermissions = msg.updated_permissions;
    }
    const ndjson = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: msg.request_id,
        response,
      },
    });
    sendToCLI(session, ndjson);
  } else {
    const ndjson = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: msg.request_id,
        response: {
          behavior: "deny",
          message: msg.message || "Denied by user",
        },
      },
    });
    sendToCLI(session, ndjson);
  }
}

function buildAskUserQuestionFollowupMessage(
  session: Session,
  pending: import("./session-types.js").PermissionRequest,
  msg: {
    behavior: "allow" | "deny";
    updated_input?: Record<string, unknown>;
    message?: string;
  },
): string {
  const indexedAnswers = (msg.updated_input?.answers ?? {}) as Record<string, string>;
  const questions = Array.isArray(pending.input.questions)
    ? (pending.input.questions as Array<Record<string, unknown>>)
    : [];

  let bodyText: string;
  if (msg.behavior === "deny") {
    bodyText = msg.message || "User declined to answer.";
  } else if (questions.length > 0) {
    const lines = questions.map((q, i) => {
      const qText = typeof q.question === "string" ? q.question : "";
      const ans = indexedAnswers[String(i)] ?? "(no option selected)";
      return `- "${qText}" → "${ans}"`;
    });
    bodyText = lines.join("\n");
  } else {
    const fallbackQ = typeof pending.input.question === "string" ? pending.input.question : "(question)";
    const fallbackA = Object.values(indexedAnswers).join(", ") || "(no answer)";
    bodyText = `- "${fallbackQ}" → "${fallbackA}"`;
  }

  // Wrap in a recognisable tag the agent can pattern-match. The leading
  // <pneuma:askq-answer> hint is harmless natural language; an agent that
  // ignores tags still understands the structure from the bullet list.
  // tool_use_id comes from the upstream CLI but is interpolated into an
  // attribute value, so escape `&`, `<`, and `"` to keep the wrapper
  // well-formed even if a future CLI starts emitting unusual characters.
  const escapedToolUseId = pending.tool_use_id
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
  const content =
`<pneuma:askq-answer tool_use_id="${escapedToolUseId}">
The picker UI in the chat panel captured the user's answer. Disregard the prior \`AskUserQuestion\` is_error tool_result ("Answer questions?") — that was the SDK's auto-deny in non-interactive mode, not a real failure. Continue based on this answer:

${bodyText}
</pneuma:askq-answer>`;

  return JSON.stringify({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: session.state.session_id || "",
  });
}

