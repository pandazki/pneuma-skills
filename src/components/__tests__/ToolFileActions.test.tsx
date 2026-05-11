import { describe, it, expect } from "bun:test";
import { LAST_EDITOR_STORAGE_KEY } from "../ToolFileActions.js";

describe("ToolFileActions", () => {
  it("exposes a stable localStorage key for the remembered editor", () => {
    // The key is part of the persistence contract — keep it stable.
    expect(LAST_EDITOR_STORAGE_KEY).toBe("pneuma:default-editor");
  });
  it("module exports the named ToolFileActions component", async () => {
    const mod = await import("../ToolFileActions.js");
    expect(typeof mod.ToolFileActions).toBe("function");
  });
});
