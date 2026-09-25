/**
 * The `.riv` `sprite-sheet.mjs rive` writes, played by the OFFICIAL runtime.
 *
 * The structural tests decode the file with an independent key table; this is
 * the other half. A property written under a wrong key is not an error in
 * Rive — the runtime skips what it does not know — so a file can decode
 * perfectly and still play nothing, or play every frame at the artboard's
 * origin. The only proof is the runtime itself: `@rive-app/canvas` (the
 * pinned version the viewer ships) in headless Chrome, driven over the
 * DevTools protocol, on the Lumi seed.
 *
 * Two files. The first is the Lumi seed plus a loop:
 *  - it opens, with one timeline per motion, the number input `motion` for
 *    the loops and a trigger for the one-shot;
 *  - the first frame on the canvas is `idle/frames/00.png`, placed by its
 *    atlas pivot on the artboard's anchor (and a placement 4 px off is
 *    measurably worse, so the comparison can tell);
 *  - `play_attack` plays the attack and the machine settles back into idle;
 *  - a LOOP, resampled into the file, is entered by setting `motion` and
 *    plays until `motion` names another loop. The seed has no loop, so one is
 *    made from idle's 16 frames and registered as a 48 fps loop (`spin`);
 *    `--include-loops` takes it to the 24 fps default, 8 frames.
 * The second is connected: a hub (`calm`), two loops (`spin`, `sway`), the
 * clip `calm-to-spin` and its reverse, and the attack. Setting `motion`
 * routes through the clips, every state leaves only at the end of its cycle
 * or its clip, and a one-shot hands back to the loop `motion` names.
 *
 * A third pair proves trimming changes nothing on screen: the same frames
 * written untrimmed and trimmed (`riveTrimRect`, `riveTrimmedPosition`),
 * each frame drawn by the runtime and read back off the canvas, at 1:1 and
 * scaled — including a frame whose silhouette runs to the edge of its frame
 * and of the artboard, and a frame with nothing visible.
 *
 * Live tier: it launches a real browser and runs a real ffmpeg pipeline.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { riveTimeline, riveTrimRect, writeRiv } from "../skill/scripts/rive.mjs";
import {
  announceLiveTierSkip,
  LIVE_TIER,
  LIVE_TIER_LABEL,
} from "../../../core/__tests__/test-tier.js";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const SEED = join(import.meta.dir, "..", "seed", "lumi");
const require = createRequire(import.meta.url);
const RUNTIME_DIR = dirname(require.resolve("@rive-app/canvas/package.json"));

// Module-level probes run during collection, so they are gated too.
const CHROME = LIVE_TIER
  ? [
      process.env.CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].find((path): path is string => !!path && existsSync(path))
  : undefined;
const HAS_FFMPEG = LIVE_TIER && spawnSync("ffprobe", ["-version"]).status === 0;

announceLiveTierSkip("the .riv played in the official Rive runtime in headless Chrome");
if (LIVE_TIER && !CHROME) console.log("[rive-runtime] no Chrome found (set CHROME_PATH) — skipped");
if (LIVE_TIER && !HAS_FFMPEG) console.log("[rive-runtime] no ffmpeg/ffprobe on PATH — skipped");

interface RiveReport {
  out: string;
  artboard: { width: number; height: number; anchor: { x: number; y: number } };
  motions: Array<{ id: string; seconds: number; frames: number; fps: number; kind: string; shares?: string }>;
  stateMachine: {
    inputs: Array<{ name: string; type: string; values?: Array<{ value: number; motion: string }> }>;
  };
}

/**
 * Register a clip motion in a copied seed, made of another motion's frames:
 * a `loop`, or a `transition` between two loops. A transition with
 * `reverseOf` is that transition's frames backwards, with the `reverse`
 * edges `register-run` writes, so the `.riv` draws it from the source.
 */
function addClipMotion(
  character: string,
  motion: { id: string; kind: "loop" | "transition"; framesOf: string; count?: number; fps: number; from?: string; to?: string; reverseOf?: string },
) {
  const path = join(character, "project.json");
  const doc = JSON.parse(readFileSync(path, "utf-8"));
  const of = doc.sprite.motions.find((m: { id: string }) => m.id === motion.framesOf);
  const sourceIds: string[] = of.frames.slice(0, motion.count ?? of.frames.length);
  const order = motion.reverseOf ? [...sourceIds].reverse() : sourceIds;
  const frames = join(character, "motions", motion.id, "frames");
  mkdirSync(frames, { recursive: true });
  const now = Date.now();
  const ids = order.map((id: string, i: number) => {
    const source = doc.assets.find((a: { id: string }) => a.id === id);
    const name = `${String(i).padStart(3, "0")}.png`;
    copyFileSync(join(character, source.uri), join(frames, name));
    const frameId = `${motion.id}-frame-${String(i).padStart(3, "0")}`;
    doc.assets.push({ ...source, id: frameId, uri: `motions/${motion.id}/frames/${name}`, name: `${motion.id} frame ${i}`, createdAt: now });
    if (motion.reverseOf) {
      doc.provenance.push({
        toAssetId: frameId,
        fromAssetId: `${motion.reverseOf}-frame-${String(order.length - 1 - i).padStart(3, "0")}`,
        operation: { type: "derive", actor: "agent", timestamp: now + 1, params: { step: "reverse", frameIndex: i } },
      });
    }
    return frameId;
  });
  doc.sprite.motions.push({
    id: motion.id, label: motion.id, prompt: "", kind: motion.kind, grid: { rows: 1, cols: 1 }, fps: motion.fps,
    loop: motion.kind === "loop", anchor: "bottom", status: "ready", source: "video", frames: ids, videos: [],
    ...(motion.kind === "transition" ? { from: motion.from, to: motion.to } : {}),
    ...(motion.reverseOf ? { reverseOf: motion.reverseOf } : {}),
  });
  writeFileSync(path, JSON.stringify(doc));
}

async function rive(character: string, ...flags: string[]): Promise<RiveReport> {
  const proc = Bun.spawn(["node", SCRIPT, "rive", character, ...flags, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`rive failed: ${stderr}`);
  return JSON.parse(stdout);
}

/** A PNG's pixels as straight RGBA, decoded by ffmpeg. */
function rgbaOf(path: string) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 26 });
  return { width, height, data: r.stdout as Buffer };
}

/** One frame through ffmpeg: `-vf` applied, written as an RGBA PNG. */
function ffmpegPng(input: string, out: string, filter: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-frames:v", "1", "-vf", filter, "-pix_fmt", "rgba", out]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return out;
}

/**
 * The same five frames as two files: embedded whole, as the released writer
 * did, and trimmed the way `sprite-sheet.mjs rive` trims them. Pivots are
 * fractional so the runtime samples between pixels.
 */
function trimPair(dir: string) {
  const idle = join(SEED, "motions", "idle", "frames");
  const size = rgbaOf(join(idle, "00.png"));
  // Cut off below the knees: the silhouette runs to the frame's bottom edge,
  // which the anchor puts on the artboard's bottom edge.
  const edge = ffmpegPng(join(idle, "05.png"), join(dir, "edge.png"), `crop=iw:ih-40:0:0`);
  const empty = ffmpegPng(join(idle, "00.png"), join(dir, "empty.png"), "format=rgba,geq=r=0:g=0:b=0:a=0");
  const frames = [
    { path: join(idle, "00.png"), pivot: { x: 93.37, y: 244.0116 } },
    { path: join(idle, "04.png"), pivot: { x: 92.81, y: 243.5 } },
    // 9.37 px of it below the anchor, more than any other frame: its last
    // row is the artboard's last row.
    { path: edge, pivot: { x: 93.37, y: size.height - 40 - 9.37 } },
    { path: empty, pivot: { x: 93.37, y: 244.0116 } },
    { path: join(idle, "10.png"), pivot: { x: 93.5, y: 244.25 } },
  ];
  let left = 0, right = 0, top = 0, bottom = 0;
  for (const f of frames) {
    const { width, height } = rgbaOf(f.path);
    left = Math.max(left, f.pivot.x); right = Math.max(right, width - f.pivot.x);
    top = Math.max(top, f.pivot.y); bottom = Math.max(bottom, height - f.pivot.y);
  }
  const anchor = { x: Math.ceil(left - 1e-6), y: Math.ceil(top - 1e-6) };
  const artboard = { name: "Trim", width: anchor.x + Math.ceil(right - 1e-6), height: anchor.y + Math.ceil(bottom - 1e-6) };
  const whole = frames.map((f) => {
    const { width, height } = rgbaOf(f.path);
    return { bytes: readFileSync(f.path), width, height, pivot: f.pivot, ext: "png" as const };
  });
  const trimmed = frames.map((f, i) => {
    const image = rgbaOf(f.path);
    const rect = riveTrimRect(image.data, image.width, image.height) ?? { x: 0, y: 0, width: 1, height: 1 };
    const out = ffmpegPng(f.path, join(dir, `trim-${i}.png`), `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`);
    return {
      bytes: readFileSync(out), width: rect.width, height: rect.height, pivot: f.pivot, ext: "png" as const,
      trim: { x: rect.x, y: rect.y, width: image.width, height: image.height },
    };
  });
  const write = (name: string, list: typeof whole) => {
    const out = join(dir, name);
    const written = writeRiv({ artboard, anchor, motions: [{ id: "m", fps: 8, loop: true, frames: list }] });
    writeFileSync(out, written.bytes);
    return { out, inexactPlacements: written.inexactPlacements };
  };
  const cut = write("trim-cut.riv", trimmed);
  return {
    full: write("trim-full.riv", whole).out,
    cut: cut.out,
    inexactPlacements: cut.inexactPlacements,
    artboard,
    times: riveTimeline(8, frames.length).keys.map((key, i) => (key + (i + 1 < frames.length ? 0.5 : 0.25)) / 8),
    edgeBottom: anchor.y + (size.height - 40) - frames[2].pivot.y,
    fullBytes: whole.reduce((sum, f) => sum + f.width * f.height * 4, 0),
    cutBytes: trimmed.reduce((sum, f) => sum + f.width * f.height * 4, 0),
  };
}

/** A page that draws one frame of a `.riv` and hands back the canvas pixels. */
const GRAB_PAGE = `<!doctype html>
<html><body style="margin:0;background:transparent">
<canvas id="c"></canvas>
<script src="/rive.js"></script>
<script>
rive.RuntimeLoader.setWasmUrl("/rive.wasm");
rive.RuntimeLoader.setWasmFallbackUrl(null);
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
window.loaded = Promise.resolve(true);
window.grab = (src, t, w, h, fit) => new Promise((resolve, reject) => {
  const canvas = document.getElementById("c");
  canvas.width = w; canvas.height = h;
  const r = new rive.Rive({
    src, canvas, animations: "m", autoplay: false, enableRiveAssetCDN: false,
    layout: new rive.Layout({ fit: fit === "none" ? rive.Fit.None : rive.Fit.Contain, alignment: rive.Alignment.TopLeft }),
    onLoadError: (e) => reject(new Error(String((e && e.data) || e))),
    onLoad: async () => {
      r.scrub("m", t);
      for (let i = 0; i < 4; i++) await raf();
      const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
      r.cleanup();
      let bin = "";
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      resolve(btoa(bin));
    },
  });
});
</script></body></html>`;

/** A minimal DevTools-protocol client over Bun's WebSocket. */
async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
  });
  let next = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = message.id ? pending.get(message.id) : undefined;
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, close: () => ws.close() };
}

const PAGE = (src: string, w: number, h: number) => `<!doctype html>
<html><body style="margin:0;background:transparent">
<canvas id="c" width="${w}" height="${h}" style="width:${w}px;height:${h}px"></canvas>
<script src="/rive.js"></script>
<script>
rive.RuntimeLoader.setWasmUrl("/rive.wasm");
rive.RuntimeLoader.setWasmFallbackUrl(null);
window.states = [];
window.loaded = new Promise((resolve, reject) => {
  window.r = new rive.Rive({
    src: "${src}",
    canvas: document.getElementById("c"),
    stateMachines: "State Machine 1",
    autoplay: true,
    enableRiveAssetCDN: false,
    layout: new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
    onLoad: () => resolve(performance.now()),
    onLoadError: (e) => reject(new Error(String((e && e.data) || e))),
    onStateChange: (e) => window.states.push({ t: performance.now(), names: e.data }),
  });
});
</script></body></html>`;

describe.skipIf(!LIVE_TIER || !CHROME || !HAS_FFMPEG)(
  `the .riv in the official Rive runtime ${LIVE_TIER_LABEL}`,
  () => {
    let root = "";
    let report: RiveReport;
    let connected: RiveReport;
    let server: ReturnType<typeof Bun.serve> | null = null;
    let chrome: ReturnType<typeof Bun.spawn> | null = null;
    let client: Awaited<ReturnType<typeof connect>> | null = null;
    let evaluate: (expression: string) => Promise<any>;
    let open: (page: string) => Promise<(expression: string) => Promise<any>>;
    let pivot = { x: 0, y: 0 };
    let pair: ReturnType<typeof trimPair>;

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), "pneuma-rive-runtime-"));
      cpSync(SEED, join(root, "lumi"), { recursive: true });
      addClipMotion(join(root, "lumi"), { id: "spin", kind: "loop", framesOf: "idle", fps: 48 });
      report = await rive(join(root, "lumi"), "--include-loops");

      // calm (hub, 16 frames at 8 fps: 2 s), spin (1/3 s), sway (attack's 16
      // frames at 32 fps → 12 at 24: 0.5 s), calm-to-spin (attack's first
      // six at 12 fps: 0.5 s) and spin-to-calm, its reverse.
      const other = join(root, "connected");
      cpSync(SEED, other, { recursive: true });
      addClipMotion(other, { id: "calm", kind: "loop", framesOf: "idle", fps: 8 });
      addClipMotion(other, { id: "spin", kind: "loop", framesOf: "idle", fps: 48 });
      addClipMotion(other, { id: "sway", kind: "loop", framesOf: "attack", fps: 32 });
      addClipMotion(other, { id: "calm-to-spin", kind: "transition", framesOf: "attack", count: 6, fps: 12, from: "calm", to: "spin" });
      addClipMotion(other, { id: "spin-to-calm", kind: "transition", framesOf: "calm-to-spin", fps: 12, from: "spin", to: "calm", reverseOf: "calm-to-spin" });
      connected = await rive(other, "--motions", "calm,spin,sway,calm-to-spin,spin-to-calm,attack", "--hub", "calm");

      const atlas = JSON.parse(readFileSync(join(root, "lumi", "motions", "idle", "atlas.json"), "utf-8"));
      const first = atlas.frames[atlas.animations.idle[0]];
      pivot = { x: first.pivot.x * first.sourceSize.w, y: first.pivot.y * first.sourceSize.h };

      pair = trimPair(mkdtempSync(join(root, "trim-")));

      const files: Record<string, string> = {
        "/trim-full.riv": pair.full,
        "/trim-cut.riv": pair.cut,
        "/rive.js": join(RUNTIME_DIR, "rive.js"),
        "/rive.wasm": join(RUNTIME_DIR, "rive.wasm"),
        "/file.riv": report.out,
        "/connected.riv": connected.out,
        "/frame-00.png": join(root, "lumi", "motions", "idle", "frames", "00.png"),
        "/frame-01.png": join(root, "lumi", "motions", "idle", "frames", "01.png"),
      };
      const types: Record<string, string> = { js: "application/javascript", wasm: "application/wasm", png: "image/png" };
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/page.html") {
            return new Response(PAGE("/file.riv", report.artboard.width, report.artboard.height), {
              headers: { "Content-Type": "text/html" },
            });
          }
          if (path === "/grab.html") return new Response(GRAB_PAGE, { headers: { "Content-Type": "text/html" } });
          if (path === "/connected.html") {
            return new Response(PAGE("/connected.riv", connected.artboard.width, connected.artboard.height), {
              headers: { "Content-Type": "text/html" },
            });
          }
          const file = files[path];
          if (!file) return new Response("not found", { status: 404 });
          const type = types[path.split(".").pop() ?? ""] ?? "application/octet-stream";
          return new Response(Bun.file(file), { headers: { "Content-Type": type } });
        },
      });

      const profile = join(root, "profile");
      chrome = Bun.spawn(
        [
          CHROME!,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--force-device-scale-factor=1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      // Chrome writes the port it bound, and the browser endpoint, here.
      const portFile = join(profile, "DevToolsActivePort");
      for (let i = 0; i < 150 && !existsSync(portFile); i++) await Bun.sleep(100);
      const [port, path] = readFileSync(portFile, "utf-8").trim().split("\n");
      client = await connect(`ws://127.0.0.1:${port}${path}`);
      open = async (page: string) => {
        const { targetId } = await client!.send("Target.createTarget", {
          url: `http://127.0.0.1:${server!.port}/${page}`,
        });
        const { sessionId } = await client!.send("Target.attachToTarget", { targetId, flatten: true });
        const run = async (expression: string) => {
          // Only the front tab gets animation frames; the other page would
          // stand still, and its machine with it.
          await client!.send("Page.bringToFront", {}, sessionId);
          const result = await client!.send(
            "Runtime.evaluate",
            { expression, awaitPromise: true, returnByValue: true },
            sessionId,
          );
          if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
          }
          return result.result.value;
        };
        // The target starts on about:blank and then navigates: an evaluation
        // that lands in between loses its context, which is not a failure of
        // the page — ask again until the page's own promise answers.
        for (let attempt = 0; ; attempt++) {
          try {
            await run(`(async () => {
              for (let i = 0; i < 200 && !window.loaded; i++) await new Promise((r) => setTimeout(r, 50));
              await window.loaded;
              return true;
            })()`);
            break;
          } catch (error) {
            if (attempt >= 50 || !/context/i.test(String(error))) throw error;
            await Bun.sleep(100);
          }
        }
        return run;
      };
      evaluate = await open("page.html");
    }, 120_000);

    afterAll(() => {
      client?.close();
      chrome?.kill();
      server?.stop(true);
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test("the file opens with a timeline per motion, a number for the loops and a trigger for the one-shot", async () => {
      const contents = await evaluate(`(() => {
        const board = r.contents.artboards[0];
        return {
          animations: board.animations,
          machines: board.stateMachines.map((m) => ({ name: m.name, inputs: m.inputs.map((i) => i.name) })),
          motion: r.stateMachineInputs("State Machine 1").find((i) => i.name === "motion").value,
        };
      })()`);
      expect(contents.animations).toEqual(["idle", "attack", "spin"]);
      expect(contents.machines).toEqual([{ name: "State Machine 1", inputs: ["motion", "play_attack"] }]);
      // It starts naming the hub: idle is loop 0.
      expect(report.stateMachine.inputs[0].values).toEqual([{ value: 0, motion: "idle" }, { value: 1, motion: "spin" }]);
      expect(contents.motion).toBe(0);
    });

    test("the first frame is idle's frame 00, standing on the anchor", async () => {
      // Read the canvas within idle's first frame (125 ms at 8 fps), and draw
      // the PNG the pipeline aligned at the place the atlas pivot says. Both
      // are compared pixel by pixel; the same comparison against a placement
      // 4 px off must come out clearly worse, or it proves nothing.
      const result = await evaluate(`(async () => {
        const canvas = document.getElementById("c");
        const w = canvas.width, h = canvas.height;
        const shown = canvas.getContext("2d").getImageData(0, 0, w, h).data;
        const elapsed = performance.now() - (await window.loaded);
        const load = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
        const diff = async (src, dx, dy) => {
          const img = await load(src);
          const off = document.createElement("canvas");
          off.width = w; off.height = h;
          const ctx = off.getContext("2d");
          ctx.drawImage(img, ${report.artboard.anchor.x} - ${pivot.x} + dx, ${report.artboard.anchor.y} - ${pivot.y} + dy);
          const want = ctx.getImageData(0, 0, w, h).data;
          let sum = 0, n = 0;
          for (let i = 0; i < want.length; i += 4) {
            if (want[i + 3] === 0 && shown[i + 3] === 0) continue;
            sum += Math.abs(want[i + 3] - shown[i + 3]);
            n++;
          }
          return n ? sum / n : 255;
        };
        return {
          elapsed,
          opaque: Array.from({ length: shown.length / 4 }, (_, i) => shown[i * 4 + 3]).filter((a) => a > 0).length,
          frame0: await diff("/frame-00.png", 0, 0),
          frame1: await diff("/frame-01.png", 0, 0),
          shifted: await diff("/frame-00.png", 4, 4),
        };
      })()`);
      // Something is drawn at all — a wrong key leaves an empty canvas.
      expect(result.opaque).toBeGreaterThan(1000);
      const best = Math.min(result.frame0, result.frame1);
      // Mean alpha difference over the character's pixels, 0–255.
      expect(best).toBeLessThan(12);
      expect(result.shifted).toBeGreaterThan(best * 3);
    }, 30_000);

    test("play_attack plays the attack once and settles back into idle", async () => {
      const attack = report.motions.find((m) => m.id === "attack")!;
      const log = await evaluate(`(async () => {
        const fired = performance.now();
        r.stateMachineInputs("State Machine 1").find((i) => i.name === "play_attack").fire();
        await new Promise((res) => setTimeout(res, ${Math.round(attack.seconds * 1000) + 900}));
        return window.states
          .filter((s) => s.t >= fired)
          .map((s) => ({ ms: Math.round(s.t - fired), names: s.names }));
      })()`);
      const names = log.flatMap((entry: { names: string[] }) => entry.names);
      expect(names).toContain("attack");
      expect(names.lastIndexOf("idle")).toBeGreaterThan(names.indexOf("attack"));
      // It returned on exit time — after the attack had played through, not
      // on the next frame.
      const back = log.find((entry: { names: string[]; ms: number }) => entry.names.includes("idle"));
      expect(back.ms).toBeGreaterThan(attack.seconds * 1000 * 0.9);
    }, 30_000);

    test("a resampled loop is entered by setting motion, and keeps looping until motion names another", async () => {
      const spin = report.motions.find((m) => m.id === "spin")!;
      // 16 frames at 48 fps, taken to the 24 fps default: 8 frames, 1/3 s.
      expect({ kind: spin.kind, frames: spin.frames, fps: spin.fps }).toEqual({ kind: "loop", frames: 8, fps: 24 });
      const idle = report.motions.find((m) => m.id === "idle")!;
      const log = await evaluate(`(async () => {
        const motion = r.stateMachineInputs("State Machine 1").find((i) => i.name === "motion");
        const set = performance.now();
        motion.value = 1;
        // Idle finishes its cycle first (up to ${idle.seconds}s), then five of
        // spin's: a one-shot would have handed back after one.
        await new Promise((res) => setTimeout(res, ${Math.round(idle.seconds * 1000 + spin.seconds * 5000)}));
        const during = window.states.filter((s) => s.t >= set).flatMap((s) => s.names);
        motion.value = 0;
        await new Promise((res) => setTimeout(res, ${Math.round(spin.seconds * 1000) + 300}));
        const after = window.states.filter((s) => s.t >= set).flatMap((s) => s.names);
        return { during, after };
      })()`);
      expect(log.during).toEqual(["spin"]);
      expect(log.after).toEqual(["spin", "idle"]);
    }, 30_000);

    test("connected: motion routes through the clips, and nothing leaves mid-cycle", async () => {
      const seconds = new Map(connected.motions.map((m) => [m.id, m.seconds]));
      const kinds = new Map(connected.motions.map((m) => [m.id, m.kind]));
      // The reverse is drawn from its source's images.
      expect(connected.motions.find((m) => m.id === "spin-to-calm")!.shares).toBe("calm-to-spin");
      const value = new Map(connected.stateMachine.inputs[0].values!.map((v) => [v.motion, v.value]));
      expect([...value.keys()]).toEqual(["calm", "spin", "sway"]);

      // Opened now, in front: a page in a background tab gets no animation
      // frames, and its first cycle would be measured across the pause.
      const evaluateConnected = await open("connected.html");
      const log = await evaluateConnected(`(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const inputs = r.stateMachineInputs("State Machine 1");
        const motion = inputs.find((i) => i.name === "motion");
        const marks = [];
        // Mid-cycle on purpose: 0.7 s into calm's 2 s cycle.
        await wait(700);
        marks.push({ t: performance.now(), set: "spin" });
        motion.value = ${value.get("spin")};
        await wait(${Math.round((seconds.get("calm")! + seconds.get("calm-to-spin")! + seconds.get("spin")! * 2) * 1000)});
        marks.push({ t: performance.now(), set: "sway" });
        motion.value = ${value.get("sway")};
        await wait(${Math.round((seconds.get("spin")! + seconds.get("spin-to-calm")! + seconds.get("sway")! * 2) * 1000)});
        marks.push({ t: performance.now(), fire: "play_attack" });
        inputs.find((i) => i.name === "play_attack").fire();
        await wait(${Math.round((seconds.get("attack")! + seconds.get("sway")! * 2) * 1000)});
        return { states: window.states.map((s) => ({ t: s.t, names: s.names })), marks };
      })()`);
      const entered = log.states.flatMap((s: { t: number; names: string[] }) => s.names.map((name) => ({ name, t: s.t })));
      const between = (from: number, to: number) => entered.filter((e: { t: number }) => e.t >= from && e.t < to).map((e: { name: string }) => e.name);
      const [toSpin, toSway, attack] = log.marks.map((m: { t: number }) => m.t);
      expect(entered[0].name).toBe("calm");
      // idle → idle-to-X → X
      expect(between(toSpin, toSway)).toEqual(["calm-to-spin", "spin"]);
      // X → X-to-idle → Y: sway has no clip, so from the hub pose it cuts.
      expect(between(toSway, attack)).toEqual(["spin-to-calm", "sway"]);
      // A one-shot plays, then hands back to the loop motion names.
      expect(between(attack, Infinity)).toEqual(["attack", "sway"]);

      // Nothing leaves mid-cycle: every loop state lasts whole cycles, every
      // clip and one-shot its own length. Timing is the page's clock, so the
      // tolerance is a few frames. The one exception is by design: a one-shot
      // trigger plays at once, from whatever state it finds.
      const tolerance = 0.1;
      for (let i = 0; i + 1 < entered.length; i++) {
        const { name } = entered[i];
        if (entered[i + 1].name === "attack") continue;
        const lasted = (entered[i + 1].t - entered[i].t) / 1000;
        const cycle = seconds.get(name)!;
        const whole = kinds.get(name) === "loop" ? Math.max(1, Math.round(lasted / cycle)) : 1;
        expect({ name, off: Math.abs(lasted - whole * cycle) < tolerance }).toEqual({ name, off: true });
      }
      // …and calm, told at 0.7 s, still played its whole first cycle.
      expect((entered[1].t - entered[0].t) / 1000).toBeGreaterThan(seconds.get("calm")! - tolerance);
    }, 60_000);

    test("a trimmed frame draws exactly what the whole frame drew, at 1:1 and scaled", async () => {
      // The trim is real: less to decode, placed without a fraction lost.
      expect(pair.cutBytes).toBeLessThan(pair.fullBytes);
      expect(pair.inexactPlacements).toBe(0);
      const grab = await open("grab.html");
      const { width: w, height: h } = pair.artboard;
      const results: Array<Record<string, unknown>> = [];
      for (const [fit, cw, ch] of [["none", w, h], ["contain", 2 * w + 1, 2 * h + 3]] as const) {
        for (const [i, t] of pair.times.entries()) {
          const [a, b] = await Promise.all([
            grab(`grab("/trim-full.riv", ${t}, ${cw}, ${ch}, "${fit}")`),
            grab(`grab("/trim-cut.riv", ${t}, ${cw}, ${ch}, "${fit}")`),
          ]);
          const x = Buffer.from(a as string, "base64");
          const y = Buffer.from(b as string, "base64");
          let differing = 0;
          let worst = 0;
          let drawn = 0;
          let lowest = -1;
          for (let p = 0; p < x.length; p += 4) {
            if (x[p + 3] > 0) {
              drawn++;
              lowest = Math.max(lowest, Math.floor(p / 4 / cw));
            }
            let d = 0;
            for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(x[p + c] - y[p + c]));
            if (d) differing++;
            worst = Math.max(worst, d);
          }
          results.push({ fit, frame: i, drawn: drawn > 0, differing, worst, lowest });
        }
      }
      // Every frame, both ways: not one pixel differs.
      expect(results.map(({ fit, frame, differing, worst }) => ({ fit, frame, differing, worst })))
        .toEqual(results.map(({ fit, frame }) => ({ fit, frame, differing: 0, worst: 0 })));
      // …and the frames are the ones meant: the empty frame draws nothing,
      // the others do, and the cut-off frame reaches the artboard's edge.
      expect(results.filter((r) => r.fit === "none").map((r) => r.drawn)).toEqual([true, true, true, false, true]);
      // The cut-off frame ends inside the artboard's last row; the runtime
      // draws up to its last texel centre, one row up — trimmed or not.
      expect(pair.edgeBottom).toBeGreaterThan(h - 1);
      expect(results.find((r) => r.fit === "none" && r.frame === 2)!.lowest).toBeGreaterThanOrEqual(h - 2);
    }, 60_000);
  },
);
