#!/usr/bin/env bun
/**
 * Neutral leaf router. The orchestrator invokes a role, never a family name:
 *   bun run_leaf.ts <writer|planner|checker> <promptfile>
 *   bun run_leaf.ts repair <promptfile> <passage-scope>
 *
 * The private probe result chooses between the isolated adapters in
 * `lib/leaf.ts`. Successful runs emit only the leaf's final answer on stdout;
 * the caller must redirect it straight to a canonical or private staging
 * file. Writer and repair prompts pass through the brief lint and the primer
 * before dispatch; a prompt whose first line is exactly
 * `<!-- wordtaste:composed v1 -->` is dispatched byte-for-byte as written.
 * When such a prompt has the composer's `system.en.md` beside it, that
 * charter rides along as a system prompt — a real system message on the
 * hosted route, `--system-prompt-file` on the Claude CLI, prepended text on
 * Codex, which has no system channel. Without the sibling, dispatch is
 * exactly what it always was; checker and planner prompts never carry one.
 *
 * Environment switches: WORDTASTE_PRIMER=0 disables priming,
 * WORDTASTE_PRIMER_POSITION=top moves the block to the front,
 * WORDTASTE_PRIMER_LIBS overrides library resolution, WORDTASTE_VOICE_DIR
 * overrides the voice folder, WORDTASTE_BRIEF_LINT=0 disables the lint,
 * WORDTASTE_CLAUDE_MODEL / WORDTASTE_CODEX_MODEL / WORDTASTE_WRITER_MODEL
 * pick a leaf model.
 *
 * Exit codes: 2 usage, 3 no isolated process, 4/5 repair budget, 6 brief
 * lint; an adapter failure propagates its own code.
 */

import { routeLeaf } from "./lib/leaf.ts";

async function main(): Promise<void> {
  const [role, promptFile, scope] = process.argv.slice(2);
  if (!role || !promptFile) {
    process.stderr.write(
      "wordtaste: leaf — usage: run_leaf.ts <writer|planner|checker|repair> <promptfile> [passage-scope]\n",
    );
    process.exit(2);
  }
  const outcome = await routeLeaf(role, promptFile, scope ?? "");
  for (const message of outcome.messages) process.stderr.write(`${message}\n`);
  if (outcome.status === 0 && outcome.output.length > 0) {
    process.stdout.write(outcome.output);
  }
  process.exit(outcome.status);
}

if (import.meta.main) await main();
