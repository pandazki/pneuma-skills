import { describe, expect, it } from "bun:test";
import { defaultToolFileRef } from "../tool-file-ref.js";

describe("defaultToolFileRef", () => {
  it("maps Read to kind=read with file_path", () => {
    expect(defaultToolFileRef("Read", { file_path: "/w/a.png" })).toEqual({ path: "/w/a.png", kind: "read" });
  });
  it("maps Write to kind=write", () => {
    expect(defaultToolFileRef("Write", { file_path: "/w/a.ts", content: "x" })).toEqual({ path: "/w/a.ts", kind: "write" });
  });
  it("maps Edit to kind=edit", () => {
    expect(defaultToolFileRef("Edit", { file_path: "/w/a.ts" })).toEqual({ path: "/w/a.ts", kind: "edit" });
  });
  it("maps NotebookEdit to kind=edit, accepts notebook_path", () => {
    expect(defaultToolFileRef("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual({ path: "/w/n.ipynb", kind: "edit" });
  });
  it("returns undefined for unknown tool names", () => {
    expect(defaultToolFileRef("Bash", { command: "cat a.png" })).toBeUndefined();
    expect(defaultToolFileRef("Grep", { pattern: "x" })).toBeUndefined();
  });
  it("returns undefined when no path present or path is not a non-empty string", () => {
    expect(defaultToolFileRef("Read", {})).toBeUndefined();
    expect(defaultToolFileRef("Read", { file_path: "" })).toBeUndefined();
    expect(defaultToolFileRef("Read", { file_path: 123 })).toBeUndefined();
  });
});
