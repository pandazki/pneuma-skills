#!/usr/bin/env bun
/**
 * Deterministic writer-prompt composer.
 *
 * Usage:
 *   bun compose_leaf_prompt.ts <parts-dir> <out-file>
 *
 * The orchestrator never writes Chinese prose for a writer. It prepares a
 * parts directory and this script assembles the prompt around it, so that
 * every instruction the writer reads is English written once, in
 * `references/prompt-scaffolding.en.json`, and every Chinese sentence it reads
 * was written by a human — the author's own material, or a passage of
 * published prose.
 *
 * The assembly itself lives in `lib/prompt-assembly.ts`, the single
 * implementation the Claude Workflow path also runs (as a generated copy).
 * Parts (`brief.en.md`, `material.md`, optional `kernel.md`, `current.md`,
 * `preceding.md`, `issues.md`, `voice_style.en.md`, `voice_examples.md`,
 * `constraints.en.md`) are documented in SKILL.md and read byte for byte.
 * One optional part is metadata rather than prose: `entry`, written by
 * `compose_unit_parts.ts` from the stored workflow. The exact word `idea`
 * selects the creation charter; absent or anything else is the rewrite
 * default, byte-identical to every prompt composed before the part existed.
 *
 * Output:
 *   <out-file>, starting with `<!-- wordtaste:composed v1 -->` so run_leaf.ts
 *   recognises a composed prompt and dispatches it byte-for-byte, without
 *   appending the primer a second time — and `system.en.md` beside it, the
 *   writer's standing charter, which run_leaf.ts sends through the strongest
 *   channel the route has. Nothing is printed on success.
 *
 * Exit codes:
 *   0  — composed
 *   2  — usage error, or a required part is missing or empty
 */

import { ComposeError, composeLeafPromptFile } from "./lib/compose.ts";

function main(): void {
  const [partsDir, outFile] = process.argv.slice(2);
  if (process.argv.length - 2 !== 2 || !partsDir || !outFile) {
    process.stderr.write(
      "wordtaste: compose — usage: compose_leaf_prompt.ts <parts-dir> <out-file>\n",
    );
    process.exit(2);
  }
  try {
    composeLeafPromptFile(partsDir, outFile);
  } catch (error) {
    if (error instanceof ComposeError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}

if (import.meta.main) main();
