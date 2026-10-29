/**
 * Re-shoot the five gallery pictures.
 *
 * They are screenshots, not artwork: a `--viewing` anime-series session over
 * the shipped seed, driven through CDP and cropped down to the 1376 x 768 the
 * launcher lays out. Nothing here draws a mockup — every sheet, frame, chip,
 * verdict and dollar figure in the pictures is the viewer's own, read out of
 * `modes/anime-series/seed/guang-niuma/`.
 *
 * The viewer is a scrolling column (rail, then wall beside desk, then strip,
 * then the selected shot), so no 16:9 window holds all of it. Each picture is
 * taken at the viewer width where its subject reads whole — the wall stacks
 * into a row of cards below 820 px, the selected shot's check spreads across
 * the desk between 600 and 900 px of desk — and the crop is computed from the
 * viewer's own elements, so a layout change moves the crop with it instead of
 * slicing a card in half. Every crop is logged in CSS pixels.
 *
 * Each view is captured at deviceScaleFactor 3 and resampled DOWN to
 * 1376 x 768, so a zoomed crop is still real pixels rather than an upscale.
 * `__tests__/showcase.test.ts` reads the PNG header for exactly that size.
 *
 * Usage — see README.md for the session and the Chrome this expects:
 *
 *   bun modes/anime-series/showcase/shoot.mjs \
 *     --url "http://localhost:19301?session=<id>&mode=anime-series" \
 *     --out modes/anime-series/showcase [--cdp 19425]
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

// What each picture is parked on. Seconds are on the episode clock (ep01 is
// one 30 s part: shots of 3, 3, 3, 3, 4, 4, 4, 3, 3 s).
const HERO_AT = 8.0; // shot 3 · 6–9 s
const STRIP_SHOT = 6; // 16–20 s, the panel that was redrawn
const STRIP_AT = 17.6;
const DRIFT_SHOT = 7; // 光 drifted: the light bridge has no face
const DESK_WIDTH = 1180; // desk 878 px: "mid", the shot and its check stacked
const WALL_WIDTH = 816; // the stacked wall's four cards fill a 16:9 row here

const DSF = 3;
const OUT_W = 1376;
const OUT_H = 768;
const RATIO = OUT_W / OUT_H;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The full-resolution frames are scratch; only the resampled PNGs are kept. */
const RAW_DIR = mkdtempSync(join(tmpdir(), "anime-series-showcase-raw-"));

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

/**
 * Click the first button whose aria-label or title equals `needle`, else the
 * first whose visible text starts with it — exact first, so "Shot 1" never
 * lands on "Shot 1x".
 */
async function click(needle) {
  const ok = await evaluate(`(() => {
    const needle = ${JSON.stringify(needle)};
    const all = [...document.querySelectorAll('button,[role=button]')];
    const el =
      all.find((b) => b.getAttribute('aria-label') === needle || b.getAttribute('title') === needle) ??
      all.find((b) => (b.innerText || '').trim().startsWith(needle));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`no button matching "${needle}"`);
  await sleep(600);
}

/** Lay the page out at `width` x `height` CSS pixels. */
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: DSF, mobile: false });
  await sleep(900);
}

/**
 * Wait until what is on screen is what will be captured: web fonts, every
 * image decoded (sheets, strip panels, contact sheets) and two frames.
 */
async function settle() {
  await evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`);
  await sleep(400);
}

/** Put the final cut's frame at `seconds` on screen and wait for it to paint. */
async function seekClip(seconds) {
  const at = await evaluate(`(async () => {
    const v = document.querySelector('video');
    if (!v) throw new Error('no clip on screen');
    if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    const seeked = new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    v.currentTime = ${seconds};
    await seeked;
    if (v.readyState < 2) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return v.currentTime;
  })()`);
  await sleep(500);
  return at;
}

/** Bounding boxes, in CSS pixels, of the viewer parts the crops are built from. */
function parts() {
  return evaluate(`(() => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right };
    };
    const rail = document.querySelector('[data-series-rail]');
    const wall = document.querySelector('aside');
    const desk = document.querySelector('section[aria-label]');
    // The desk is header, screen row, strip, detail — in that order.
    const strip = desk && desk.children.length >= 4 ? desk.children[2] : null;
    const detail = desk && desk.children.length >= 4 ? desk.children[3] : null;
    const cards = wall ? [...wall.children].filter((c) => c.tagName === 'DIV') : [];
    const logButton = wall ? wall.querySelector(':scope > button') : null;
    const season = document.querySelector('main section');
    return {
      viewport: { w: innerWidth, h: innerHeight },
      rail: box(rail),
      wall: box(wall),
      cards: cards.map(box),
      logButton: box(logButton),
      strip: box(strip),
      detail: box(detail),
      detailCards: detail ? [...detail.children].map(box) : [],
      season: box(season),
    };
  })()`);
}

/** A 16:9 rect `height` tall, centred on `cx`, refusing to leave the viewport. */
function rectAround(cx, top, height, view) {
  const h = height;
  const w = h * RATIO;
  const x = cx - w / 2;
  if (x < 0 || x + w > view.w || top < 0 || top + h > view.h) {
    throw new Error(`crop ${JSON.stringify({ x, y: top, w, h })} leaves the ${view.w}x${view.h} viewport`);
  }
  return { x, y: top, w, h };
}

/** A 16:9 rect `width` wide whose top edge is `top`. */
function rectBelow(x, top, width, view) {
  const h = width / RATIO;
  if (x < 0 || x + width > view.w || top + h > view.h) {
    throw new Error(`crop ${JSON.stringify({ x, y: top, w: width, h })} leaves the ${view.w}x${view.h} viewport`);
  }
  return { x, y: top, w: width, h };
}

/** Capture the viewport, crop `rect` (CSS pixels, 16:9) and resample to 1376 x 768. */
async function capture(name, rect) {
  await settle();
  const raw = join(RAW_DIR, `${name}.png`);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(raw, Buffer.from(data, "base64"));
  const px = (n) => Math.round(n * DSF);
  execFileSync("magick", [
    raw,
    "-crop",
    `${px(rect.w)}x${px(rect.h)}+${px(rect.x)}+${px(rect.y)}`,
    "+repage",
    "-filter",
    "Lanczos",
    "-resize",
    `${OUT_W}x${OUT_H}!`,
    "-strip",
    join(values.out, `${name}.png`),
  ]);
  const css = Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  console.log(`  ${name}.png  crop ${JSON.stringify(css)} css px`);
}

// ── the five views ──────────────────────────────────────────────────────────

await send("Page.enable");
await send("Runtime.enable");
await viewport(1376, 1000);
await send("Page.navigate", { url: values.url });
await sleep(10000);
await click("Collapse"); // the agent surface — this is a picture of the work
await sleep(600);
await click("ep01"); // the rail's episode card: the desk, not the season view

// hero — rail, wall and desk, the final cut paused in shot 3 where both leads
// share the frame: 牛马 running with the file stack, 光 as the flashlight
// ahead. The window ends between the strip and the selected shot.
await viewport(1376, 1000);
await click("Shot 3");
await seekClip(HERO_AT);
{
  const p = await parts();
  // The strip ends with its time ruler; the selected shot's card starts
  // 10 px below it. Stop just under the ruler.
  const top = p.rail.y;
  const bottom = p.strip.bottom + 3;
  const rect = rectAround(p.viewport.w / 2, top, bottom - top, p.viewport);
  // The wall's cards (left) and the desk (right) must not sit on the edge.
  if (rect.x > p.cards[0].x - 4 || rect.x + rect.w < p.strip.right + 4) {
    throw new Error(`hero crop ${JSON.stringify(rect)} leaves no margin around the wall and the desk`);
  }
  await capture("hero", rect);
}

// highlight-shot-strip — at a 1180 px viewer the desk stacks the selected
// shot under the strip instead of beside its check, so the strip, the shot's
// words with its "made from" stamps and its check fit one window. Playhead
// inside shot 6, the panel that was redrawn. The window starts just above the
// strip's title (the clip is above it) and must reach the check's last line.
await viewport(DESK_WIDTH, 1400);
await click(`Shot ${STRIP_SHOT}`);
await seekClip(STRIP_AT);
{
  const p = await parts();
  const pad = 8;
  const rect = rectBelow(p.strip.x - pad, p.strip.y - pad, p.strip.w + 2 * pad, p.viewport);
  const last = p.detailCards[p.detailCards.length - 1];
  if (rect.y + rect.h < last.bottom + 4) throw new Error(`strip crop ends at ${rect.y + rect.h}, the check at ${last.bottom}`);
  await capture("highlight-shot-strip", rect);
}

// highlight-drift-check — shot 7, where the agent marked 光 drifted: the light
// bridge has no face. At the same width the check spans the desk, so the
// verdict note reads whole and the sheet sits beside the sampled frames. The
// window is the check card, top-aligned (the shot's own card is above it).
await viewport(DESK_WIDTH, 1700);
await click(`Shot ${DRIFT_SHOT}`);
{
  const p = await parts();
  const check = p.detailCards[p.detailCards.length - 1];
  const pad = 8;
  const rect = rectBelow(check.x - pad, check.y - 6, check.w + 2 * pad, p.viewport);
  if (rect.y + rect.h < check.bottom + 4) throw new Error(`drift crop ends at ${rect.y + rect.h}, the check at ${check.bottom}`);
  await capture("highlight-drift-check", rect);
}

// highlight-wall — below 820 px the wall stacks into a row: the four locked
// cards (光, 牛马, 便利贴群, the office) side by side. The window is the wall
// header and that row, stopping above the style lock and the lineup.
await viewport(WALL_WIDTH, 1000);
{
  const p = await parts();
  const rowTwo = p.cards.find((c) => c.y > p.cards[0].y + 1);
  const top = p.wall.y + 2; // below the rail's bottom border
  const bottom = rowTwo.y - 3;
  await capture("highlight-wall", rectAround(p.wall.x + p.wall.w / 2, top, bottom - top, p.viewport));
}

// highlight-season — the episode log opened: what the season cost and where,
// the cast's drift counts, and the log the next episode is pitched against.
await viewport(WALL_WIDTH, 1400);
await click("Episode log");
await sleep(800);
{
  const p = await parts();
  const top = p.logButton.y - 6;
  await capture("highlight-season", rectBelow(p.wall.x, top, p.wall.w, p.viewport));
}

ws.close();
console.log("done — quantize before committing (see README.md)");
process.exit(0);
