/**
 * Projection-workflow merge-report guard.
 *
 * The workflow script is plain JS evaluated by the Workflow runner as an
 * async function body (top-level `await` and top-level `return`), with
 * `args` / `agent` / `parallel` / `phase` / `log` injected as globals.
 * These tests drive the SHIPPED script text through a stub runner with
 * the same contract, so the orchestration logic is pinned rather than
 * merely read:
 *
 *   - `parallel()` never rejects — a throwing thunk resolves to `null`.
 *   - `agent()` resolves to `null` when a subagent dies or is skipped.
 *
 * Those two facts are exactly why a partition used to be able to vanish
 * between Extract and Merge without a trace. Everything below pins that
 * it can no longer do so.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = join(import.meta.dir, "..", "skill", "references", "projection.workflow.js");

type AgentResult = unknown;
/** Stub responder: decide what a given agent label returns. */
type Responder = (label: string, prompt: string) => AgentResult;

interface PartitionReport {
  id: string;
  label: string;
  status: "ok" | "empty" | "duplicate-only" | "failed";
  retried: boolean;
  nodesEmitted: number;
  nodesAdded: number;
  edgesEmitted: number;
  edgesAdded: number;
}

interface DroppedEdge {
  source: string;
  target: string;
  type: string;
  missing: string[];
}

interface WorkflowResult {
  nodes: Array<{ id: string; trust?: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  layers: Array<{ id: string }>;
  stats: {
    trust: Record<string, number>;
    droppedEdges: number;
    partitions: PartitionReport[];
    droppedEdgeDetail: DroppedEdge[];
    droppedEdgeDetailTruncated?: number;
    warnings: string[];
  };
}

function node(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "module",
    name: id,
    summary: `${id} does a thing.`,
    sources: [{ kind: "file", path: `${id}.ts` }],
    ...extra,
  };
}

/** Verdicts for exactly the nodes the verify prompt listed. */
function verdictsFor(prompt: string, trust = "verified") {
  const ids = [...prompt.matchAll(/^- (\S+) \[/gm)].map((m) => m[1]);
  return { verdicts: ids.map((nodeId) => ({ nodeId, trust, reason: "stub" })) };
}

/** Shape-appropriate empties for every stage the tests don't drive. */
function defaultResponse(label: string, prompt: string): AgentResult {
  if (label === "cross-edges") return { edges: [] };
  if (label.startsWith("verify:")) return verdictsFor(prompt);
  if (label.startsWith("critic:")) return { gaps: [] };
  if (label === "propose") return { perspectives: [] };
  return null;
}

async function runWorkflow(args: unknown, respond: Responder) {
  const src = readFileSync(WORKFLOW, "utf8").replace(/^export const meta = /m, "const meta = ");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...a: string[]
  ) => (...a: unknown[]) => Promise<unknown>;
  const body = new AsyncFunction("args", "agent", "parallel", "phase", "log", src);

  const logs: string[] = [];
  const labels: string[] = [];
  const agent = async (prompt: string, opts: { label: string }) => {
    labels.push(opts.label);
    const explicit = respond(opts.label, prompt);
    return explicit === undefined ? defaultResponse(opts.label, prompt) : explicit;
  };
  // Mirrors the runner: a thunk that throws resolves to null, and the
  // call itself never rejects.
  const parallel = async (thunks: Array<() => Promise<unknown>>) =>
    Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));

  const result = (await body(args, agent, parallel, () => {}, (m: string) =>
    logs.push(m),
  )) as WorkflowResult;
  return { result, logs, labels };
}

const BASE_ARGS = {
  sourceRoot: "/repo",
  projectName: "repo",
  partitions: [{ id: "alpha", paths: ["alpha/"] }],
  layers: [{ id: "core", label: "Core" }],
};

function reportFor(result: WorkflowResult, id: string): PartitionReport {
  const rec = result.stats.partitions.find((p) => p.id === id);
  if (!rec) throw new Error(`no partition report for "${id}"`);
  return rec;
}

describe("preconditions", () => {
  test("a missing sourceRoot or partition list fails loudly rather than projecting nothing", async () => {
    await expect(runWorkflow({ partitions: [{ id: "a", paths: ["a/"] }] }, () => null)).rejects.toThrow(
      /sourceRoot is required/,
    );
    await expect(runWorkflow({ sourceRoot: "/repo" }, () => null)).rejects.toThrow(/partitions\[\] is required/);
  });

  test("duplicate partition ids fail before any tokens are spent", async () => {
    // Two slices sharing an id would collapse into one ledger row and
    // make the merge report understate the loss.
    const args = {
      sourceRoot: "/repo",
      partitions: [
        { id: "alpha", paths: ["a/"] },
        { id: "alpha", paths: ["b/"] },
      ],
    };
    let spawned = 0;
    await expect(
      runWorkflow(args, () => {
        spawned++;
        return null;
      }),
    ).rejects.toThrow(/duplicate ids \(alpha\)/);
    expect(spawned).toBe(0);
  });
});

describe("a partition never disappears silently", () => {
  test("a dead extract subagent is re-dispatched once and its recovery lands", async () => {
    const { result, labels } = await runWorkflow(BASE_ARGS, (label) => {
      // `agent()` resolving to null is how the runner reports a subagent
      // that died or was skipped — the case that used to vanish.
      if (label === "extract:alpha") return null;
      if (label === "retry:alpha") return { nodes: [node("a-one")], edges: [] };
      return undefined;
    });

    expect(labels).toContain("retry:alpha");
    expect(result.nodes.map((n) => n.id)).toEqual(["a-one"]);

    const rec = reportFor(result, "alpha");
    expect(rec.status).toBe("ok");
    expect(rec.retried).toBe(true);
    expect(rec.nodesAdded).toBe(1);
    // Recovered means recovered: nothing to warn about.
    expect(result.stats.warnings).toEqual([]);
  });

  test("a thrown extract thunk is also re-dispatched", async () => {
    const { result, labels } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") throw new Error("subagent exploded");
      if (label === "retry:alpha") return { nodes: [node("a-one")], edges: [] };
      return undefined;
    });

    expect(labels).toContain("retry:alpha");
    expect(reportFor(result, "alpha").status).toBe("ok");
    expect(result.nodes).toHaveLength(1);
  });

  test("a partition still empty after its retry is reported, not absorbed", async () => {
    const { result, labels } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha" || label === "retry:alpha") return { nodes: [], edges: [] };
      return undefined;
    });

    expect(labels.filter((l) => l === "retry:alpha")).toHaveLength(1); // exactly one retry
    const rec = reportFor(result, "alpha");
    expect(rec.status).toBe("empty");
    expect(rec.retried).toBe(true);
    expect(result.stats.warnings.some((w) => w.includes('"alpha"') && w.includes("0 nodes"))).toBe(true);
  });

  test("the retry happens once, never twice", async () => {
    const { labels } = await runWorkflow(BASE_ARGS, (label) => {
      if (label.startsWith("extract:") || label.startsWith("retry:")) return null;
      return undefined;
    });
    expect(labels.filter((l) => l.startsWith("retry:"))).toEqual(["retry:alpha"]);
    // A partition that never returned at all still ends up in the report.
  });

  test("a partition that never returns is reported as failed", async () => {
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label.startsWith("extract:") || label.startsWith("retry:")) return null;
      return undefined;
    });
    const rec = reportFor(result, "alpha");
    expect(rec.status).toBe("failed");
    expect(rec.retried).toBe(true);
    expect(result.stats.warnings.some((w) => w.includes('"alpha"') && w.includes("never returned"))).toBe(true);
  });
});

describe("a dedup loser is reported but not retried", () => {
  const args = {
    ...BASE_ARGS,
    partitions: [
      { id: "alpha", paths: ["alpha/"] },
      { id: "beta", paths: ["beta/"] },
    ],
  };

  test("emitting nodes that another slice already claimed is 'duplicate-only', and gets no retry", async () => {
    const { result, labels } = await runWorkflow(args, (label) => {
      // Both slices claim the same id; whoever loses the dedup added 0.
      if (label === "extract:alpha") return { nodes: [node("shared")], edges: [] };
      if (label === "extract:beta") return { nodes: [node("shared")], edges: [] };
      return undefined;
    });

    // Re-running a dedup loser only reproduces the duplicates.
    expect(labels.filter((l) => l.startsWith("retry:"))).toEqual([]);

    const statuses = result.stats.partitions.map((p) => p.status).sort();
    expect(statuses).toEqual(["duplicate-only", "ok"]);

    const loser = result.stats.partitions.find((p) => p.status === "duplicate-only")!;
    expect(loser.nodesEmitted).toBe(1);
    expect(loser.nodesAdded).toBe(0);
    expect(loser.retried).toBe(false);
    expect(result.stats.warnings.some((w) => w.includes(loser.id) && w.includes("overlap"))).toBe(true);
    expect(result.nodes).toHaveLength(1);
  });
});

describe("dropped edges leave with the id that went missing", () => {
  test("a dangling endpoint is itemised, counted, and warned about", async () => {
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") {
        return {
          nodes: [node("a-one"), node("a-two")],
          edges: [
            { source: "a-one", target: "a-two", type: "calls" },
            { source: "a-one", target: "ghost", type: "imports" },
          ],
        };
      }
      return undefined;
    });

    expect(result.edges).toEqual([{ source: "a-one", target: "a-two", type: "calls" }]);
    expect(result.stats.droppedEdges).toBe(1);
    expect(result.stats.droppedEdgeDetail).toEqual([
      { source: "a-one", target: "ghost", type: "imports", missing: ["ghost"] },
    ]);
    expect(result.stats.warnings.some((w) => w.includes("endpoint never materialised"))).toBe(true);
  });

  test("the itemised list is capped and the truncation is declared, never silent", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      source: "a-one",
      target: `ghost-${i}`,
      type: "imports",
    }));
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") return { nodes: [node("a-one")], edges: many };
      return undefined;
    });

    expect(result.stats.droppedEdges).toBe(60);
    expect(result.stats.droppedEdgeDetail).toHaveLength(50);
    expect(result.stats.droppedEdgeDetailTruncated).toBe(10);
  });

  test("an edge whose endpoint the completeness loop supplies is kept, not dropped", async () => {
    let asked = 0;
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") {
        return {
          nodes: [node("a-one")],
          edges: [{ source: "a-one", target: "late", type: "imports" }],
        };
      }
      if (label.startsWith("critic:")) {
        // Name a gap on the first round only, so the loop converges.
        return asked++ === 0
          ? { gaps: [{ area: "late", why: "missing", suggestedFocus: ["late.ts"] }] }
          : { gaps: [] };
      }
      if (label.startsWith("fill:")) return { nodes: [node("late")], edges: [] };
      return undefined;
    });

    // The drop is deliberately deferred until after the completeness
    // loop, so a late-arriving node rescues its edge.
    expect(result.stats.droppedEdges).toBe(0);
    expect(result.edges).toEqual([{ source: "a-one", target: "late", type: "imports" }]);
  });
});

describe("a clean run is distinguishable from a lossy one", () => {
  test("a partition that declared no id still gets verified, not shipped unrated", async () => {
    // `partitionOfNode` is keyed by the ledger id (the array index when
    // no id was declared); batching verify off `partitions[].id` would
    // match nothing here.
    const { result } = await runWorkflow(
      { sourceRoot: "/repo", partitions: [{ paths: ["alpha/"] }] },
      (label) => (label === "extract:0" ? { nodes: [node("a-one")], edges: [] } : undefined),
    );
    expect(result.stats.trust).toEqual({ verified: 1 });
    expect(result.stats.warnings).toEqual([]);
  });

  test("everything landing yields an empty warnings list", async () => {
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") {
        return {
          nodes: [node("a-one", { layerId: "core" }), node("a-two", { layerId: "core" })],
          edges: [{ source: "a-one", target: "a-two", type: "calls" }],
        };
      }
      return undefined;
    });

    expect(result.stats.warnings).toEqual([]);
    expect(reportFor(result, "alpha").status).toBe("ok");
    expect(result.stats.trust).toEqual({ verified: 2 });
    expect(result.layers.map((l) => l.id)).toEqual(["core"]);
  });

  test("nodes that come back without a verdict are called out, not passed off as verified", async () => {
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") return { nodes: [node("a-one"), node("a-two")], edges: [] };
      if (label.startsWith("verify:")) return { verdicts: [{ nodeId: "a-one", trust: "verified", reason: "x" }] };
      return undefined;
    });

    expect(result.stats.trust).toEqual({ verified: 1, unrated: 1 });
    expect(result.stats.warnings.some((w) => w.includes("ship unrated"))).toBe(true);
  });

  test("a dead cross-edge pass is surfaced instead of passing for 'no cross-edges found'", async () => {
    const { result } = await runWorkflow(BASE_ARGS, (label) => {
      if (label === "extract:alpha") return { nodes: [node("a-one")], edges: [] };
      if (label === "cross-edges") return null;
      return undefined;
    });

    expect(result.stats.warnings.some((w) => w.includes("cross-partition edge pass"))).toBe(true);
  });
});
