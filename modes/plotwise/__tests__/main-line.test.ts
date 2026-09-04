/**
 * The main line is derived from parent links, never read off path[] as
 * written: the director's bookkeeping was short of the truth in the first
 * live course (path ["n2b"] — no root, and the segment on stage missing),
 * and the rail drew a flat list of every segment in file order with no
 * way to continue.
 */

import { describe, expect, test } from "bun:test";
import type { CourseNode } from "../domain.js";
import { ancestorChain, mainLine } from "../viewer/mainLine.js";

function node(id: string, parent: string | undefined, children: string[] = []): CourseNode {
  return {
    id,
    parent,
    kind: "main",
    script: "",
    clips: [],
    evidence: [],
    status: "ready",
    children: children.map((nodeId) => ({ nodeId, label: `to ${nodeId}` })),
  };
}

const nodes = {
  n1: node("n1", undefined, ["n2a", "n2b"]),
  n2a: node("n2a", "n1"),
  n2b: node("n2b", "n1", ["n3a", "n3b"]),
  n3a: node("n3a", "n2b"),
  n3b: node("n3b", "n2b"),
};

describe("mainLine", () => {
  test("a path missing its root still draws the whole line", () => {
    const line = mainLine({ nodes, path: ["n2b"], rootNode: "n1" });
    expect(line.tip).toBe("n2b");
    expect(line.spine).toEqual(["n1", "n2b"]);
    expect(line.next.map((c) => c.nodeId)).toEqual(["n3a", "n3b"]);
  });

  test("the tip is the latest recorded segment that exists", () => {
    const line = mainLine({ nodes, path: ["n1", "n2b", "n3b", "ghost"], rootNode: "n1" });
    expect(line.tip).toBe("n3b");
    expect(line.spine).toEqual(["n1", "n2b", "n3b"]);
    expect(line.next).toEqual([]);
  });

  test("taking the other branch later moves the line, not the history", () => {
    const line = mainLine({ nodes, path: ["n1", "n2b", "n3b", "n2a"], rootNode: "n1" });
    expect(line.spine).toEqual(["n1", "n2a"]);
  });

  test("nothing recorded yet: the line is the root alone", () => {
    const line = mainLine({ nodes, path: [], rootNode: "n1" });
    expect(line.spine).toEqual(["n1"]);
    expect(line.next.map((c) => c.nodeId)).toEqual(["n2a", "n2b"]);
  });

  test("no root at all: an empty line, not a crash", () => {
    expect(mainLine({ nodes: {}, path: [], rootNode: "n1" })).toEqual({ tip: null, spine: [], next: [] });
  });

  test("ancestorChain stops at a cycle", () => {
    const loop = { a: node("a", "b"), b: node("b", "a") };
    expect(ancestorChain(loop, "a")).toEqual(["b", "a"]);
  });
});
