/**
 * generate-video.mjs — MiniMax H3 Max on fal.ai: what a clip costs, and the
 * `--help` its siblings already had.
 *
 * fal bills H3 Max on the REQUESTED duration at a per-second rate by
 * resolution, so the estimate is known from the request alone; nothing here
 * reaches fal. The argv contract and its refusals are pinned by
 * `modes/plotwise/__tests__/fal-queue.test.ts`, which spawns the real CLI.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Importing the module must run nothing — the CLI lives in `main`.
import { costLine, h3Cost, H3_PRICES } from "../generate-video.mjs";

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "generate-video.mjs");
const BEFORE_LAUNCH_END = new Date("2026-09-28T12:00:00Z");
const AFTER_LAUNCH_END = new Date("2026-10-01T12:00:00Z");

describe("what an H3 Max clip costs", () => {
  test("the requested duration times the resolution's rate", () => {
    expect(h3Cost({ endpoint: "text", resolution: "480P", duration: 5, today: AFTER_LAUNCH_END })).toEqual({
      usd: 0.25, estimate: true, endpoint: "text", resolution: "480P", checked: H3_PRICES.checked,
      basis: "requested-duration", seconds: 5, usdPerSecond: 0.05,
    });
    // fal's own example: a 5-second 768p output costs $0.40.
    expect(h3Cost({ endpoint: "reference", resolution: "768P", duration: 5, refImages: 2 }).usd).toBe(0.4);
    expect(h3Cost({ endpoint: "image", resolution: "768P", duration: 15, today: AFTER_LAUNCH_END }).usd).toBe(1.2);
  });

  test("the cost line says it is an estimate and where the rate comes from", () => {
    expect(costLine(h3Cost({ endpoint: "image", resolution: "480P", duration: 7, today: AFTER_LAUNCH_END }))).toBe(
      `cost: ≈ $0.3500 (estimate: 7 s × $0.05 per second at 480P, H3 Max image-to-video at fal's list price on the requested duration, model page read ${H3_PRICES.checked})`,
    );
  });

  test("the launch rate the text and image pages advertise is named until it ends, never applied", () => {
    const during = h3Cost({ endpoint: "text", resolution: "480P", duration: 5, today: BEFORE_LAUNCH_END });
    expect(during.usd).toBe(0.25);
    expect(during.note).toBe("fal's page also advertises a 50% launch rate until 2026-09-30, not applied");
    expect(h3Cost({ endpoint: "text", resolution: "480P", duration: 5, today: AFTER_LAUNCH_END }).note).toBeUndefined();
  });

  test("reference tokens past the free allowance are named, not guessed", () => {
    const four = h3Cost({ endpoint: "reference", resolution: "480P", duration: 5, refImages: 4 });
    expect(four.note).toContain("up to 4 square reference images fit in the 4,096 included reference tokens");
    for (const refs of [{ refImages: 5 }, { refImages: 1, refVideos: 1 }, { refImages: 1, refAudios: 1 }]) {
      const priced = h3Cost({ endpoint: "reference", resolution: "480P", duration: 5, ...refs });
      expect(priced.usd).toBe(0.25);
      expect(priced.note).toBe("reference tokens past the 4,096 included bill $0.02 per 1,000 and are not counted here");
    }
  });

  test("a resolution with no known rate is unknown, with the reason and the list", () => {
    const cost = h3Cost({ endpoint: "text", resolution: "1080P", duration: 5 });
    expect(cost.usd).toBeNull();
    expect(costLine(cost)).toBe(
      "cost: unknown (no fal rate is known for 1080P at 5 s; fal lists H3 Max at $0.05 per second at 480P, $0.08 at 768P)",
    );
  });
});

describe("generate-video --help", () => {
  test("documents the flags and the price, exits 0, and submits nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "genvid-help-"));
    try {
      // No FAL_KEY: --help must not need one.
      const res = Bun.spawnSync({
        cmd: [process.execPath, "--env-file=/dev/null", SCRIPT, "--help"],
        cwd: dir,
        env: { PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(res.exitCode).toBe(0);
      const text = res.stderr.toString() + res.stdout.toString();
      for (const flag of ["--prompt", "--output", "--endpoint", "--duration", "--resolution", "--aspect-ratio",
        "--image", "--end-image", "--ref-image", "--ref-video", "--ref-audio", "--seed", "--expansion",
        "--no-normalize", "--json", "--deadline-s", "--help"]) {
        expect(text).toContain(flag);
      }
      expect(text).toContain("$0.05 per second at 480P");
      expect(text).toContain("cost: line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
