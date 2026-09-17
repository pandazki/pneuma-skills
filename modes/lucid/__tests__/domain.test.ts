/**
 * The `Loops` aggregate — what the viewer sees.
 *
 * Three properties carry the weight:
 *
 *  - the KEY is the content-set directory, because one project is one loop
 *    (one dream, one scene, one score trajectory) and the project IS the
 *    content set. `a/b/lucid.json` is therefore not a project at all.
 *  - a broken sibling is SKIPPED, not thrown on. `lucid.json` is rewritten
 *    mid-loop while the viewer is watching it; one half-written or
 *    hand-edited project must not blank the roster for every other one.
 *  - what `lucid.mjs` writes must parse with ZERO warnings. The script is the
 *    only writer, so the two halves of the contract are pinned against each
 *    other here by running the real script rather than against a hand-typed
 *    fixture that could drift from it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  bestRound,
  budgetRemainingMinutes,
  loadLoops,
  LUCID_FORMAT,
  parseLoop,
  projectDirOf,
  saveLoops,
} from "../domain.js";
import { writePng } from "./fixtures/lucid/make-png.js";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "lucid.mjs");
const T = (minutes: number): string => new Date(Date.UTC(2026, 8, 16, 10, minutes)).toISOString();

const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

const files = (map: Record<string, string>): ViewerFileContent[] =>
  Object.entries(map).map(([path, content]) => ({ path, content }));

/** A minimal but complete `lucid.json`, as a string. */
function loopJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: LUCID_FORMAT,
    title: "Lantern Shrine",
    brief: "an isometric shrine courtyard at dusk",
    status: "looping",
    createdAt: T(0),
    updatedAt: T(20),
    fpsTarget: 60,
    budget: null,
    target: { path: "target.png", version: 1, lockedAt: T(5), history: [] },
    rounds: [],
    assets: [],
    evaluation: null,
    ...overrides,
  });
}

function round(index: number, total: number, extra: Record<string, unknown> = {}) {
  return {
    index,
    kind: "iterate",
    at: T(10 * index),
    capture: `rounds/0${index}/capture.png`,
    fps: 60,
    verdict: {
      composition: total / 4,
      lighting: total / 4,
      materials: total / 4,
      details: total / 4,
      total,
      gaps: [],
      judgedAt: T(10 * index),
    },
    ...extra,
  };
}

describe("projectDirOf", () => {
  test("a top-level directory is a content set; a nested one is not a project", () => {
    expect(projectDirOf("lucid.json")).toBe("");
    expect(projectDirOf("shrine/lucid.json")).toBe("shrine");
    expect(projectDirOf("a/b/lucid.json")).toBeNull();
    expect(projectDirOf(".trash/lucid.json")).toBeNull();
    expect(projectDirOf("shrine/scene/index.html")).toBeNull();
    expect(projectDirOf("shrine/rounds/01/verdict.json")).toBeNull();
  });
});

describe("loadLoops", () => {
  test("keys each project by its content-set directory, root included", () => {
    const loops = loadLoops(
      files({
        "shrine/lucid.json": loopJson(),
        "lucid.json": loopJson({ title: "Root Loop" }),
      }),
    )!;

    expect(Object.keys(loops.projects).sort()).toEqual(["", "shrine"]);
    expect(loops.projects[""].title).toBe("Root Loop");
    expect(loops.projects[""].dir).toBe("");
    expect(loops.projects.shrine.dir).toBe("shrine");
    expect(loops.projects.shrine.warnings).toEqual([]);
  });

  test("skips a broken sibling instead of blanking the roster", () => {
    const loops = loadLoops(
      files({
        "shrine/lucid.json": loopJson(),
        // Exactly what a reader sees mid-write: a truncated manifest.
        "half-written/lucid.json": loopJson().slice(0, 40),
        "not-ours/lucid.json": JSON.stringify({ hello: "world" }),
        "also-not-ours/lucid.json": JSON.stringify(["a", "list"]),
      }),
    )!;

    expect(Object.keys(loops.projects)).toEqual(["shrine"]);
  });

  test("ignores a nested lucid.json and every non-manifest file", () => {
    const loops = loadLoops(
      files({
        "a/b/lucid.json": loopJson(),
        "shrine/scene/index.html": "<!doctype html>",
        "shrine/rounds/01/verdict.json": "{}",
      }),
    )!;

    expect(loops.projects).toEqual({});
  });

  test("records what it had to default rather than failing or hiding it", () => {
    const stale = parseLoop("shrine", loopJson({ format: "pneuma-lucid/v0" }))!;
    expect(stale.format).toBe(LUCID_FORMAT);
    expect(stale.warnings).toEqual(['unknown format "pneuma-lucid/v0", read as pneuma-lucid/v1']);

    const odd = parseLoop("shrine", JSON.stringify({ format: LUCID_FORMAT, status: "vibing" }))!;
    expect(odd.status).toBe("dreaming");
    expect(odd.warnings).toEqual([
      'unknown status "vibing", shown as dreaming',
      "rounds missing, shown as none",
    ]);

    // Not a lucid project at all — no format string to trust.
    expect(parseLoop("shrine", JSON.stringify({ title: "x" }))).toBeNull();
    expect(parseLoop("shrine", "{not json")).toBeNull();
  });

  // `targetVersion` arrived after the first projects were written. A file from
  // before it could not have recorded a re-dream per round, so its rounds read
  // as the FIRST target's — which is exactly right for a project that was
  // never re-dreamed, and conservative (those verdicts stop counting) for one
  // that was. It is a default, not a defect: no warning.
  test("a project written before targetVersion reads as the first target's", () => {
    const legacy = parseLoop(
      "shrine",
      loopJson({
        rounds: [
          {
            index: 1,
            kind: "iterate",
            at: T(10),
            capture: "rounds/01/capture.png",
            fps: 60,
            verdict: { composition: 1, lighting: 1, materials: 1, details: 0.5, total: 3.5, gaps: [], judgedAt: T(10) },
          },
        ],
        evaluation: {
          exit: "continue",
          reasons: ["still gaining"],
          best: { index: 1, total: 3.5 },
          last: { index: 1, total: 3.5 },
          trend: [3.5],
          repeatedGaps: [],
          fpsOk: true,
          computedAt: T(10),
        },
      }),
    )!;

    expect(legacy.warnings).toEqual([]);
    expect(legacy.rounds[0].targetVersion).toBe(1);
    expect(legacy.evaluation!.targetVersion).toBe(1);
  });
});

describe("what lucid.mjs writes", () => {
  test("round-trips through parseLoop with zero warnings", () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "lucid-domain-")));
    workspaces.push(cwd);
    writePng(join(cwd, "dream.png"));
    writePng(join(cwd, "shot.png"), { width: 8, height: 6 });

    const lucid = (argv: string[], stdin?: string) => {
      const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
        cwd,
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(`lucid.mjs ${argv.join(" ")} failed:\n${result.stderr.toString()}`);
      }
      return JSON.parse(result.stdout.toString());
    };

    lucid(["init", "shrine", "--title", "Lantern Shrine", "--brief", "shrine at dusk",
      "--budget-minutes", "45", "--no-vendor", "--now", T(0)]);
    lucid(["target", "shrine", "--set", "dream.png", "--now", T(5)]);
    lucid(["asset", "shrine", "add", "--id", "lantern", "--role", "prop", "--source", "blender",
      "--files", "scene/models/lantern.glb", "--note", "hand-modelled", "--now", T(6)]);
    lucid(
      ["round", "shrine", "add", "--capture", "shot.png", "--fps", "58", "--verdict", "-", "--now", T(10)],
      JSON.stringify({
        composition: 1, lighting: 1, materials: 0.5, details: 0.2,
        summary: "far from the dream",
        gaps: [{ id: "flat-sky", area: "lighting", issue: "flat grey sky", fix: "grade the sky" }],
      }),
    );
    lucid(
      ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--kind", "rethink",
        "--note", "rebuilt the courtyard", "--verdict", "-", "--now", T(20)],
      JSON.stringify({
        composition: 2, lighting: 2, materials: 1.5, details: 0.5,
        gaps: [{ id: "flat-sky", area: "lighting", issue: "still flat", fix: "grade the sky" }],
      }),
    );

    const text = readFileSync(join(cwd, "shrine", "lucid.json"), "utf-8");
    const loop = parseLoop("shrine", text)!;

    expect(loop).not.toBeNull();
    expect(loop.warnings).toEqual([]);
    // Every field the parser reads is the one the script wrote — no silent
    // defaulting standing in for a value that never made it to disk.
    expect(loop).toMatchObject({
      format: LUCID_FORMAT,
      title: "Lantern Shrine",
      brief: "shrine at dusk",
      status: "looping",
      createdAt: T(0),
      updatedAt: T(20),
      fpsTarget: 60,
      // The budget clock started at init, not at the T(5) target lock.
      budget: { minutes: 45, startedAt: T(0) },
      target: { path: "target.png", version: 1, lockedAt: T(5), history: [] },
    });
    expect(loop.assets).toEqual([
      {
        id: "lantern",
        role: "prop",
        source: "blender",
        state: "planned",
        files: ["scene/models/lantern.glb"],
        note: "hand-modelled",
        updatedAt: T(6),
      },
    ]);
    expect(loop.rounds).toHaveLength(2);
    expect(loop.rounds[1]).toMatchObject({
      index: 2, kind: "rethink", targetVersion: 1, capture: "rounds/02/capture.png", fps: 60,
      note: "rebuilt the courtyard",
    });
    // The script writes the field; the parser is not standing in for it.
    expect(loop.rounds.map((r) => r.targetVersion)).toEqual([1, 1]);
    expect(loop.rounds[0].verdict).toMatchObject({ total: 2.7, judgedAt: T(10) });
    expect(loop.rounds[0].verdict!.gaps[0]).toEqual({
      id: "flat-sky", area: "lighting", issue: "flat grey sky", fix: "grade the sky",
    });
    // The evaluation the viewer displays is the one the script computed. The
    // rethink DID gain (2.7 -> 6.0), so this is not stalled — but the judge
    // named flat-sky twice running, which is a stall approaching.
    expect(loop.evaluation).toMatchObject({
      exit: "stall-approaching", targetVersion: 1, trend: [2.7, 6], repeatedGaps: ["flat-sky"],
      fpsOk: true, computedAt: T(20),
    });
    expect(loop.evaluation!.reasons).toEqual([
      "the judge named the same gap in two verdicts in a row: flat-sky",
    ]);
    expect(loop.evaluation!.best).toEqual({ index: 2, total: 6 });
    expect(loop.evaluation!.last).toEqual({ index: 2, total: 6 });

    // And through the aggregate loader, which is how the viewer gets it.
    const loops = loadLoops(files({ "shrine/lucid.json": text }))!;
    expect(loops.projects.shrine.warnings).toEqual([]);
    expect(loops.projects.shrine.rounds).toHaveLength(2);
  });
});

describe("budgetRemainingMinutes", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 16, 10, minutes));

  test("is null until a budget exists AND the clock has started", () => {
    const none = parseLoop("shrine", loopJson())!;
    expect(budgetRemainingMinutes(none, at(30))).toBeNull();

    const unstarted = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: null } }))!;
    expect(budgetRemainingMinutes(unstarted, at(30))).toBeNull();

    const broken = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: "soon" } }))!;
    expect(budgetRemainingMinutes(broken, at(30))).toBeNull();
  });

  test("counts down from the first target lock and never goes negative", () => {
    const loop = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: T(5) } }))!;
    expect(budgetRemainingMinutes(loop, at(5))).toBe(45);
    expect(budgetRemainingMinutes(loop, at(35))).toBe(15);
    expect(budgetRemainingMinutes(loop, at(50))).toBe(0);
    expect(budgetRemainingMinutes(loop, at(600))).toBe(0);
  });

  test("a credited pause gives the wall clock back", () => {
    const loop = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: T(5), pausedMinutes: 600 } }))!;
    expect(loop.budget).toEqual({ minutes: 45, startedAt: T(5), pausedMinutes: 600 });
    expect(budgetRemainingMinutes(loop, at(605))).toBe(45);
    expect(budgetRemainingMinutes(loop, at(635))).toBe(15);
    // A credit larger than the clock so far cannot mint time beyond the budget.
    expect(budgetRemainingMinutes(loop, at(100))).toBe(45);
    // Zero or junk credit reads as none.
    const none = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: T(5), pausedMinutes: 0 } }))!;
    expect(none.budget).toEqual({ minutes: 45, startedAt: T(5) });
    const junk = parseLoop("shrine", loopJson({ budget: { minutes: 45, startedAt: T(5), pausedMinutes: "lots" } }))!;
    expect(junk.budget).toEqual({ minutes: 45, startedAt: T(5) });
  });
});

describe("bestRound", () => {
  test("is the highest-scoring judged round, ignoring unjudged ones", () => {
    const loop = parseLoop(
      "shrine",
      loopJson({
        rounds: [
          round(1, 4),
          round(2, 7.5),
          round(3, 6),
          { index: 4, kind: "iterate", at: T(40), capture: null, fps: null, verdict: null },
        ],
      }),
    )!;
    expect(bestRound(loop)!.index).toBe(2);
  });

  test("keeps the earliest round on a tie, and is null before the first verdict", () => {
    const tied = parseLoop("shrine", loopJson({ rounds: [round(1, 6), round(2, 6)] }))!;
    expect(bestRound(tied)!.index).toBe(1);

    expect(bestRound(parseLoop("shrine", loopJson())!)).toBeNull();
    const unjudged = parseLoop(
      "shrine",
      loopJson({ rounds: [{ index: 1, kind: "iterate", at: T(10), capture: null, fps: null, verdict: null }] }),
    )!;
    expect(bestRound(unjudged)).toBeNull();
  });
});

describe("saveLoops", () => {
  test("refuses, because lucid.json has exactly one writer", () => {
    expect(() => saveLoops({ projects: {} }, [])).toThrow(/scripts\/lucid\.mjs/);
  });
});
