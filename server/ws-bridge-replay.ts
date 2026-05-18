import type {
  BrowserIncomingMessage,
  ReplayableBrowserIncomingMessage,
} from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";

export function isDuplicateClientMessage(session: Session, clientMsgId: string): boolean {
  return session.processedClientMessageIdSet.has(clientMsgId);
}

export function rememberClientMessage(
  session: Session,
  clientMsgId: string,
  processedClientMsgIdLimit: number,
): void {
  session.processedClientMessageIds.push(clientMsgId);
  session.processedClientMessageIdSet.add(clientMsgId);
  if (session.processedClientMessageIds.length > processedClientMsgIdLimit) {
    const overflow = session.processedClientMessageIds.length - processedClientMsgIdLimit;
    const removed = session.processedClientMessageIds.splice(0, overflow);
    for (const id of removed) {
      session.processedClientMessageIdSet.delete(id);
    }
  }
}

export function shouldBufferForReplay(
  msg: BrowserIncomingMessage,
): msg is ReplayableBrowserIncomingMessage {
  return msg.type !== "session_init"
    && msg.type !== "message_history"
    && msg.type !== "event_replay"
    && msg.type !== "permission_request"
    && msg.type !== "permission_cancelled"
    // Streaming text deltas are pure animation — once the final `assistant`
    // event lands in messageHistory the user sees the completed text. We
    // already exclude `assistant` itself from event_replay (it's in
    // message_history). If we keep the upstream `stream_event` partials
    // buffered too, an initial connect replays them and accumulates the
    // browser's `streaming` state — but the matching terminator (assistant /
    // result) is filtered out, so the streaming bubble never clears.
    // Symptom: ghost duplicate of the last reply with a blinking cursor.
    && msg.type !== "stream_event";
}

export function isHistoryBackedEvent(msg: ReplayableBrowserIncomingMessage): boolean {
  return msg.type === "assistant"
    || msg.type === "result"
    || msg.type === "user_message"
    || (msg.type === "system_event" && msg.event.subtype !== "hook_progress")
    || msg.type === "error";
}

export function sequenceEvent(
  session: Session,
  msg: BrowserIncomingMessage,
  eventBufferLimit: number,
): BrowserIncomingMessage {
  const seq = session.nextEventSeq++;
  const sequenced = { ...msg, seq };
  if (shouldBufferForReplay(msg)) {
    session.eventBuffer.push({ seq, message: msg });
    if (session.eventBuffer.length > eventBufferLimit) {
      session.eventBuffer.splice(0, session.eventBuffer.length - eventBufferLimit);
    }
  }
  return sequenced;
}
