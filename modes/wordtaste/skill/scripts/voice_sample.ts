#!/usr/bin/env bun
/**
 * Voice sampler. Prepares the two optional parts that let a writer read the
 * distilled record of how the person this essay is for actually writes.
 *
 * Usage:
 *   bun voice_sample.ts <taste-dir> <out-dir> --seed <string>
 *
 * Writes into <out-dir>:
 *   voice_style.en.md   the English directive lines of `<taste>/style.en.md`,
 *                       with their `<!-- evidence: ... -->` comments removed
 *                       and the list capped at 10 lines.
 *   voice_examples.md   verbatim Chinese: up to two of the user's own
 *                       hand-edit pairs from `<taste>/examples/swaps.jsonl`
 *                       rendered as `- <before>` / `+ <after>`, then one
 *                       paragraph-aligned window out of a piece under
 *                       `<taste>/examples/positive/`.
 *
 * Nothing here is written by this script; the Chinese is copied byte for byte
 * out of the user's own artifacts. Everything degrades to silence, and both
 * output files are removed on entry so a re-run after the user emptied
 * `taste/` leaves no stale part behind.
 *
 * Determinism: the same --seed draws the same pairs and the same window,
 * pinned against the bash-era sampler by fixtures under `__tests__/fixtures/`.
 *
 * Exit codes:
 *   0  — parts written, or nothing to write
 *   2  — usage error
 */

import { mkdirSync } from "node:fs";
import { sampleVoice } from "./lib/sampling.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: voice — ${message}\n`);
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] === "" || args[1] === "") {
    fail("usage: voice_sample.ts <taste-dir> <out-dir> --seed <string>");
  }
  const tasteDir = args[0]!;
  const outDir = args[1]!;

  let seed = "";
  let i = 2;
  while (i < args.length) {
    if (args[i] === "--seed") {
      if (i + 1 >= args.length) fail("missing value for --seed");
      seed = args[i + 1]!;
      i += 2;
    } else {
      fail("unknown option");
    }
  }
  if (seed === "") fail("--seed is required");

  mkdirSync(outDir, { recursive: true });
  sampleVoice(tasteDir, outDir, seed);
}

if (import.meta.main) main();
