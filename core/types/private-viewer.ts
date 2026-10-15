import type { CollaborationReferenceSource } from "./collaboration-reference.js";
import type { ViewerActionResult } from "./viewer-contract.js";

/** A runtime UUID for one mounted private Session viewer, never a room actor. */
export type PrivateViewerInstanceId = string;

/** UUIDv4 also works on plain-HTTP LAN origins where randomUUID is unavailable. */
export function createPrivateViewerInstanceId(random: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = crypto): PrivateViewerInstanceId {
  if (typeof random.randomUUID === "function") return random.randomUUID();
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isPrivateViewerInstanceId(value: unknown): value is PrivateViewerInstanceId {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type PrivateViewerOutgoingMessage =
  | { type: "viewer_instance_register"; viewer_instance_id: PrivateViewerInstanceId }
  | { type: "viewer_instance_unregister"; viewer_instance_id: PrivateViewerInstanceId }
  | { type: "viewer_action_response"; viewer_instance_id: PrivateViewerInstanceId; request_id: string; result: ViewerActionResult };

export type PrivateViewerIncomingMessage =
  | { type: "viewer_instance_registered"; viewer_instance_id: PrivateViewerInstanceId; success: boolean; message?: string }
  | { type: "viewer_action_request"; viewer_instance_id: PrivateViewerInstanceId; request_id: string; action_id: string; params?: Record<string, unknown> };

/** Shared publication scope is reserved and explicitly unsupported by private capture.
 * Local capture proves mount ownership/navigation outcome, not immutable revision bytes.
 */
export interface PrivateViewerCaptureParams extends Record<string, unknown> {
  publicationReference?: CollaborationReferenceSource;
}
