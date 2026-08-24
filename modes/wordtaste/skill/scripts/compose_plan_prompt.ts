#!/usr/bin/env bun
/**
 * Deterministic planner-prompt composer.
 *
 * Usage:
 *   bun compose_plan_prompt.ts <parts-dir> <out-file>
 *
 * The orchestrator copies the user's own words and the source material into a
 * parts directory (`goal.md`, `material.md`, optional `voice.md`), and this
 * script wraps them in the English scaffolding of
 * `references/prompt-scaffolding.en.json`, identical on every run and shared
 * with the Claude Workflow path through `lib/prompt-assembly.ts`.
 *
 * Output:
 *   <out-file>, starting with `<!-- wordtaste:composed v1 plan -->`. Every
 *   Chinese character in it comes from the parts; the scaffolding is English.
 *   Nothing is printed on success.
 *
 * The planner returns JSON only. `validate_plan.ts` then refuses any plan
 * whose Chinese is not a literal quote from these same parts.
 *
 * Exit codes:
 *   0  — composed
 *   2  — usage error, or a required part is missing or empty
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fileNonEmpty,
  loadScaffolding,
  readPart,
  writePromptFile,
} from "./lib/compose.ts";
import { assemblePlanPrompt, hasPlanScaffolding, type Scaffolding } from "./lib/prompt-assembly.ts";
import { realpathOrNull, scriptsDir } from "./lib/session.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: plan compose — ${message}\n`);
  process.exit(2);
}

function main(): void {
  const [partsDirArg, outFile] = process.argv.slice(2);
  if (process.argv.length - 2 !== 2 || !partsDirArg || !outFile) {
    fail("usage: compose_plan_prompt.ts <parts-dir> <out-file>");
  }
  if (!existsSync(partsDirArg) || !statSync(partsDirArg).isDirectory()) {
    fail(`parts directory not found: ${partsDirArg}`);
  }
  const partsDir = realpathOrNull(partsDirArg) ?? partsDirArg;
  const schemaFile = join(scriptsDir, "..", "references", "plan-schema.json");

  const scaffold = loadScaffolding();
  if (scaffold === null || !hasPlanScaffolding(scaffold)) {
    fail("the English scaffolding file is missing or incomplete");
  }
  const S = scaffold as unknown as Scaffolding;

  for (const required of ["goal.md", "material.md"]) {
    if (!fileNonEmpty(join(partsDir, required))) {
      fail(`required part is missing: ${required}`);
    }
  }
  if (!fileNonEmpty(schemaFile)) fail("plan schema is missing");

  const prompt = assemblePlanPrompt(S, {
    schemaText: readPart(schemaFile)!,
    goal: readPart(join(partsDir, "goal.md"))!,
    material: readPart(join(partsDir, "material.md"))!,
    voice: readPart(join(partsDir, "voice.md")),
  });
  writePromptFile(outFile, prompt);
}

if (import.meta.main) main();
