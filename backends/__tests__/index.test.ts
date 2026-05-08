import { describe, expect, it } from "bun:test";
import {
  getBackendDescriptors,
  getBackendCapabilities,
  detectBackendAvailability,
} from "../index.js";

describe("kimi-cli backend registration", () => {
  it("appears in BACKEND_DESCRIPTORS as implemented", () => {
    const desc = getBackendDescriptors().find((d) => d.type === "kimi-cli");
    expect(desc).toBeDefined();
    expect(desc!.implemented).toBe(true);
    expect(desc!.label).toBe("Kimi");
  });

  it("declares capabilities", () => {
    const caps = getBackendCapabilities("kimi-cli");
    expect(caps).toEqual({
      streaming: true,
      resume: true,
      permissions: false,
      toolProgress: false,
      modelSwitch: true,
    });
  });

  it("declares its binary as 'kimi'", () => {
    const probes = detectBackendAvailability();
    const kimi = probes.find((p) => p.type === "kimi-cli");
    expect(kimi).toBeDefined();
    // We don't assert .available because PATH varies across CI
    if (!kimi!.available) {
      expect(kimi!.reason).toContain("kimi");
    }
  });
});
