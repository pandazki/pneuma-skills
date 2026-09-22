/**
 * Re-shoot the six gallery pictures.
 *
 * They are screenshots, not artwork: a `--viewing` backlot session over the
 * shipped seed, driven through CDP and cropped down to the 1376 x 768 the
 * launcher lays out. Nothing here draws a mockup — every number, frame and
 * chip in the pictures is the viewer's own, read out of
 * `modes/backlot/seed/one-inch-of-wind/`.
 *
 * Each view is captured at deviceScaleFactor 3 and resampled DOWN to
 * 1376 x 768, so a zoomed crop is still real pixels rather than an upscale.
 * `__tests__/showcase.test.ts` reads the PNG header for exactly that size.
 *
 * Usage — see README.md for the session and the Chrome this expects:
 *
 *   bun modes/backlot/showcase/shoot.mjs \
 *     --url "http://localhost:18397?session=<id>&mode=backlot" \
 *     --out modes/backlot/showcase [--cdp 19425]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string", default: "." },
    cdp: { type: "string", default: "19425" },
  },
});
if (!values.url) {
  console.error("shoot.mjs needs --url of a running --viewing session (see README.md)");
  process.exit(1);
}

const DSF = 3;
const VIEWPORT = { width: 1376, height: 768 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The full-resolution frames are scratch; only the resampled PNGs are kept. */
const RAW_DIR = mkdtempSync(join(tmpdir(), "backlot-showcase-raw-"));

// ── CDP, small enough to keep here ──────────────────────────────────────────

const targets = await (await fetch(`http://127.0.0.1:${values.cdp}/json/list`)).json();
const target = targets.find((t) => t.type === "page");
if (!target) throw new Error(`no page target on CDP port ${values.cdp}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const entry = msg.id === undefined ? null : pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(msg.error)}`));
  else entry.resolve(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "threw");
  return result.result.value;
}

/** Click the first button whose title, aria-label or text contains `needle`. */
async function click(needle) {
  const ok = await evaluate(`(() => {
    const needle = ${JSON.stringify(needle)};
    const el = [...document.querySelectorAll('button,[role=button]')].find((b) =>
      (b.getAttribute('title') || b.getAttribute('aria-label') || b.innerText || '').includes(needle));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`no button matching "${needle}"`);
  await sleep(800);
}

/**
 * Capture, then crop `rect` (CSS pixels, 16:9) and resample to 1376 x 768.
 * Without a rect the whole viewport is the picture.
 */
async function capture(name, rect = null) {
  await evaluate("window.scrollTo(0, 0)");
  await sleep(350);
  const raw = join(RAW_DIR, `${name}.png`);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(raw, Buffer.from(data, "base64"));
  const args = [raw];
  if (rect) {
    const px = (n) => Math.round(n * DSF);
    args.push("-crop", `${px(rect.w)}x${px(rect.h)}+${px(rect.x)}+${px(rect.y)}`, "+repage");
  }
  args.push("-filter", "Lanczos", "-resize", "1376x768!", "-strip", `${values.out}/${name}.png`);
  execFileSync("magick", args);
  console.log(`  ${name}.png`);
}

// ── the six views ───────────────────────────────────────────────────────────

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: DSF, mobile: false });
await send("Page.navigate", { url: values.url });
await sleep(10000);
await click("Collapse"); // the agent surface — this is a picture of the work
await sleep(600);

// hero — the stage rail over the finished cut, parked on the moment the film
// is named after: the blade stopped one inch short of the throat.
await click("Cut · approved");
await sleep(2500);
await evaluate(`(() => { const v = document.querySelector('video'); if (v) v.currentTime = 21.9; return true; })()`);
await sleep(2500);
await capture("hero");

// highlight-cut-points — the same view, zoomed on the joins.
await capture("highlight-cut-points", { x: 40, y: 350, w: 730, h: 410 });

// highlight-stages — every stage's status over the approved screenplay.
await click("Screenplay · approved");
await sleep(1800);
await capture("highlight-stages");

// highlight-greybox-take — one clock, two lanes, under the wipe.
await click("Previz · approved");
await sleep(1200);
await click("s03-orbit");
await sleep(1500);
await click("Wipe");
await sleep(1500);
await click("沉肩蓄杀"); // the shot's last beat — 4.50 s, both figures settled
await sleep(2800);
await capture("highlight-greybox-take", { x: 210, y: 150, w: 800, h: 450 });

// highlight-lineup — board | anchor | greybox, the previz gate's three pictures.
await click("Side");
await sleep(1000);
await click("Lineup");
await sleep(1800);
await capture("highlight-lineup", { x: 846, y: 188, w: 500, h: 281 });

// highlight-cost — what the film cost, by stage.
await click("Cost");
await sleep(1500);
await capture("highlight-cost", { x: 770, y: 186, w: 576, h: 324 });

ws.close();
console.log("done — quantize before committing (see README.md)");
process.exit(0);
