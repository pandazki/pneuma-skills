#!/usr/bin/env bun
/**
 * Deterministic check-brief composer.
 *
 * Usage:
 *   bun compose_check_brief.ts <workflow.json> <unit-id|whole> <out-file>
 *
 * Produces the brief that `run_check_cycle.ts` takes as its `<brief>`
 * argument. The rubric is `references/judge-brief.md` rendered as English
 * rules, read from `references/prompt-scaffolding.en.json` under
 * `check_rubric` and assembled by `lib/prompt-assembly.ts` — the same
 * sentences the Claude Workflow path assembles. The only Chinese in the brief
 * is the plan's own `must_keep` sentences, verbatim quotes from the author's
 * material.
 *
 * `<out-file>` must live under `.pneuma/private/`: `run_check_cycle.ts`
 * refuses a brief anywhere else.
 *
 * Output: nothing on success.
 *
 * Exit codes:
 *   0  — composed
 *   2  — usage error, no stored plan, or unknown unit id
 */

import { readFileSync } from "node:fs";
import { fileNonEmpty, loadScaffolding, writePromptFile } from "./lib/compose.ts";
import {
  assembleCheckBrief,
  hasCheckScaffolding,
  type PlanUnit,
  type Scaffolding,
} from "./lib/prompt-assembly.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: check brief — ${message}\n`);
  process.exit(2);
}

/** The stored plan's units, or null when workflow.json carries no plan. */
export function storedPlanUnits(workflowText: string): PlanUnit[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const layout = (parsed as Record<string, unknown>).layout;
  if (typeof layout !== "object" || layout === null) return null;
  const plan = (layout as Record<string, unknown>).plan;
  if (typeof plan !== "object" || plan === null) return null;
  const units = (plan as Record<string, unknown>).units;
  if (!Array.isArray(units)) return null;
  return units as PlanUnit[];
}

function main(): void {
  const [workflowFile, scope, outFile] = process.argv.slice(2);
  if (process.argv.length - 2 !== 3 || !workflowFile || !scope || !outFile) {
    fail("usage: compose_check_brief.ts <workflow.json> <unit-id|whole> <out-file>");
  }

  const scaffold = loadScaffolding();
  if (scaffold === null || !hasCheckScaffolding(scaffold)) {
    fail("the English scaffolding file is missing or incomplete");
  }
  const S = scaffold as unknown as Scaffolding;

  if (!fileNonEmpty(workflowFile)) fail("workflow.json is missing or invalid");
  const workflowText = readFileSync(workflowFile, "utf8");
  try {
    JSON.parse(workflowText);
  } catch {
    fail("workflow.json is missing or invalid");
  }
  const units = storedPlanUnits(workflowText);
  if (units === null) fail("workflow.json carries no plan");

  let mustKeep: string[];
  if (scope === "whole") {
    mustKeep = units.flatMap((unit) => unit.must_keep);
  } else {
    const unit = units.find((candidate) => candidate.id === scope);
    if (!unit) fail("no unit with that id");
    mustKeep = unit.must_keep;
  }

  writePromptFile(outFile, assembleCheckBrief(S, scope, mustKeep));
}

if (import.meta.main) main();
