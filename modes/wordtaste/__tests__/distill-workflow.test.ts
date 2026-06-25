/**
 * Distill workflow guard — pins the `distill` dynamic Workflow artifact.
 *
 * The workflow runs as sandboxed plain JS under the Claude Code Workflow
 * runtime: its only legal escapes are the injected globals
 * (`agent`/`parallel`/`pipeline`/`phase`/`log`/`args`/`budget`) and `meta`.
 * It therefore cannot be `import`ed here (top-level `await agent(...)`
 * references globals that don't exist in bun:test). So this suite pins it
 * two ways, mirroring cosmos's `schema.test.ts` text-based approach:
 *
 *   1. STRUCTURE — read the file as text and assert the harness launch
 *      contract (meta literal first, required keys, declared phases) plus
 *      the determinism/sandbox bans (no Date.now / Math.random / bare
 *      `new Date()` / require / process.*). These are exactly what the
 *      Workflow harness rejects at launch / throws at runtime.
 *
 *   2. PURE LOGIC — the GEPA-style anti-drift core (parse past verdicts,
 *      score a candidate rubric by how well a judge reproduced them, and
 *      Pareto-select the survivors) is fenced between named markers and is
 *      free of injected globals, so it is extracted and executed in
 *      isolation. This tests the *shipped* logic, not a copy, so it can't
 *      drift from the artifact.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = join(
  import.meta.dir,
  "..",
  "skill",
  "workflows",
  "distill.workflow.js",
);

function source(): string {
  return readFileSync(WORKFLOW, "utf8");
}

// ── Pure-logic extraction ────────────────────────────────────────────────────
// The deterministic anti-drift helpers live between these markers and touch
// none of the injected globals, so we can eval them in isolation and call them
// directly. Extract → wrap as a module body that returns the helper table.

const PURE_START = "// pneuma:pure:start";
const PURE_END = "// pneuma:pure:end";

interface VerdictRecord {
  index: number;
  raw: Record<string, unknown>;
  decision: string | null;
  prefer: string | null;
  symptoms: string[];
}
interface PureHelpers {
  parseVerdicts: (prefsJsonl: string) => VerdictRecord[];
  shouldValidate: (verdicts: VerdictRecord[]) => boolean;
  scoreCandidate: (
    agreements: Array<{ verdictIndex: number; agree: boolean }>,
    total: number,
  ) => number;
  paretoSurvivors: <T extends { score: number; coverage: number }>(
    candidates: T[],
  ) => T[];
}

function loadPureHelpers(): PureHelpers {
  const src = source();
  const start = src.indexOf(PURE_START);
  const end = src.indexOf(PURE_END);
  if (start < 0 || end <= start) {
    throw new Error(
      "distill.workflow.js is missing the // pneuma:pure:start / :end markers",
    );
  }
  const body = src.slice(start + PURE_START.length, end);
  // Wrap the marker region as a function body that returns the helper table.
  // The region declares plain `function` helpers; we hand back the ones the
  // workflow (and this test) rely on.
  const factory = new Function(
    `${body}\nreturn { parseVerdicts, shouldValidate, scoreCandidate, paretoSurvivors };`,
  );
  return factory() as PureHelpers;
}

// ── 1. STRUCTURE / launch contract ───────────────────────────────────────────

describe("distill.workflow.js — launch contract", () => {
  it("opens with the meta literal as the first statement", () => {
    const src = source().replace(/^﻿/, "");
    // First non-comment, non-blank line must begin the meta export.
    const firstCode = src
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
    expect(firstCode).toBe("export const meta = {");
  });

  it("declares name + description + the four distill phases", () => {
    const src = source();
    // meta.name / meta.description present as string literals.
    expect(/name:\s*['"]wordtaste-distill['"]/.test(src)).toBe(true);
    expect(/description:\s*['"]/.test(src)).toBe(true);
    // The §10 step names appear as declared phases.
    for (const title of ["Gather", "Reflect", "Validate", "Commit"]) {
      expect(src.includes(`title: '${title}'`) || src.includes(`title: "${title}"`)).toBe(true);
    }
  });

  it("uses each declared phase via phase()/opts.phase so progress groups resolve", () => {
    const src = source();
    for (const title of ["Gather", "Reflect", "Validate", "Commit"]) {
      // Either a global phase('X') or an opts phase: 'X' references it.
      const referenced =
        src.includes(`phase('${title}')`) ||
        src.includes(`phase("${title}")`) ||
        src.includes(`phase: '${title}'`) ||
        src.includes(`phase: "${title}"`);
      expect(referenced).toBe(true);
    }
  });
});

describe("distill.workflow.js — determinism + sandbox bans", () => {
  const src = source();
  // Strip block + line comments before scanning so prose explaining the bans
  // (e.g. "never call Date.now()") doesn't trip the guard.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  it("contains no wall-clock / randomness that would break resume", () => {
    expect(code.includes("Date.now(")).toBe(false);
    expect(code.includes("Math.random(")).toBe(false);
    // bare `new Date()` (no argument) is banned; `new Date(x)` is fine.
    expect(/new Date\(\s*\)/.test(code)).toBe(false);
    expect(/(^|[^.\w])Date\(\s*\)/.test(code)).toBe(false);
  });

  it("contains no sandbox-forbidden escapes (require / node builtins / process)", () => {
    expect(/\brequire\s*\(/.test(code)).toBe(false);
    expect(/\bprocess\./.test(code)).toBe(false);
    expect(/from\s+['"]node:/.test(code)).toBe(false);
    expect(/\bimport\s+[^.]/.test(code.replace(/import\.meta/g, ""))).toBe(false);
  });

  it("passes thunks (not bare promises) to parallel()", () => {
    // Every parallel(...) argument should map to arrow thunks `() =>`.
    // A bare `parallel(somePromiseArray)` is the known anti-pattern.
    const calls = [...src.matchAll(/parallel\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    // The reflect fan-out maps over candidate specs to () => agent(...).
    expect(/\.map\(\s*\([^)]*\)\s*=>\s*\(\)\s*=>/.test(src)).toBe(true);
  });
});

// ── 2. PURE LOGIC — the anti-drift core ───────────────────────────────────────

describe("distill.workflow.js — parseVerdicts", () => {
  const H = loadPureHelpers();

  it("parses one record per non-blank jsonl line, tolerating junk lines", () => {
    const jsonl =
      '{"event":"reject","verdict":"both-obviously-AI","prefer":"gpt>claude","symptom_tags":["s2"]}\n' +
      "\n" +
      "not json at all\n" +
      '{"event":"better","verdict":"明显更好","symptom_tags":[]}\n';
    const verdicts = H.parseVerdicts(jsonl);
    // Two well-formed records survive; the blank + junk lines are skipped.
    expect(verdicts.length).toBe(2);
    expect(verdicts[0].decision).toBe("reject");
    expect(verdicts[0].prefer).toBe("gpt>claude");
    expect(verdicts[0].symptoms).toEqual(["s2"]);
    expect(verdicts[1].decision).toBe("better");
  });

  it("only counts records that carry an actual judgment signal as verdicts", () => {
    // A line with neither event/verdict/prefer is not a usable past verdict.
    const jsonl =
      '{"ts":"2026-01-01","note":"just a note"}\n' +
      '{"event":"accept-ish","verdict":"还可以"}\n';
    const verdicts = H.parseVerdicts(jsonl);
    expect(verdicts.length).toBe(1);
    expect(verdicts[0].decision).toBe("accept-ish");
  });

  it("parses the shipped worked-example prefs.log without throwing", () => {
    const prefs = readFileSync(
      join(import.meta.dir, "..", "seed", "worked-example", "taste", "prefs.log.jsonl"),
      "utf8",
    );
    const verdicts = H.parseVerdicts(prefs);
    // The worked example has 12 judgment-bearing lines.
    expect(verdicts.length).toBe(12);
    // Real preference signal is captured (one line records prefer:"gpt>claude").
    expect(verdicts.some((v) => v.prefer === "gpt>claude")).toBe(true);
  });
});

describe("distill.workflow.js — shouldValidate (n<2 degradation gate)", () => {
  const H = loadPureHelpers();

  it("degrades validate when fewer than 2 past verdicts exist", () => {
    expect(H.shouldValidate([])).toBe(false);
    expect(
      H.shouldValidate(H.parseVerdicts('{"event":"reject"}\n')),
    ).toBe(false);
  });

  it("enables validate once there are at least 2 past verdicts", () => {
    const two = H.parseVerdicts('{"event":"reject"}\n{"event":"better"}\n');
    expect(H.shouldValidate(two)).toBe(true);
  });
});

describe("distill.workflow.js — scoreCandidate (verdict-reproduction agreement)", () => {
  const H = loadPureHelpers();

  it("scores fraction of past verdicts the candidate's judge reproduced", () => {
    // 3 of 4 known verdicts reproduced → 0.75.
    const agreements = [
      { verdictIndex: 0, agree: true },
      { verdictIndex: 1, agree: false },
      { verdictIndex: 2, agree: true },
      { verdictIndex: 3, agree: true },
    ];
    expect(H.scoreCandidate(agreements, 4)).toBeCloseTo(0.75, 5);
  });

  it("a candidate that reproduces nothing scores 0; perfect reproduction scores 1", () => {
    expect(
      H.scoreCandidate([{ verdictIndex: 0, agree: false }], 1),
    ).toBe(0);
    expect(
      H.scoreCandidate([{ verdictIndex: 0, agree: true }], 1),
    ).toBe(1);
  });

  it("guards against division by zero (no verdicts → score 0)", () => {
    expect(H.scoreCandidate([], 0)).toBe(0);
  });
});

describe("distill.workflow.js — paretoSurvivors (anti-drift selection)", () => {
  const H = loadPureHelpers();

  it("drops a candidate strictly dominated on both score and coverage", () => {
    const cands = [
      { id: "a", score: 0.9, coverage: 0.8 },
      { id: "b", score: 0.5, coverage: 0.4 }, // dominated by a
      { id: "c", score: 0.6, coverage: 0.95 }, // not dominated (better coverage)
    ];
    const survivors = H.paretoSurvivors(cands);
    const ids = survivors.map((s) => (s as { id: string }).id).sort();
    expect(ids).toEqual(["a", "c"]);
  });

  it("keeps the single candidate when only one is given", () => {
    const cands = [{ id: "only", score: 0.3, coverage: 0.3 }];
    expect(H.paretoSurvivors(cands).length).toBe(1);
  });

  it("keeps both when neither dominates (equal score, equal coverage are co-optimal)", () => {
    const cands = [
      { id: "x", score: 0.7, coverage: 0.7 },
      { id: "y", score: 0.7, coverage: 0.7 },
    ];
    expect(H.paretoSurvivors(cands).length).toBe(2);
  });
});
