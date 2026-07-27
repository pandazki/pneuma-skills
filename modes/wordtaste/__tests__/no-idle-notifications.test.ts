import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VIEWER = readFileSync(
  join(import.meta.dir, "..", "viewer", "WordtastePreview.tsx"),
  "utf8",
);

describe("viewer notification discipline", () => {
  it("has one notification emission site, inside the explicit command helper", () => {
    expect(VIEWER.split("onNotifyAgent({").length - 1).toBe(1);
    expect(VIEWER).toContain("const fireCommand = useCallback");
  });

  it("does not emit old feedback-loop or automatic direction notifications", () => {
    expect(VIEWER).not.toContain('type: "readability-check"');
    expect(VIEWER).not.toContain('type: "request-directions"');
  });

  it("does not put internal symptom/rung controls back into the viewer", () => {
    expect(VIEWER).not.toContain("set-ladder");
    expect(VIEWER).not.toContain("poke-symptom");
    expect(VIEWER).not.toContain("set-block-frozen");
    expect(VIEWER).not.toMatch(/\bS[1-7]\b/);
  });
});
