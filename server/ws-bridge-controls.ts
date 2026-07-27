import { randomUUID } from "node:crypto";
import type {
  CLIControlResponseMessage,
} from "./session-types.js";
import type { PendingControlRequest, Session } from "./ws-bridge-types.js";

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
    pending.reject?.(msg.response.error ?? "unknown error");
    return;
  }
  pending.resolve(msg.response.response ?? {});
}

/**
 * One entry of the `models` array in the Claude Code CLI's `initialize`
 * control response. `value` is the id to send back on `set_model` (often an
 * alias such as `opus` or `default`), `resolvedModel` the concrete model it
 * resolves to. Only the fields the switcher needs are typed here — the CLI
 * also reports effort/thinking capabilities we don't surface yet.
 */
interface ClaudeInitializeModel {
  value?: unknown;
  resolvedModel?: unknown;
  displayName?: unknown;
}

/**
 * Normalize the `models` array of an `initialize` control response into the
 * `available_models` shape the browser model switcher consumes.
 *
 * Returns `null` when the response carries no usable list — a CLI too old to
 * report one, or a malformed payload. Callers keep the manifest's static
 * `defaultModels` fallback in that case rather than blanking the picker.
 */
export function parseSupportedModels(
  response: unknown,
): { id: string; name?: string; resolvedId?: string }[] | null {
  const models = (response as { models?: unknown } | null | undefined)?.models;
  if (!Array.isArray(models)) return null;

  const parsed: { id: string; name?: string; resolvedId?: string }[] = [];
  for (const entry of models as ClaudeInitializeModel[]) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.value === "string" ? entry.value : undefined;
    if (!id) continue;
    const name = typeof entry.displayName === "string" ? entry.displayName : undefined;
    const resolvedId = typeof entry.resolvedModel === "string" ? entry.resolvedModel : undefined;
    parsed.push({
      id,
      ...(name ? { name } : {}),
      ...(resolvedId && resolvedId !== id ? { resolvedId } : {}),
    });
  }
  return parsed.length > 0 ? parsed : null;
}

export function sendControlRequest(
  session: Session,
  request: Record<string, unknown>,
  sendToCLI: (session: Session, ndjson: string) => void,
  onResponse?: PendingControlRequest,
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
