#!/usr/bin/env bun
/**
 * Record the 0.6.0 showcase compositions (`game.html`) into the launcher's
 * highlight videos: each view rendered frame by frame at a fixed time step
 * (`window.renderAt(t)` — sprites, clips and 3D all driven by `t`, so a
 * frame is the same picture on every run), screenshotted through headless
 * Chrome's DevTools protocol and encoded to H.264.
 *
 *   bun modes/sprite/showcase/record.mjs <artwork dir> [view …] [--fps 15] [--seconds 6] [--posters]
 *
 * `<artwork dir>` is the workspace the assets were made in (served as
 * `/art/`); it is not committed. Chrome is the system install.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const fps = Number(flag("--fps", "15"));
const seconds = Number(flag("--seconds", "6"));
const chromePath = flag("--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const posterAt = args.indexOf("--posters");
const posters = posterAt >= 0 ? Boolean(args.splice(posterAt, 1)) : false;
const artwork = resolve(args.shift() ?? ".tmp-sprite-showcase");
const VIEWS = {
  hero: { file: "hero.mp4", seconds: 6 },
  moveset: { file: "highlight-move-sets.mp4", seconds: 6 },
  storyboard: { file: "highlight-storyboard.mp4", seconds: 5.6 },
  dirs: { file: "highlight-eight-directions.mp4", seconds: 5 },
  props: { file: "highlight-props.mp4", seconds: 4 },
  looks: { file: "highlight-outfits.mp4", seconds: 1 },
  restyle: { file: "highlight-restyle.mp4", seconds: 4 },
  transfer: { file: "highlight-motion-library.mp4", seconds: 4.8 },
  model: { file: "highlight-3d-model.mp4", seconds: 6 },
  cutscene: { file: "highlight-cutscene.mp4", seconds: 8 },
};
const views = args.length ? args : Object.keys(VIEWS);

const roots = {
  "/art/": artwork,
  "/fonts/": resolve(here, "../../../public/fonts"),
  "/three/": resolve(here, "../../../node_modules/three"),
};
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".mp4": "video/mp4", ".glb": "model/gltf-binary", ".png": "image/png", ".woff2": "font/woff2" };
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/") return new Response(Bun.file(join(here, "game.html")), { headers: { "content-type": "text/html" } });
    for (const [prefix, root] of Object.entries(roots)) {
      if (!path.startsWith(prefix)) continue;
      const file = resolve(root, path.slice(prefix.length));
      if (!file.startsWith(root + sep)) break;
      const data = Bun.file(file);
      if (!(await data.exists())) break;
      const ext = file.slice(file.lastIndexOf("."));
      return new Response(data, { headers: { "content-type": types[ext] ?? data.type } });
    }
    return new Response("Not found", { status: 404 });
  },
});

const profile = mkdtempSync(join(tmpdir(), "sprite-record-"));
const debugPort = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  "--window-size=1376,768", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--enable-unsafe-swiftshader", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 100 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page");
  } catch {}
  if (!target) await sleep(150);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
await send("Emulation.setDeviceMetricsOverride", { width: 1376, height: 768, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");

try {
  for (const view of views) {
    const spec = VIEWS[view];
    if (!spec) throw new Error(`no view '${view}' (${Object.keys(VIEWS).join(", ")})`);
    await send("Page.navigate", { url: `${server.url}?view=${view}` });
    for (let i = 0; i < 300 && !(await evaluate("window.ready === true").catch(() => false)); i++) await sleep(200);
    const frames = Math.max(1, Math.round((spec.seconds ?? seconds) * fps));
    const out = join(here, spec.file);
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    for (let i = 0; i < frames; i++) {
      await evaluate(`window.renderAt(${(i / fps).toFixed(4)})`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      ffmpeg.stdin.write(Buffer.from(shot.result.data, "base64"));
    }
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on("close", r));
    // A still: the hero's is the launcher card (`showcase.json` hero); the
    // others only with --posters, for looking at a frame without a player.
    if (view === "hero" || posters) {
      await evaluate(`window.renderAt(${((spec.seconds ?? seconds) / 3).toFixed(4)})`);
      const poster = await send("Page.captureScreenshot", { format: "png" });
      await Bun.write(out.replace(/\.mp4$/, ".png"), Buffer.from(poster.result.data, "base64"));
    }
    console.log(`${view}: ${frames} frames → ${out}`);
  }
} finally {
  ws.close();
  chrome.kill();
  server.stop();
  rmSync(profile, { recursive: true, force: true });
}
