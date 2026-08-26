export type PendingSteerUnavailableReason =
  | "unsupported"
  | "disconnected"
  | "idle"
  | "pending";

export function getPendingSteerAvailability(input: {
  supported: boolean;
  connected: boolean;
  busy: boolean;
  pending: boolean;
}): { enabled: boolean; reason: PendingSteerUnavailableReason | null } {
  if (!input.supported) return { enabled: false, reason: "unsupported" };
  if (!input.connected) return { enabled: false, reason: "disconnected" };
  if (!input.busy) return { enabled: false, reason: "idle" };
  if (input.pending) return { enabled: false, reason: "pending" };
  return { enabled: true, reason: null };
}

/**
 * Keep a queue row retryable when client-side enrichment or transport send
 * rejects before the server can return a steer_result acknowledgement.
 */
export async function deliverPendingSteer(
  deliver: () => Promise<boolean>,
  reject: () => void,
): Promise<void> {
  try {
    if (!await deliver()) reject();
  } catch (error) {
    console.error("[pneuma] failed to send queued steer-in", error);
    reject();
  }
}
