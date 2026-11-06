/**
 * sticker.mjs as a real process, on a temp workspace, with generation mocked
 * (STICKER_GENERATORS → scripts-mock-generators.mjs; no network).
 *
 * Mocked images are WebP headers the craft prober reads without ffprobe.
 * Mocked GIF takes are structurally complete GIFs; landing one is measured
 * by craft's prober, which needs ffprobe for a GIF — those tests are gated
 * on ffprobe and say so. Exports (real ffmpeg encodes) run in the media
 * tier, exporters-media.test.ts.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { summarizeCosts } from "../../_shared/scripts/craft-project.mjs";
import * as S from "../skill/scripts/sticker-state.mjs";
import { rawPack } from "./sticker-fixture.js";
import { structuralGif } from "./scripts-mock-generators.mjs";

const STICKER = join(import.meta.dir, "..", "skill", "scripts", "sticker.mjs");
const CRAFT_IO = join(import.meta.dir, "..", "..", "_shared", "scripts", "craft-project-io.mjs");
const MOCK = join(import.meta.dir, "scripts-mock-generators.mjs");
const T0 = 1793000000000;
const HAS_FFPROBE = (() => {
  const r = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
})();
if (!HAS_FFPROBE) console.log("[sticker] skipped the CLI tests that land GIF takes: craft's prober needs ffprobe for a GIF (install ffmpeg)");

const dirs: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sticker-cli-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Run { code: number; out: string; err: string }

function env(dir: string, extra: Record<string, string> = {}) {
  return { ...process.env, STICKER_GENERATORS: MOCK, MOCK_LOG: join(dir, ".mock-log.jsonl"), MOCK_FAIL: "", MOCK_FAIL_STICKER: "", MOCK_NO_KEYS: "", MOCK_REAL_MEDIA: "", MOCK_SLEEP_MS: "", MOCK_IMAGE_SLEEP_MS: "", ...extra };
}

/** Pinned cwd: Bun loads the cwd's .env, and the repository's holds real keys. */
function run(dir: string, argv: string[], extra: Record<string, string> = {}): Run {
  const r = Bun.spawnSync([process.execPath, STICKER, ...argv, "--dir", dir], { cwd: dir, stdout: "pipe", stderr: "pipe", env: env(dir, extra) });
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}

function ok(dir: string, argv: string[], extra: Record<string, string> = {}) {
  const r = run(dir, [...argv, "--json", "--at", String(T0)], extra);
  if (r.code !== 0) throw new Error(`sticker ${argv.join(" ")} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

function webpHeader(width: number, height: number) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBPVP8X", 8, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
const project = (dir: string) => readJson(join(dir, "project.json"));
const assetOf = (dir: string, id: string) => project(dir).assets.find((a: { id: string }) => a.id === id);
const edgeOf = (dir: string, id: string) => project(dir).provenance.find((e: { toAssetId: string }) => e.toAssetId === id);
const mockLog = (dir: string) => (existsSync(join(dir, ".mock-log.jsonl"))
  ? readFileSync(join(dir, ".mock-log.jsonl"), "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);
const gifCalls = (dir: string) => mockLog(dir).filter((e: { kind: string }) => e.kind === "gif");

/** A workspace with a pack of `n` stickers (no picks), optionally without rights or anchor. */
function workspace({ stickers = 3, rights = true, anchor = true } = {}) {
  const dir = fresh();
  const raw = rawPack();
  raw.stickers = raw.stickers.slice(0, stickers).map((s: object) => ({ ...s, take: null }));
  raw.art = {};
  if (!rights) delete raw.rights;
  raw.character.anchor = null;
  writeFileSync(join(dir, "pack.json"), JSON.stringify(raw, null, 2));
  // A WebP header: craft's prober reads its size without ffprobe.
  writeFileSync(join(dir, "photo.webp"), webpHeader(640, 480));
  if (anchor) {
    ok(dir, ["character", "--from", join(dir, "photo.webp")]);
    editPack(dir, (p) => {
      p.character.anchor = "character-1";
    });
    rmSync(join(dir, ".mock-log.jsonl"), { force: true });
  }
  return dir;
}

function editPack(dir: string, mutate: (p: Record<string, any>) => void) {
  const p = readJson(join(dir, "pack.json"));
  mutate(p);
  writeFileSync(join(dir, "pack.json"), JSON.stringify(p, null, 2));
}

const packOf = (dir: string) => {
  const parsed = S.parsePack(readFileSync(join(dir, "pack.json"), "utf-8"));
  if (!parsed.ok) throw new Error("pack");
  return parsed.pack;
};

describe("sticker.mjs CLI", () => {
  test("--help lists every command; unknown commands and flags are refused", () => {
    const help = Bun.spawnSync([process.execPath, STICKER, "--help"], { stderr: "pipe" });
    expect(help.exitCode).toBe(0);
    const text = help.stderr.toString();
    for (const command of ["status", "quote", "character", "gen", "prompts", "import", "inspect", "export", "check"]) expect(text).toContain(`  ${command}`);
    const dir = fresh();
    expect(run(dir, ["fly"]).err).toContain("unknown command 'fly'");
    expect(run(dir, ["status", "--wings"]).code).toBe(1);
    expect(run(dir, ["gen", "--art", "portrait"]).err).toContain("--art takes no value here; choose kinds with --only portrait");
  });

  test("status reads without writing: no project.json, the rights gate as the next step", () => {
    const dir = fresh();
    const raw = rawPack();
    delete raw.rights;
    writeFileSync(join(dir, "pack.json"), JSON.stringify(raw));
    const s = ok(dir, ["status"]);
    expect(s.next.id).toBe("rights");
    expect(s.rights).toBe(null);
    expect(s.stickers.map((x: { status: string }) => x.status)).toEqual(Array(8).fill("empty"));
    expect(existsSync(join(dir, "project.json"))).toBe(false);
    const human = run(dir, ["status"]);
    expect(human.out).toContain("rights: NOT RECORDED");
    expect(human.out).toContain("next: Record the rights basis");
  });

  test("an invalid pack.json is refused with each field named", () => {
    const dir = fresh();
    const raw = rawPack();
    raw.stickers[0].id = "one";
    raw.platforms = ["weibo"];
    writeFileSync(join(dir, "pack.json"), JSON.stringify(raw));
    const r = run(dir, ["status"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("stickers[0].id: must look like s01");
    expect(r.err).toContain("platforms[0]: must be one of wechat, telegram, line");
    expect(run(fresh(), ["status"]).err).toContain("no pack.json");
  });

  test("paid steps refuse without rights, name the field, and send and record nothing", () => {
    const dir = workspace({ rights: false, anchor: false });
    for (const argv of [["gen"], ["gen", "--art"], ["character", "--from", join(dir, "photo.webp")]]) {
      const r = run(dir, argv);
      expect({ argv, code: r.code }).toEqual({ argv, code: 1 });
      expect(r.err).toContain("rights is not recorded in pack.json");
      expect(r.err).toContain("refuses without it");
    }
    expect(mockLog(dir)).toEqual([]);
    expect(existsSync(join(dir, "project.json"))).toBe(false);
  });

  test("gen refuses without a ready anchor, naming character.anchor", () => {
    const dir = workspace({ anchor: false });
    const r = run(dir, ["gen"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("character.anchor is not set");
    editPack(dir, (p) => {
      p.character.anchor = "character-7";
    });
    expect(run(dir, ["gen"]).err).toContain("character.anchor 'character-7' is not in project.json");
    expect(gifCalls(dir)).toEqual([]);
  });

  test("character: the source is an upload by the human, the candidate a reported OpenRouter call from it", () => {
    const dir = workspace({ anchor: false });
    const out = ok(dir, ["character", "--from", join(dir, "photo.webp")]);
    expect(out.source).toBe("character-source-1");
    expect(out.results[0]).toMatchObject({ id: "character-1", ok: true, uri: "character/anchor-1.webp" });
    expect(edgeOf(dir, "character-source-1").operation).toMatchObject({ type: "upload", actor: "human" });
    const edge = edgeOf(dir, "character-1");
    expect(edge.fromAssetId).toBe("character-source-1");
    expect(edge.operation.params).toMatchObject({ model: "openai/gpt-image-2.6-flare", provider: "openrouter", cost: { usd: 0.0421, basis: "reported" }, request: { background: "transparent", aspectRatio: "1:1" } });
    const [call] = mockLog(dir);
    expect(call).toMatchObject({ kind: "image", background: "transparent", imageUrls: [join(dir, "character/source-1.webp")] });
    expect(call.prompt).toBe(S.characterPrompt(packOf(dir), { fromImage: true }));
    // Never overwritten: a second candidate is a new file.
    ok(dir, ["character", "--from", "character-source-1"]);
    expect(assetOf(dir, "character-2").uri).toBe("character/anchor-2.webp");
  });

  test("no key: nothing is sent, and the no-key path is named", () => {
    const dir = workspace();
    const r = run(dir, ["gen"], { MOCK_NO_KEYS: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no fal key");
    expect(r.err).toContain("sticker.mjs prompts");
    expect(r.err).toContain("sticker.mjs import --sticker <id> --file <gif>");
    expect(gifCalls(dir)).toEqual([]);
    const s = ok(dir, ["status"], { MOCK_NO_KEYS: "1" });
    expect(s.keys).toEqual({ fal: false, openrouter: false });
  });

  test("--dry-run prints the exact fal request and records nothing", () => {
    const dir = workspace();
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const out = ok(dir, ["gen", "--dry-run"]);
    expect(out.requests).toHaveLength(3);
    expect(out.requests[0]).toMatchObject({ sticker: "s01", url: "https://fal.run/openai/gpt-image-2.6/flare/edit", model: "openai/gpt-image-2.6-flare" });
    expect(out.requests[0].body).toMatchObject({ output_format: "gif", frame_count: 16, frame_duration_ms: 120, image_size: { width: 512, height: 512 }, quality: "medium", background: "transparent" });
    expect(out.requests[0].body.prompt).toBe(S.stickerPrompt(packOf(dir), packOf(dir).stickers[0]));
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    expect(gifCalls(dir)).toEqual([]);
  });

  test("quote says the cost before anything is sent", () => {
    const dir = workspace();
    const q = ok(dir, ["quote"]);
    expect(q.items[0]).toMatchObject({ step: "stickers", count: 3, stickers: ["s01", "s02", "s03"], each: { usd: 0.1, basis: "estimate" } });
    expect(q.totalUsd).toBe(0.3);
    const art = ok(dir, ["quote", "--art"]);
    // The project's own reported OpenRouter price (the character call) beats the table.
    expect(art.items[0]).toMatchObject({ step: "art", count: 3, kinds: ["portrait", "head", "banner"], each: { usd: 0.0421, basis: "estimate" } });
    const human = run(dir, ["quote", "--only", "s02"]);
    expect(human.out).toContain("stickers: s02 — 1 GIF take(s) of 16 × 512² at 120 ms");
    expect(human.out).toContain("nothing is sent by quote");
    expect(gifCalls(dir)).toEqual([]);
  });

  test("a missing ffmpeg is said before export starts", () => {
    const empty = fresh();
    mkdirSync(join(empty, "bin"));
    writeFileSync(join(empty, "pack.json"), JSON.stringify(rawPack()));
    const r = Bun.spawnSync([process.execPath, STICKER, "export", "--dir", empty], { cwd: empty, stderr: "pipe", env: { ...process.env, PATH: join(empty, "bin") } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("ffmpeg/ffprobe: MISSING");
  });

  test("a recorded path outside the workspace is never read: gen refuses before reserving or sending", () => {
    const dir = workspace({ stickers: 1 });
    const outside = fresh();
    writeFileSync(join(outside, "anchor.webp"), webpHeader(64, 64));
    const doc = project(dir);
    const anchorAsset = doc.assets.find((a: { id: string }) => a.id === "character-1");
    const inside = anchorAsset.uri;
    anchorAsset.uri = relative(dir, join(outside, "anchor.webp"));
    writeFileSync(join(dir, "project.json"), `${JSON.stringify(doc, null, 2)}\n`);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const r = run(dir, ["gen"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`${anchorAsset.uri} is outside the workspace`);
    expect(gifCalls(dir)).toEqual([]);
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    // The same file reached through a link inside the workspace is refused too.
    anchorAsset.uri = inside;
    writeFileSync(join(dir, "project.json"), `${JSON.stringify(doc, null, 2)}\n`);
    rmSync(join(dir, inside));
    symlinkSync(join(outside, "anchor.webp"), join(dir, inside));
    const linked = run(dir, ["gen"]);
    expect(linked.code).toBe(1);
    expect(linked.err).toContain(`${inside} is a symbolic link`);
    expect(gifCalls(dir)).toEqual([]);
  });

  test("a symlinked controlled directory is refused: nothing is sent, written or recorded outside", () => {
    const dir = workspace({ stickers: 1 });
    const outside = fresh();
    symlinkSync(outside, join(dir, "stickers"));
    const r = run(dir, ["gen"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("stickers is a symbolic link");
    expect(gifCalls(dir)).toEqual([]);
    expect(readdirSync(outside)).toEqual([]);
    expect(project(dir).assets.some((a: { id: string }) => a.id.startsWith("s01-"))).toBe(false);
    // import copies into the workspace: a file from anywhere is fine, a linked target directory is not.
    rmSync(join(dir, "character"), { recursive: true });
    symlinkSync(outside, join(dir, "character"));
    const photo = join(fresh(), "photo.webp");
    writeFileSync(photo, webpHeader(64, 64));
    const imported = run(dir, ["import", "--character", "--file", photo]);
    expect(imported.code).toBe(1);
    expect(imported.err).toContain("character is a symbolic link");
    expect(readdirSync(outside)).toEqual([]);
    rmSync(join(dir, "character"));
    expect(ok(dir, ["import", "--character", "--file", photo]).uri).toBe("character/anchor-2.webp");
  });

  test("prompts print exactly what gen sends, for making the GIF elsewhere", () => {
    const dir = workspace();
    const out = ok(dir, ["prompts", "--only", "s01,s03"]);
    const pack = packOf(dir);
    expect(out.stickers.map((s: { id: string }) => s.id)).toEqual(["s01", "s03"]);
    expect(out.stickers[0].prompt).toBe(S.stickerPrompt(pack, pack.stickers[0]));
    expect(out.stickers[0].import).toBe("sticker.mjs import --sticker s01 --file <gif>");
    expect(out.attach).toBe("character/anchor-1.webp");
    expect(out.request).toEqual(S.stickerRequest(pack));
    const art = ok(dir, ["prompts", "--art", "--only", "banner"]);
    expect(art.art[0]).toMatchObject({ kind: "banner", aspectRatio: "16:9", background: "opaque" });
  });
});

describe.skipIf(!HAS_FFPROBE)("sticker.mjs gen and import (landing GIFs needs ffprobe)", () => {
  test("gen: every missing sticker, bounded concurrency, recorded through the craft lifecycle", () => {
    const dir = workspace({ stickers: 4 });
    const out = ok(dir, ["gen", "--concurrency", "2"], { MOCK_SLEEP_MS: "300" });
    expect(out.results.map((r: { id: string; ok: boolean }) => [r.id, r.ok])).toEqual([["s01-take-1", true], ["s02-take-1", true], ["s03-take-1", true], ["s04-take-1", true]]);
    // Never more than two in flight.
    const events = mockLog(dir).filter((e: { kind: string }) => e.kind === "start" || e.kind === "end").sort((a: { at: number }, b: { at: number }) => a.at - b.at);
    let live = 0;
    let peak = 0;
    for (const e of events) {
      live += e.kind === "start" ? 1 : -1;
      peak = Math.max(peak, live);
    }
    expect(peak).toBe(2);
    const pack = packOf(dir);
    const calls = gifCalls(dir);
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call).toMatchObject({ frameCount: 16, frameDurationMs: 120, imageSize: "512x512", quality: "medium", background: "transparent", imageUrls: [join(dir, "character/anchor-1.webp")] });
    const edge = edgeOf(dir, "s02-take-1");
    expect(edge.fromAssetId).toBe("character-1");
    expect(edge.operation.type).toBe("generate");
    expect(edge.operation.params).toMatchObject({
      model: "openai/gpt-image-2.6-flare", provider: "fal", prompt: S.stickerPrompt(pack, pack.stickers[1]), sticker: "s02",
      request: S.stickerRequest(pack), promptInputs: S.stickerPromptInputs(pack, pack.stickers[1]),
      cost: { usd: 0.1, basis: "estimate" },
    });
    expect(edge.operation.params.requestId).toMatch(/^mock-request-/);
    expect(assetOf(dir, "s02-take-1")).toMatchObject({ status: "ready", uri: "stickers/s02/take-1.gif", metadata: { width: 512, height: 512 } });
    expect(project(dir).sticker.measures["s02-take-1"]).toMatchObject({ format: "gif", frames: 16, width: 512, height: 512, durationMs: 1920, loopCount: 0 });
    // Reruns fill only what is missing.
    const again = ok(dir, ["gen"]);
    expect(again.results).toEqual([]);
    expect(gifCalls(dir)).toHaveLength(4);
    const costs = summarizeCosts(project(dir));
    expect(costs.total).toBeCloseTo(0.4 + 0.0421, 6);
    // Status: all four have takes and none is picked.
    expect(ok(dir, ["status"]).stickers.map((s: { status: string }) => s.status)).toEqual(["pick", "pick", "pick", "pick"]);
  });

  test("a failed sticker does not stop the others; the rerun makes only that one", () => {
    const dir = workspace();
    const r = run(dir, ["gen", "--json", "--at", String(T0)], { MOCK_FAIL_STICKER: "s02" });
    expect(r.code).toBe(1);
    const out = JSON.parse(r.out);
    expect(out.results.map((x: { id: string; ok: boolean }) => [x.id, x.ok])).toEqual([["s01-take-1", true], ["s02-take-1", false], ["s03-take-1", true]]);
    expect(r.err).toContain("s02-take-1 failed: mock upstream error");
    const failed = edgeOf(dir, "s02-take-1").operation.params;
    expect(failed.failure).toMatchObject({ billing: "unknown" });
    expect(failed.requestId).toBe("mock-request-failed");
    expect(assetOf(dir, "s02-take-1").status).toBe("failed");
    // It may have been charged: a plain rerun, its quote and the next step leave it, and say how to retry.
    const quote = ok(dir, ["quote"]);
    expect(quote.items[0]).toMatchObject({ count: 0, stickers: [], uncertain: [{ id: "s02", take: "s02-take-1" }] });
    expect(run(dir, ["quote"]).out).toContain("s02 (s02-take-1 failed, billing unknown");
    const plain = run(dir, ["gen", "--json", "--at", String(T0)]);
    expect(plain.code).toBe(0);
    expect(JSON.parse(plain.out)).toMatchObject({ results: [], uncertain: [{ id: "s02", take: "s02-take-1" }] });
    expect(plain.err).toContain("gen --only s02");
    expect(gifCalls(dir)).toHaveLength(3);
    // Only the uncertain one is left: its own step, never "make the missing stickers".
    expect(ok(dir, ["status"]).next).toMatchObject({ id: "retry", command: "sticker.mjs gen --only s02", message: { code: "next.retry", params: { stickers: ["s02"] } } });
    // Naming it is the explicit retry.
    const rerun = ok(dir, ["gen", "--only", "s02"]);
    expect(rerun.results.map((x: { id: string }) => x.id)).toEqual(["s02-take-2"]);
    expect(gifCalls(dir).map((c: { output: string }) => c.output.split("/stickers/")[1])).toEqual(["s01/take-1.gif", "s02/take-1.gif", "s03/take-1.gif", "s02/take-2.gif"]);
  });

  test("a request that provably never left is recorded as not billed, and a plain rerun retries it", () => {
    const dir = workspace({ stickers: 1 });
    expect(run(dir, ["gen"], { MOCK_FAIL: "refused" }).code).toBe(1);
    expect(edgeOf(dir, "s01-take-1").operation.params.failure).toMatchObject({ billing: "none" });
    expect(summarizeCosts(project(dir)).notBilled).toEqual(["s01-take-1"]);
    expect(ok(dir, ["quote"]).items[0]).toMatchObject({ count: 1, stickers: ["s01"], uncertain: [] });
    expect(ok(dir, ["gen"]).results.map((x: { id: string; ok: boolean }) => [x.id, x.ok])).toEqual([["s01-take-2", true]]);
  });

  test("a generated file is never overwritten: a stray take file pushes the id on", () => {
    const dir = workspace({ stickers: 1 });
    mkdirSync(join(dir, "stickers", "s01"), { recursive: true });
    writeFileSync(join(dir, "stickers", "s01", "take-1.gif"), "stray bytes");
    ok(dir, ["gen"]);
    expect(readFileSync(join(dir, "stickers", "s01", "take-1.gif"), "utf-8")).toBe("stray bytes");
    expect(assetOf(dir, "s01-take-2").uri).toBe("stickers/s01/take-2.gif");
    // --redo: a new take for the chosen sticker only, never a replacement.
    ok(dir, ["gen", "--only", "s01", "--redo"]);
    expect(assetOf(dir, "s01-take-3").status).toBe("ready");
    expect(assetOf(dir, "s01-take-2").status).toBe("ready");
  });

  test("an interrupted take is recorded as failed, billing unknown, exit 130", async () => {
    const dir = workspace({ stickers: 1 });
    const child = Bun.spawn([process.execPath, STICKER, "gen", "--dir", dir], { cwd: dir, stdout: "pipe", stderr: "pipe", env: env(dir, { MOCK_SLEEP_MS: "20000" }) });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && assetOf(dir, "s01-take-1")?.status !== "generating") await Bun.sleep(50);
    expect(assetOf(dir, "s01-take-1")?.status).toBe("generating");
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(edgeOf(dir, "s01-take-1").operation.params.failure).toMatchObject({ billing: "unknown" });
  });

  test("every write keeps the sidecar to what the project records", () => {
    const dir = workspace({ stickers: 2 });
    ok(dir, ["gen"]);
    const orphan = () => {
      // What a craft drop leaves: the measurement of a dropped asset, the archive record of dropped exports.
      const doc = project(dir);
      doc.sticker.measures["wechat-s09"] = doc.sticker.measures["s02-take-1"];
      doc.sticker.archives.wechat = { uri: "exports/wechat.zip", bytes: 10, entries: ["01.gif"], key: "k", at: T0 };
      writeFileSync(join(dir, "project.json"), `${JSON.stringify(doc, null, 2)}\n`);
    };
    const drop = Bun.spawnSync([process.execPath, CRAFT_IO, "drop", "--path", join(dir, "project.json"), "--id", "s01-take-1"], { cwd: dir, stderr: "pipe" });
    expect(drop.exitCode).toBe(0);
    orphan();
    // A local write (import) …
    ok(dir, ["import", "--character", "--file", join(dir, "photo.webp")]);
    expect(Object.keys(project(dir).sticker.measures).sort()).toEqual(["s02-take-1"]);
    expect(project(dir).sticker.archives).toEqual({});
    // … and a paid one (runRegistered's writes).
    orphan();
    ok(dir, ["gen", "--only", "s01"]);
    expect(Object.keys(project(dir).sticker.measures).sort()).toEqual(["s01-take-2", "s02-take-1"]);
    expect(project(dir).sticker.archives).toEqual({});
  });

  /** Spawn a paid command, interrupt it once `ready()` holds, and give it `graceMs` to exit (then kill it). */
  async function interrupt(dir: string, argv: string[], extra: Record<string, string>, ready: () => boolean, graceMs = 8000) {
    const child = Bun.spawn([process.execPath, STICKER, ...argv, "--dir", dir, "--json"], { cwd: dir, stdout: "pipe", stderr: "pipe", env: env(dir, extra) });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !ready()) await Bun.sleep(50);
    expect(ready()).toBe(true);
    child.kill("SIGINT");
    const code = await Promise.race([child.exited, Bun.sleep(graceMs).then(() => "still running")]);
    if (code === "still running") child.kill("SIGKILL");
    await child.exited;
    return { code, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
  }

  test("one interrupt cancels the whole gen: in-flight takes fail (billing unknown), nothing new is sent, exit 130", async () => {
    const dir = workspace({ stickers: 8 });
    const inFlight = () => (project(dir).assets as { status?: string }[]).filter((a) => a.status === "generating").length;
    const r = await interrupt(dir, ["gen", "--concurrency", "4"], { MOCK_SLEEP_MS: "20000" }, () => inFlight() === 4);
    expect(r.code).toBe(130);
    expect(gifCalls(dir)).toHaveLength(4);
    for (const sid of ["s01", "s02", "s03", "s04"]) {
      expect(assetOf(dir, `${sid}-take-1`).status).toBe("failed");
      expect(edgeOf(dir, `${sid}-take-1`).operation.params.failure).toMatchObject({ billing: "unknown" });
    }
    for (const sid of ["s05", "s06", "s07", "s08"]) expect(assetOf(dir, `${sid}-take-1`)).toBeUndefined();
    const out = JSON.parse(r.out);
    expect(out).toMatchObject({ interrupted: "SIGINT", notStarted: ["s05", "s06", "s07", "s08"] });
    expect(r.err).toContain("never started (nothing sent): s05, s06, s07, s08");
  }, 30_000);

  test("one interrupt stops character candidates too: the rest are never sent", async () => {
    const dir = workspace({ anchor: false });
    const imageCalls = () => mockLog(dir).filter((e: { kind: string }) => e.kind === "image").length;
    const r = await interrupt(dir, ["character", "--from", join(dir, "photo.webp"), "--count", "3"], { MOCK_IMAGE_SLEEP_MS: "20000" }, () => imageCalls() === 1);
    expect(r.code).toBe(130);
    expect(imageCalls()).toBe(1);
    expect(edgeOf(dir, "character-1").operation.params.failure).toMatchObject({ billing: "unknown" });
    expect(assetOf(dir, "character-2")).toBeUndefined();
    expect(JSON.parse(r.out)).toMatchObject({ interrupted: "SIGINT", notStarted: 2 });
    expect(r.err).toContain("2 candidate(s) never started");
  }, 30_000);

  test("one writer at a time: a second mutating command refuses and names the holder; reading commands still answer", async () => {
    const dir = workspace({ stickers: 2 });
    writeFileSync(join(dir, "made.gif"), structuralGif(12, { delayCs: 10, width: 480, height: 480 }));
    const first = Bun.spawn([process.execPath, STICKER, "gen", "--only", "s01", "--dir", dir], { cwd: dir, stdout: "pipe", stderr: "pipe", env: env(dir, { MOCK_SLEEP_MS: "20000" }) });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && assetOf(dir, "s01-take-1")?.status !== "generating") await Bun.sleep(50);
    expect(assetOf(dir, "s01-take-1")?.status).toBe("generating");
    const holder = JSON.parse(readFileSync(join(dir, ".sticker.lock"), "utf-8"));
    expect(holder).toMatchObject({ pid: first.pid, command: "gen" });
    for (const argv of [["gen", "--only", "s01", "--redo"], ["import", "--sticker", "s02", "--file", join(dir, "made.gif")], ["export"]]) {
      const r = run(dir, argv);
      expect({ argv, code: r.code }).toEqual({ argv, code: 1 });
      expect(r.err).toContain(`another sticker.mjs gen (pid ${first.pid}`);
      expect(r.err).toContain("is working in this workspace");
    }
    // Nothing was sent or recorded by the refused commands; the take in flight is untouched.
    expect(gifCalls(dir)).toHaveLength(1);
    expect(assetOf(dir, "s01-take-1").status).toBe("generating");
    expect(assetOf(dir, "s02-take-1")).toBeUndefined();
    for (const argv of [["status"], ["quote"], ["prompts"], ["gen", "--dry-run"]]) expect({ argv, code: run(dir, argv).code }).toEqual({ argv, code: 0 });
    first.kill("SIGINT");
    expect(await first.exited).toBe(130);
    expect(existsSync(join(dir, ".sticker.lock"))).toBe(false);
  }, 30_000);

  test("a lock whose process is gone is reported and taken over", () => {
    const dir = workspace({ stickers: 1 });
    const gone = Bun.spawnSync([process.execPath, "-e", "process.pid"]);
    expect(gone.exitCode).toBe(0);
    writeFileSync(join(dir, ".sticker.lock"), JSON.stringify({ pid: gone.pid, command: "export", startedAt: "2026-11-06T10:00:00.000Z" }));
    const r = run(dir, ["import", "--character", "--file", join(dir, "photo.webp")]);
    expect(r.code).toBe(0);
    expect(r.err).toContain(`left by sticker.mjs export (pid ${gone.pid}, started 2026-11-06T10:00:00.000Z), which is no longer running`);
    expect(assetOf(dir, "character-2").status).toBe("ready");
    expect(existsSync(join(dir, ".sticker.lock"))).toBe(false);
  });

  test("export refuses a symlinked platform directory before writing or deleting anything", () => {
    const dir = workspace({ stickers: 2 });
    ok(dir, ["gen"]);
    editPack(dir, (p) => {
      p.platforms = ["wechat"];
      p.stickers[0].take = "s01-take-1";
      p.stickers[1].take = "s02-take-1";
    });
    const outside = fresh();
    writeFileSync(join(outside, "05.gif"), "not ours");
    mkdirSync(join(dir, "exports"));
    symlinkSync(outside, join(dir, "exports", "wechat"));
    const r = run(dir, ["export", "--platform", "wechat"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("exports/wechat is a symbolic link");
    expect(readdirSync(outside)).toEqual(["05.gif"]);
    expect(readFileSync(join(outside, "05.gif"), "utf-8")).toBe("not ours");
    expect(project(dir).assets.some((a: { id: string }) => a.id.startsWith("wechat-"))).toBe(false);
  });

  test("picks and edits: a changed caption makes the picked take stale, with the reason", () => {
    const dir = workspace({ stickers: 2 });
    ok(dir, ["gen"]);
    editPack(dir, (p) => {
      p.stickers[0].take = "s01-take-1";
      p.stickers[1].take = "s02-take-1";
    });
    expect(ok(dir, ["status"]).stickers.map((s: { status: string }) => s.status)).toEqual(["ready", "ready"]);
    editPack(dir, (p) => {
      p.stickers[1].caption = "好嘞";
    });
    const s = ok(dir, ["status"]);
    expect(s.stickers[1]).toMatchObject({ status: "stale", reason: "caption changed" });
    expect(s.next).toMatchObject({ id: "reroll", command: "sticker.mjs gen --only s02 --redo" });
  });

  test("import: a GIF the user made is an upload by the human, with the prompt and anchor it answers to", () => {
    const dir = workspace({ stickers: 2 });
    writeFileSync(join(dir, "made.gif"), structuralGif(12, { delayCs: 10, width: 480, height: 480 }));
    const out = ok(dir, ["import", "--sticker", "s02", "--file", join(dir, "made.gif")]);
    expect(out).toMatchObject({ id: "s02-take-1", uri: "stickers/s02/take-1.gif" });
    const edge = edgeOf(dir, "s02-take-1");
    expect(edge.fromAssetId).toBe("character-1");
    expect(edge.operation).toMatchObject({ type: "upload", actor: "human" });
    const pack = packOf(dir);
    expect(edge.operation.params.prompt).toBe(S.stickerPrompt(pack, pack.stickers[1]));
    expect(summarizeCosts(project(dir)).calls).toBe(1); // only the character call — an upload is not a call
    expect(project(dir).sticker.measures["s02-take-1"]).toMatchObject({ frames: 12, width: 480, delaysMs: Array(12).fill(100) });
    writeFileSync(join(dir, "still.gif"), structuralGif(1));
    expect(run(dir, ["import", "--sticker", "s01", "--file", join(dir, "still.gif")]).err).toContain("a sticker take is animated");
    writeFileSync(join(dir, "fake.gif"), "GIF? no");
    expect(run(dir, ["import", "--sticker", "s01", "--file", join(dir, "fake.gif")]).err).toContain("is not a usable GIF");
    expect(run(dir, ["import", "--file", join(dir, "made.gif")]).err).toContain("exactly one of");
  });

  test("check: the CLI's rows are checkPack's rows, and a failing row exits 1", () => {
    const dir = workspace({ stickers: 2 });
    ok(dir, ["gen"]);
    const r = run(dir, ["check", "--json"]);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.out);
    const pack = packOf(dir);
    for (const platform of pack.platforms) expect(out.platforms[platform].rows).toEqual(S.checkPack(pack, project(dir), platform));
    expect(run(dir, ["check", "--platform", "weibo"]).err).toContain("--platform must be");
  });
});
