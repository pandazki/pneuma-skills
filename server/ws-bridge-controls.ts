import { randomUUID } from "node:crypto";
import type {
  CLIControlResponseMessage,
} from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";

export function handleInterrupt(
  session: Session,
  sendToCLI: (session: Session, ndjson: string) => void,
): void {
  const ndjson = JSON.stringify({
    type: "control_request",
    request_id: randomUUID(),
    request: { subtype: "interrupt" },
  });
  sendToCLI(session, ndjson);
}

export function handleControlResponse(
  session: Session,
  msg: CLIControlResponseMessage,
  loggerWarn: (message: string) => void,
): void {
  const reqId = msg.response.request_id;
  const pending = session.pendingControlRequests.get(reqId);
  if (!pending) return;
  session.pendingControlRequests.delete(reqId);
  if (msg.response.subtype === "error") {
    loggerWarn(`[ws-bridge] Control request ${pending.subtype} failed: ${msg.response.error}`);
    return;
  }
  pending.resolve(msg.response.response ?? {});
}

export function sendControlRequest(
  session: Session,
  request: Record<string, unknown>,
  sendToCLI: (session: Session, ndjson: string) => void,
  onResponse?: { subtype: string; resolve: (response: unknown) => void },
): void {
  const requestId = randomUUID();
  if (onResponse) {
    session.pendingControlRequests.set(requestId, onResponse);
  }
  const ndjson = JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request,
  });
  sendToCLI(session, ndjson);
}
