#!/usr/bin/env bun
/**
 * Project a validated plan into the viewer's workflow.json.
 *
 * Usage:
 *   bun project_plan.ts <plan.json> <workflow.json>
 *
 * Run it only after `validate_plan.ts` has accepted the plan: everything this
 * script copies into the viewer is either a verbatim quote from the material
 * or one of the fixed labels below.
 *
 * The two label maps are the reason this step is a script and not a prompt: a
 * reader has to recognise what a unit is for, and the only Chinese allowed to
 * say that is Chinese written once, here, in code. The viewer's
 * `studio-logic.ts` maps are test-pinned equal to these.
 *
 * The full plan is stored under `layout.plan` so a later unit can be composed
 * from workflow.json alone. Every other top-level field of workflow.json is
 * preserved, and the rewrite is atomic: a staged file replaces the original
 * in one move.
 *
 * Output: nothing on success.
 *
 * Exit codes:
 *   0  — projected
 *   2  — usage error, or a missing/invalid input
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileNonEmpty } from "./lib/compose.ts";

export const ROLE_LABELS: Record<string, string> = {
  background: "交代背景",
  problem: "把问题摆到读者面前",
  reasoning: "一步一步讲道理",
  conclusion: "说出结论",
  close: "收尾",
};

export const PACE_LABELS: Record<string, string> = {
  dense: "密",
  loose: "疏",
  mixed: "疏密相间",
};

export const ENDS_LABELS: Record<string, string> = {
  stop: "说完就停",
  open: "留个口",
};

function fail(message: string): never {
  process.stderr.write(`wordtaste: plan projection — ${message}\n`);
  process.exit(2);
}

type Raw = Record<string, unknown>;

interface RawSpan {
  from?: string;
  to?: string;
}

interface RawUnit {
  id: string;
  role: string;
  pace: string;
  ends: string;
  target_chars: number;
  spans?: RawSpan[];
  must_keep?: string[];
}

function unitBrief(unit: RawUnit): string {
  const spans = unit.spans ?? [];
  if (spans.length > 0) {
    const span = spans[0]!;
    const to = span.to ?? "";
    return to === "" ? `${span.from} …` : `${span.from} … ${to}`;
  }
  const keeps = unit.must_keep ?? [];
  if (keeps.length > 0) return `必须保住的 ${keeps.length} 句`;
  return ROLE_LABELS[unit.role] ?? unit.role;
}

function main(): void {
  const [planFile, workflowFile] = process.argv.slice(2);
  if (process.argv.length - 2 !== 2 || !planFile || !workflowFile) {
    fail("usage: project_plan.ts <plan.json> <workflow.json>");
  }
  for (const required of [planFile, workflowFile]) {
    if (!fileNonEmpty(required)) fail("required input is missing");
  }

  let plan: Raw;
  let workflow: Raw;
  try {
    plan = JSON.parse(readFileSync(planFile, "utf8")) as Raw;
    workflow = JSON.parse(readFileSync(workflowFile, "utf8")) as Raw;
  } catch {
    fail("required input is not valid JSON");
  }
  if (!Array.isArray(plan.units) || plan.units.length < 1) {
    fail("the plan has no units");
  }

  const units = plan.units as RawUnit[];
  const claims = (plan.claims ?? []) as Array<{ text: string }>;
  const next = {
    ...workflow,
    stage: "layout",
    layout: {
      title: plan.title,
      thesis: claims.map((claim) => claim.text),
      units: units.map((unit) => ({
        id: unit.id,
        role: ROLE_LABELS[unit.role] ?? unit.role,
        brief: unitBrief(unit),
        rhythm: `${PACE_LABELS[unit.pace] ?? ""}，${ENDS_LABELS[unit.ends] ?? ""}`,
        targetChars: unit.target_chars,
      })),
      openQuestion: plan.open_question ?? "",
      plan,
    },
  };

  // A failed write must not leave a half-written staging file beside
  // workflow.json: the next reader would find a stray .tmp in the content set.
  const staged = `${workflowFile}.tmp.${process.pid}`;
  try {
    writeFileSync(staged, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(staged, workflowFile);
  } finally {
    rmSync(staged, { force: true });
  }
}

if (import.meta.main) main();
