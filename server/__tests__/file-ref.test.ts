import { describe, expect, it } from "bun:test";
import { stampFileRefs } from "../file-ref.js";
import type { ContentBlock } from "../session-types.js";

describe("stampFileRefs", () => {
  it("stamps fileRef on a recognized tool_use (claude-code)", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "reading" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/w/a.png" } },
    ];
    stampFileRefs(content, "claude-code");
    const tu = content[1] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("leaves non-file tool_use blocks untouched", () => {
    const content: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
    ];
    stampFileRefs(content, "claude-code");
    const tu = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toBeUndefined();
  });
  it("is a no-op for content with no tool_use blocks", () => {
    const content: ContentBlock[] = [{ type: "text", text: "hi" }];
    expect(() => stampFileRefs(content, "codex")).not.toThrow();
  });
  it("works for codex (Edit with file_path)", () => {
    const content: ContentBlock[] = [
      { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/w/main.ts" } },
    ];
    stampFileRefs(content, "codex");
    const tu = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
    expect(tu.fileRef).toEqual({ path: "/w/main.ts", kind: "edit" });
  });
});
