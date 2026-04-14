import { describe, test, expect } from "bun:test";
import type { Operation } from "@pneuma-craft/core";
import { formatOperation } from "../hooks/useClipProvenance.js";

function op(overrides: Partial<Operation>): Operation {
  return {
    type: "generate",
    actor: "agent",
    timestamp: 0,
    ...overrides,
  } as Operation;
}

describe("formatOperation", () => {
  test("generate includes model + truncated prompt", () => {
    const s = formatOperation(
      "Asset A",
      op({ type: "generate", params: { model: "sdxl", prompt: "a cat in a hat" } }),
    );
    expect(s).toBe('Asset A\ngenerate · sdxl · "a cat in a hat"');
  });

  test("truncates long prompts", () => {
    const long = "a".repeat(120);
    const s = formatOperation("X", op({ type: "generate", params: { prompt: long } }));
    expect(s.endsWith("…\"")).toBe(true);
    expect(s.length).toBeLessThan(long.length);
  });

  test("import falls back to filename", () => {
    const s = formatOperation(
      "Clip 1",
      op({ type: "import", params: { filename: "video.mp4" } }),
    );
    expect(s).toBe("Clip 1\nimport · video.mp4");
  });

  test("upload uses originalName when filename is missing", () => {
    const s = formatOperation(
      "Photo",
      op({ type: "upload", params: { originalName: "IMG_4492.jpg" } }),
    );
    expect(s).toBe("Photo\nupload · IMG_4492.jpg");
  });

  test("falls back to label then asset name", () => {
    const a = formatOperation("Name", op({ type: "import", label: "seed" }));
    expect(a).toBe("Name\nimport · seed");
    const b = formatOperation("Name", op({ type: "derive" }));
    expect(b).toBe("Name\nderive · Name");
  });
});
