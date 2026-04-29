import { describe, expect, test } from "bun:test";
import { parseFrontmatterBody, parseHandoffMarkdown } from "../handoff-parser.js";

const validRaw = `---
handoff_id: hf-1
target_mode: webcraft
target_session: auto
source_session: src
source_mode: doc
intent: build site
suggested_files:
  - file-a.md
  - file-b.md
created_at: 2026-04-27T00:00:00Z
---

# Handoff body

Important content.
`;

describe("parseHandoffMarkdown", () => {
  test("parses well-formed handoff", () => {
    const result = parseHandoffMarkdown("/x/h.md", validRaw);
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/x/h.md");
    expect(result!.frontmatter.handoff_id).toBe("hf-1");
    expect(result!.frontmatter.target_mode).toBe("webcraft");
    expect(result!.frontmatter.suggested_files).toEqual(["file-a.md", "file-b.md"]);
    expect(result!.body).toContain("Important content");
  });

  test("returns null on missing frontmatter delimiter", () => {
    expect(parseHandoffMarkdown("/x", "no frontmatter here")).toBeNull();
  });

  test("returns null when required keys missing", () => {
    expect(
      parseHandoffMarkdown("/x", "---\ntarget_mode: webcraft\n---\nbody"),
    ).toBeNull();
  });

  test("tolerates quoted scalars", () => {
    const raw = `---\nhandoff_id: hf-q\ntarget_mode: "webcraft"\ntarget_session: 'auto'\n---\nbody`;
    const result = parseHandoffMarkdown("/x", raw);
    expect(result!.frontmatter.target_mode).toBe("webcraft");
    expect(result!.frontmatter.target_session).toBe("auto");
  });
});

describe("parseFrontmatterBody", () => {
  test("parses scalar and list fields", () => {
    const body = `handoff_id: x\ntarget_mode: y\nsuggested_files:\n  - a\n  - b`;
    const fm = parseFrontmatterBody(body);
    expect(fm).not.toBeNull();
    expect(fm!.suggested_files).toEqual(["a", "b"]);
  });
});
