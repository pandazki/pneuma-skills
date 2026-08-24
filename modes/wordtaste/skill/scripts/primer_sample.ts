#!/usr/bin/env bun
/**
 * Primer sampler. Prints a block of framed prose passages that a writer reads
 * immediately before it starts writing, so the register it has just absorbed
 * is clean Chinese rather than its own accumulating habits.
 *
 * Usage:
 *   bun primer_sample.ts --seed <string> [--count 3] [--min 350] [--max 900]
 *                        [--total 2000] [--libs <dir>[:<dir>...]]
 *                        [--voice-dir <dir>] [--frame <frame.md>]
 *
 * Output (stdout): the "before" framing line, a blank line, then each window
 * separated by a blank line and a lone `※` line, then the "after" framing
 * line. When --voice-dir holds `*.md`, one further window from it is appended
 * after the library passages under the "voice" framing.
 *
 * Priming is optional and never fatal: when no enabled library has a usable
 * piece, the script prints nothing and exits 0. Nothing but the block itself
 * is ever printed — a failure is one neutral line on stderr, never passage
 * text.
 *
 * Determinism: the same --seed produces byte-identical output, pinned against
 * the bash-era sampler by the fixtures under `__tests__/fixtures/`.
 *
 * Exit codes:
 *   0  — success (block on stdout, or empty when nothing is available)
 *   2  — usage error or unreadable frame file
 */

import { existsSync } from "node:fs";
import { SamplerError, samplePrimer } from "./lib/sampling.ts";

function fail(message: string): never {
  process.stderr.write(`wordtaste: primer — ${message}\n`);
  process.exit(2);
}

function requireNumber(value: string, flag: string): number {
  if (!/^[0-9]+$/.test(value) || Number(value) <= 0) {
    fail(`${flag} must be a positive integer`);
  }
  return Number(value);
}

function main(): void {
  let count = 3;
  let min = 350;
  let max = 900;
  let total = 2000;
  let seed = "";
  let libs = "";
  let voiceDir = "";
  let frameFile = "";

  const args = process.argv.slice(2);
  let i = 0;
  const takeValue = (flag: string): string => {
    if (i + 1 >= args.length) fail(`missing value for ${flag}`);
    const value = args[i + 1]!;
    i += 2;
    return value;
  };
  while (i < args.length) {
    const flag = args[i]!;
    switch (flag) {
      case "--seed":
        seed = takeValue(flag);
        break;
      case "--count":
        count = requireNumber(takeValue(flag), flag);
        break;
      case "--min":
        min = requireNumber(takeValue(flag), flag);
        break;
      case "--max":
        max = requireNumber(takeValue(flag), flag);
        break;
      case "--total":
        total = requireNumber(takeValue(flag), flag);
        break;
      case "--libs":
        libs = takeValue(flag);
        break;
      case "--voice-dir":
        voiceDir = takeValue(flag);
        break;
      case "--frame":
        frameFile = takeValue(flag);
        break;
      default:
        fail("unknown option");
    }
  }

  if (seed === "") fail("--seed is required");
  if (min > max) fail("--min must not exceed --max");
  if (frameFile !== "" && !existsSync(frameFile)) fail("frame file not found");

  try {
    const block = samplePrimer({ seed, libs, count, min, max, total, voiceDir, frameFile });
    if (block.length > 0) process.stdout.write(block);
  } catch (error) {
    if (error instanceof SamplerError) fail(error.message);
    throw error;
  }
}

if (import.meta.main) main();
