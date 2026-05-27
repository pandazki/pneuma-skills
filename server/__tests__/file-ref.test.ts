import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("stampFileRefs — tool_result image mining", () => {
  let workspace: string;
  let captureA: string;
  let captureB: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "pneuma-file-ref-output-"));
    captureA = join(workspace, "captures", "capture-a.png");
    captureB = join(workspace, "captures", "capture-b.jpg");
    require("node:fs").mkdirSync(join(workspace, "captures"), { recursive: true });
    writeFileSync(captureA, "fakepng");
    writeFileSync(captureB, "fakejpg");
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("stamps fileRefs for absolute image paths inside the workspace", () => {
    const text = `Done.\n{"success":true,"data":{"path":"${captureA}","width":1280,"height":988}}`;
    const content: ContentBlock[] = [
      { type: "tool_result", tool_use_id: "t1", content: text },
    ];
    stampFileRefs(content, "codex", workspace);
    const tr = content[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(tr.fileRefs).toEqual([{ path: captureA, kind: "output" }]);
  });

  it("dedupes the same path mentioned twice + collects multiple distinct paths", () => {
    const text = `first ${captureA} then ${captureB} also ${captureA} again`;
    const content: ContentBlock[] = [
      { type: "tool_result", tool_use_id: "t1", content: text },
    ];
    stampFileRefs(content, "codex", workspace);
    const tr = content[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(tr.fileRefs).toEqual([
      { path: captureA, kind: "output" },
      { path: captureB, kind: "output" },
    ]);
  });

  it("skips paths outside the workspace and paths that don't exist", () => {
    const outside = "/Users/elsewhere/foreign.png";
    const stale = join(workspace, "captures", "deleted.png");
    const text = `out ${outside} stale ${stale}`;
    const content: ContentBlock[] = [
      { type: "tool_result", tool_use_id: "t1", content: text },
    ];
    stampFileRefs(content, "codex", workspace);
    const tr = content[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(tr.fileRefs).toBeUndefined();
  });

  it("no-ops when workspace is not provided (legacy callers)", () => {
    const content: ContentBlock[] = [
      { type: "tool_result", tool_use_id: "t1", content: `here ${captureA}` },
    ];
    stampFileRefs(content, "codex");
    const tr = content[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(tr.fileRefs).toBeUndefined();
  });
});
