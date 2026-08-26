import { describe, expect, test } from "bun:test";
import { deliverPendingSteer, getPendingSteerAvailability } from "../pending-steer.js";

describe("getPendingSteerAvailability", () => {
  test("enables steer only for a supported connected backend with an active turn", () => {
    expect(getPendingSteerAvailability({ supported: true, connected: true, busy: true, pending: false }))
      .toEqual({ enabled: true, reason: null });
  });

  test("reports backend support before transient connection state", () => {
    expect(getPendingSteerAvailability({ supported: false, connected: false, busy: false, pending: false }))
      .toEqual({ enabled: false, reason: "unsupported" });
  });

  test("keeps a second click disabled while acknowledgement is pending", () => {
    expect(getPendingSteerAvailability({ supported: true, connected: true, busy: true, pending: true }))
      .toEqual({ enabled: false, reason: "pending" });
  });

  test("explains a disconnected supported backend", () => {
    expect(getPendingSteerAvailability({ supported: true, connected: false, busy: true, pending: false }))
      .toEqual({ enabled: false, reason: "disconnected" });
  });

  test("explains that steer needs an active turn", () => {
    expect(getPendingSteerAvailability({ supported: true, connected: true, busy: false, pending: false }))
      .toEqual({ enabled: false, reason: "idle" });
  });
});

describe("deliverPendingSteer", () => {
  test("clears pending state when client-side preparation rejects", async () => {
    let rejected = 0;
    const originalError = console.error;
    console.error = () => {};
    try {
      await deliverPendingSteer(
        async () => { throw new Error("viewer enrichment failed"); },
        () => { rejected += 1; },
      );
    } finally {
      console.error = originalError;
    }
    expect(rejected).toBe(1);
  });

  test("clears pending state when the socket did not deliver", async () => {
    let rejected = 0;
    await deliverPendingSteer(async () => false, () => { rejected += 1; });
    expect(rejected).toBe(1);
  });
});
