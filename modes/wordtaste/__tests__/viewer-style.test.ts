import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const viewer = readFileSync(
  join(import.meta.dir, "..", "viewer", "WordtastePreview.tsx"),
  "utf8",
);

describe("WordTaste viewer chrome", () => {
  it("does not let the control reset override component typography", () => {
    expect(viewer).not.toContain(
      ".wordtaste-v2 button, .wordtaste-v2 textarea, .wordtaste-v2 select { font: inherit; }",
    );
    expect(viewer).toContain(
      ".wordtaste-v2 button, .wordtaste-v2 textarea, .wordtaste-v2 select { font-family: inherit; }",
    );
  });

  it("keeps model-family readiness out of the reader-facing header", () => {
    expect(viewer).not.toContain("writing voices ready");
    expect(viewer).not.toContain("wordtaste-family-count");
  });

  it("light-dismisses the selection menu without swallowing its own actions", () => {
    expect(viewer).toContain(
      'document.addEventListener("pointerdown", handlePointerDown, true)',
    );
    expect(viewer).toContain("event.composedPath().includes(menu)");
    expect(viewer).toContain(
      'document.removeEventListener("pointerdown", handlePointerDown, true)',
    );
  });
});
