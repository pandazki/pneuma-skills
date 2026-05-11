import { describe, it, expect } from "bun:test";

describe("ImageLightbox", () => {
  it("module exports the named ImageLightbox component", async () => {
    const mod = await import("../ImageLightbox.js");
    expect(typeof mod.ImageLightbox).toBe("function");
  });
});
