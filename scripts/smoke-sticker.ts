// scripts/smoke-sticker.ts — local end-to-end smoke harness for sticker in the player.
//
// Materializes a TWO-checkpoint play package from the shipped 打工牛马 seed and
// serves it alongside the player build from ONE origin. Single origin is the
// point: the content service worker (`public/player-content-sw.js`) only
// intercepts same-origin `/content/*`, so a package served from anywhere else
// silently bypasses the layer under test.
//
//   checkpoint 1  the seed as shipped — eight picked stickers, re-rolls kept as
//                 takes, all art, NO exports (every submission tab reads "not
//                 exported yet")
//   checkpoint 2  the same workspace after the mode's own
//                 `sticker.mjs export --platform all` (free, ffmpeg, ~26 s):
//                 WeChat GIFs, Telegram VP9+alpha WebMs, LINE APNGs, the art
//                 deliverables, three upload zips — all recorded in project.json
//
// What this exercises that a unit test cannot: the viewer reads only pack.json
// and project.json as text (`src/replay/provider.ts` feeds the store text
// files); every one of the ~40 MB of GIF / WebM / APNG / PNG / zip bytes has
// to arrive through the service worker at `/content/<uri>?r=<createdAt>`, the
// WebMs with Range support so `<video>` can loop them, and the GIF takes as a
// `fetch()` the frame strip decodes with ImageDecoder.
//
// Needs: `dist-player/` (bunx vite build --config vite.player.config.ts),
// node and ffmpeg on PATH (the export script's own requirements).
//
// Open: http://localhost:18126/player.html?pkg=/plays/sticker-smoke
// (STICKER_SMOKE_PORT overrides the port.)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";
import type { CheckpointManifest, PlayPackageIndex } from "../core/types/play-package.js";

/** Repo root, derived from this file rather than cwd, so the harness runs from anywhere. */
const repoRoot = resolve(import.meta.dir, "..");
const PORT = Number(process.env.STICKER_SMOKE_PORT ?? 18126);
const PACKAGE_ID = "sticker-smoke";

const distPlayer = join(repoRoot, "dist-player");
if (!existsSync(join(distPlayer, "player.html"))) {
  console.error(
    "[smoke] dist-player/player.html missing — build the player first:\n" +
      "        bunx vite build --config vite.player.config.ts",
  );
  process.exit(1);
}

// Both temp trees are ours and get removed on the way out — the package is
// ~45 MB of blobs and the harness is run repeatedly during verification.
const serveRoot = mkdtempSync(join(tmpdir(), "smoke-sticker-serve-"));
const ws = mkdtempSync(join(tmpdir(), "smoke-sticker-ws-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(serveRoot, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}

function fail(message: string): never {
  console.error(`[smoke] ${message}`);
  process.exit(1);
}

mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync(distPlayer, serveRoot, { recursive: true });

// `init.seedFiles` copies `modes/sticker/seed/niuma/` to the workspace ROOT
// (one pack per workspace, no content sets), so the package has the shape a
// real session has: pack.json, project.json, stickers/, art/, character/.
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
cpSync(join(repoRoot, "modes/sticker/seed/niuma"), ws, { recursive: true });
await enqueueCheckpoint(ws, 1);

// Turn 2: the mode's own deterministic export, exactly as the agent runs it.
const script = join(repoRoot, "modes/sticker/skill/scripts/sticker.mjs");
console.log("[smoke] exporting every platform (ffmpeg, ~30 s)…");
const started = Date.now();
const exporter = Bun.spawn(["node", script, "export", "--platform", "all", "--dir", ws], {
  stdout: "pipe",
  stderr: "pipe",
});
const [exportOut, exportErr, exportExit] = await Promise.all([
  new Response(exporter.stdout).text(),
  new Response(exporter.stderr).text(),
  exporter.exited,
]);
if (exportExit !== 0) fail(`sticker.mjs export exited ${exportExit}\n${exportOut}\n${exportErr}`);
console.log(`[smoke] export done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
await enqueueCheckpoint(ws, 2);

writeFileSync(
  join(ws, ".pneuma", "session.json"),
  JSON.stringify({ sessionId: PACKAGE_ID, mode: "sticker", backendType: "claude-code", createdAt: Date.now() }),
);
writeFileSync(
  join(ws, ".pneuma", "history.json"),
  JSON.stringify([
    {
      type: "user_message",
      content: "把打工牛马做成一套工作群表情：收到、马上、稍等、辛苦了、加班、摸鱼、下班、不想上班。微信、Telegram、LINE 都要。",
      timestamp: 1000,
      id: "u1",
    },
    {
      type: "assistant",
      message: {
        id: "a1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "八张都画好并选定了：加班那张重画过一次，两个 take 都留着。封面、图标和横幅也有了。还没导出——各平台的文件要跑一次 export 才会出现。",
          },
          { type: "tool_use", name: "Write", input: { file_path: "pack.json" } },
        ],
        model: "fixture",
        stop_reason: "end_turn",
      },
      timestamp: 1500,
    },
    { type: "result", data: { num_turns: 1 } },
    { type: "user_message", content: "导出吧，三个平台都要。", timestamp: 2000, id: "u2" },
    {
      type: "assistant",
      message: {
        id: "a2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "node .claude/skills/pneuma-sticker/scripts/sticker.mjs export --platform all" },
          },
          {
            type: "text",
            text: "导出完成：微信 8 张 GIF 加封面、图标、横幅；Telegram 8 个透明 WebM 加缩略图；LINE 8 张 APNG 加主图和标签图。三个平台的检查都没有失败项，LINE 只剩一条提醒：压缩包里的文件名规则来自第三方说明，上传时再确认一下。",
          },
        ],
        model: "fixture",
        stop_reason: "end_turn",
      },
      timestamp: 2500,
    },
    { type: "result", data: { num_turns: 1 } },
  ]),
);

const out = join(serveRoot, "plays", PACKAGE_ID);
const res = await materializePlayPackage(ws, {
  output: out,
  title: "打工牛马 — work-chat stickers (sticker)",
  importUrl: "https://example.invalid/histories/sticker.tar.gz",
});

// The package must carry the two states the timeline is meant to show; say so
// here rather than discovering a one-checkpoint package in the browser.
const checkpoints = res.index.manifest.checkpoints.filter((c) => c.hash);
if (checkpoints.length !== 2) fail(`expected 2 checkpoints, got ${checkpoints.length}`);
const trees = checkpoints.map(
  (c) => JSON.parse(readFileSync(join(out, "checkpoints", `${c.hash}.json`), "utf8")) as CheckpointManifest,
);
const paths = trees.map((t) => new Set(t.files.map((f) => f.path)));
if ([...paths[0]].some((p) => p.startsWith("exports/"))) fail("checkpoint 1 already carries exports/");
for (const p of [
  "pack.json",
  "project.json",
  "exports/wechat/01.gif",
  "exports/wechat.zip",
  "exports/telegram/01.webm",
  "exports/telegram.zip",
  "exports/line/01.png",
  "exports/line/main.png",
  "exports/line.zip",
]) {
  if (!paths[1].has(p)) fail(`checkpoint 2 is missing ${p}`);
}
console.log(
  "[smoke] sticker-smoke:",
  res.index.id,
  "supported:",
  res.index.supported,
  "checkpoints:",
  res.checkpointCount,
  `(${trees.map((t) => t.files.length).join(" → ")} files)`,
  "blobs:",
  res.blobCount,
  "bytes:",
  res.totalBytes,
);

// Before sticker is whitelisted the exporter stamps `supported: false`, and the
// shell would only ever show the local-client fallback — the harness meant to
// EARN the entry could not reach the viewer. `isPackagePlayable` trusts a
// positive stamp on purpose ("loadMode still arbitrates"), so forcing it is the
// sanctioned way through, as in smoke-sprite.ts. Once sticker is in
// WEB_PLAYER_SUPPORTED_MODES the exporter stamps true itself and this is skipped.
if (!res.index.supported) {
  const forced: PlayPackageIndex = { ...res.index, supported: true };
  writeFileSync(join(out, "play.json"), JSON.stringify(forced));
  console.log(`[smoke] forced supported:true — "${res.index.mode}" is not in WEB_PLAYER_SUPPORTED_MODES yet`);
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/player.html";
    if (p.split("/").includes("..")) return new Response("invalid path", { status: 400 });
    const file = Bun.file(join(serveRoot, p));
    if (await file.exists()) return new Response(file);
    if (p.startsWith("/s/")) return new Response(Bun.file(join(serveRoot, "player.html")));
    return new Response("not found", { status: 404 });
  },
});
console.log(`[smoke] package: ${out}`);
console.log(`[smoke] serving http://localhost:${PORT}/player.html?pkg=/plays/${PACKAGE_ID}`);
