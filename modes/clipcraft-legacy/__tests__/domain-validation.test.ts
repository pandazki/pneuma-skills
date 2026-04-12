import { describe, test, expect } from "bun:test";
import { validateGraphNodes, validateFullGraph, validateStoryboard } from "../domain-validation.js";
import type { GraphNode, AssetGraph } from "../types.js";

describe("validateGraphNodes", () => {
  test("accepts valid nodes", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now(), source: "assets/images/test.png" },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(true);
  });

  test("rejects node with missing id", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes = { "x": { kind: "image", status: "ready", parentId: null, createdAt: Date.now() } } as any;
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("id");
  });

  test("rejects node with invalid kind", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes = { "node-1": { id: "node-1", kind: "pdf", status: "ready", parentId: null, createdAt: Date.now() } } as any;
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
  });

  test("rejects node with orphaned parentId", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "video", status: "ready", parentId: "nonexistent", createdAt: Date.now() },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("parentId");
  });

  test("allows parentId referencing node in same batch", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now() },
      "node-2": { id: "node-2", kind: "video", status: "ready", parentId: "node-1", createdAt: Date.now() },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(true);
  });

  test("rejects source path not under assets/", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now(), source: "../../../etc/passwd" },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("source");
  });
});

describe("validateStoryboard", () => {
  const graph: AssetGraph = {
    version: 1,
    nodes: {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now() },
      "node-2": { id: "node-2", kind: "video", status: "ready", parentId: "node-1", createdAt: Date.now() },
    },
  };

  test("accepts valid storyboard", () => {
    const clips = [
      { id: "clip-001", order: 1, duration: 5, visual: { rootNodeId: "node-1", selectedNodeId: "node-2" }, audio: null, caption: null, transition: { type: "cut" as const, duration: 0 } },
    ];
    const result = validateStoryboard({ clips }, graph);
    expect(result.ok).toBe(true);
  });

  test("rejects binding to nonexistent node", () => {
    const clips = [
      { id: "clip-001", order: 1, duration: 5, visual: { rootNodeId: "node-1", selectedNodeId: "missing" }, audio: null, caption: null, transition: { type: "cut" as const, duration: 0 } },
    ];
    const result = validateStoryboard({ clips }, graph);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("missing");
  });
});
