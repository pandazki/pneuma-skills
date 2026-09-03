/**
 * make-style-sample.mjs — the style board's one producer, pinned at the
 * only layer a test can reach without paying fal.ai: what it refuses.
 * The refusal that matters is `--action`: the first live sample of this
 * mode was shot with a hook line alone and came back as the empty set
 * with a voice over it (an empty papercraft blackboard under a Fourier
 * hook). A sample must carry the topic, so the script will not shoot
 * without being told what the five seconds show.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleCatalog } from "../skill/scripts/segment-lib.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "make-style-sample.mjs");
const STYLES_MD = join(import.meta.dir, "..", "skill", "references", "styles.md");

function run(cwd: string, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // No keys: even a run that passed validation must stop before any
    // paid call, and the course must not be touched by a refused one.
    env: { ...process.env, FAL_KEY: "", OPENROUTER_API_KEY: "" },
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function courseWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "plotwise-sample-"));
  mkdirSync(join(ws, "fourier"), { recursive: true });
  writeFileSync(
    join(ws, "fourier", "course.json"),
    JSON.stringify({ title: "傅里叶变换", topic: "傅里叶变换", language: "zh", style: { id: "", status: "pending" }, outline: [], nodes: {} }),
  );
  return ws;
}

describe("make-style-sample.mjs", () => {
  test("refuses a hook without an action, and leaves the course untouched", () => {
    const ws = courseWorkspace();
    const r = run(ws, "--set", "fourier", "--style-id", "papercraft", "--hook", "任何复杂的声音,都是正弦波叠出来的。");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--action is required");
    expect(r.err).toContain("empty set");
    expect(JSON.parse(readFileSync(join(ws, "fourier", "course.json"), "utf-8")).style).toEqual({ id: "", status: "pending" });
  });

  test("a blank action is no action", () => {
    const ws = courseWorkspace();
    const r = run(ws, "--set", "fourier", "--style-id", "papercraft", "--hook", "h", "--action", "   ");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--action is required");
  });

  test("an anchor on file for the same style and topic is kept, not shot again", () => {
    // A re-run after a failed clip (the endpoint was down) must not spend
    // another image on the same establishing frame. With no keys the
    // anchor step would fail first; skipping it means the run gets as far
    // as the clip, which then fails for want of a key.
    const ws = courseWorkspace();
    const recipe = parseStyleCatalog(readFileSync(STYLES_MD, "utf-8")).get("papercraft")!.recipe;
    const styleDir = join(ws, "fourier", "style");
    mkdirSync(styleDir, { recursive: true });
    writeFileSync(join(styleDir, "anchor.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(styleDir, "anchor.json"), JSON.stringify({ style_id: "papercraft", recipe, topic: "傅里叶变换" }));
    const before = statSync(join(styleDir, "anchor.png")).mtimeMs;

    const r = run(ws, "--set", "fourier", "--style-id", "papercraft", "--hook", "h", "--action", "paper waves stack and peel apart", "--json");
    expect(r.code).toBe(1);
    const out = JSON.parse(r.out);
    expect(out.reason).toContain("sample shoot failed");
    expect(out.reason).not.toContain("anchor");
    expect(statSync(join(styleDir, "anchor.png")).mtimeMs).toBe(before);
    // A different topic is a different frame: the record no longer matches.
    writeFileSync(join(styleDir, "anchor.json"), JSON.stringify({ style_id: "papercraft", recipe, topic: "something else" }));
    const again = run(ws, "--set", "fourier", "--style-id", "papercraft", "--hook", "h", "--action", "paper waves stack and peel apart", "--json");
    expect(JSON.parse(again.out).reason).toContain("anchor");
  });

  test("a custom style needs a recipe", () => {
    const ws = courseWorkspace();
    const r = run(ws, "--set", "fourier", "--style-id", "custom", "--hook", "h", "--action", "paper waves stack and peel apart");
    expect(r.code).toBe(1);
    expect(r.err).toContain("no --recipe");
  });
});
