/**
 * Cross-process canonical-determinism probe (T11 [3]) — run as a CHILD
 * PROCESS by e2e.test.ts. A same-process double run structurally cannot
 * pin the determinism that could actually leak: clock/RNG/global-state
 * reads are already banned by the executable static grep (inference
 * suite), and what remains — iteration order tied to allocation history,
 * cross-process hash seeding, cached module state — only varies BETWEEN
 * processes. So the probe recomputes the canonical triple (plan, schedule,
 * duration) for every shipped seed in a fresh Bun process and prints one
 * SHA-256 per seed; the test compares them against hashes computed by the
 * SAME function in its own process.
 *
 * Not a `*.test.ts` file on purpose (Bun would collect it): a fixture
 * module, precedent `vocabulary.ts` and `incremental-host.ts`. Kept
 * DOM-free — `buildTimeline` without measurements never touches a
 * document, so the child process stays cheap to boot.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { planLecture } from "../engine/inference.js";
import { buildTimeline } from "../engine/timeline.js";

export const PROBE_SEED_IDS = [
  "tech-zh",
  "pitch-zh",
  "tech-en",
  "pitch-en",
] as const;

/** SHA-256 over the full canonical triple for one board's bytes. */
export function canonicalHash(src: string, id: string): string {
  const lecture = parseLecture(src, id);
  const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });
  const triple = JSON.stringify({
    plan: planLecture(lecture, DEFAULT_DURATIONS),
    schedule: timeline.schedule,
    duration: timeline.duration,
  });
  return new Bun.CryptoHasher("sha256").update(triple).digest("hex");
}

if (import.meta.main) {
  const seedDir = join(import.meta.dir, "..", "seed");
  for (const id of PROBE_SEED_IDS) {
    const src = readFileSync(join(seedDir, id, "board.md"), "utf8");
    console.log(`${id} ${canonicalHash(src, id)}`);
  }
}
