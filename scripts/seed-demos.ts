// scripts/seed-demos.ts — (re)publish ALL demo play packages to R2 with STABLE
// ids, so the public player links are permanent and a reseed overwrites the same
// R2 path in place (no more dead `…?id=<mode>-<rand>-<ts>` links).
//
// Each demo's link is `<playerBaseUrl>/s/?id=<mode>-demo`. Idempotent: run it
// any time the seed content or a viewer changes to refresh the live demos.
//
// Usage:  bun scripts/seed-demos.ts            # all demos
//         bun scripts/seed-demos.ts kami doc   # only the named modes
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { shareProcess } from "../server/share.js";

const DOC_MD = `# The Online Player

This document is rendering inside Pneuma's **hosted player** — no install required.

## What you're looking at

- The viewer is the *same* React component the live app uses, in a read-only state.
- The conversation history is on the right; scrub the timeline below to replay turns.
- "Open in app" hands off to the desktop client via a \`pneuma://\` link.

> Co-creation infrastructure for humans and code agents.

### Next
1. Try the other demo links (slide, webcraft, draw, illustrate, kami).
2. Notice each renders in its own domain terms.
`;

// A4 portrait — what kami's `deriveParams` substitutes into _shared/styles.css.
// The skill installer does this in a real session; demos must mirror it or the
// paper renders with invalid page dimensions.
const KAMI_A4: Record<string, string> = {
  pageWidthMm: "210", pageHeightMm: "297", safeTopMm: "18", safeSideMm: "16", safeBottomMm: "18",
};
function copyKamiShared(ws: string) {
  cpSync("modes/kami/seed/_shared", join(ws, "_shared"), { recursive: true });
  const cssPath = join(ws, "_shared", "styles.css");
  let css = readFileSync(cssPath, "utf8");
  for (const [k, v] of Object.entries(KAMI_A4)) css = css.replaceAll(`{{${k}}}`, v);
  writeFileSync(cssPath, css);
}

interface Demo {
  mode: string;
  title: string;
  setup: (ws: string) => void;
}

// Each mode's seedFiles maps its seed dir to the workspace ROOT, so demos mirror
// that layout (remotion src/ + cosmos.json at root), not nested under the folder name.
const DEMOS: Demo[] = [
  { mode: "doc",        title: "Doc — Online Player",        setup: (ws) => writeFileSync(join(ws, "notes.md"), DOC_MD) },
  { mode: "webcraft",   title: "Gazette (webcraft)",         setup: (ws) => cpSync("modes/webcraft/seed/gazette", join(ws, "gazette"), { recursive: true }) },
  { mode: "slide",      title: "Pneuma Slides",              setup: (ws) => cpSync("modes/slide/seed/en-dark", join(ws, "en-dark"), { recursive: true }) },
  { mode: "draw",       title: "Drawing (draw)",             setup: (ws) => cpSync("modes/draw/seed/drawing.excalidraw", join(ws, "drawing.excalidraw")) },
  { mode: "illustrate", title: "Blog Heroes (illustrate)",   setup: (ws) => cpSync("modes/illustrate/seed/blog-heroes", join(ws, "blog-heroes"), { recursive: true }) },
  { mode: "kami",       title: "One-Pager (kami)",           setup: (ws) => { cpSync("modes/kami/seed/pneuma-one-pager", join(ws, "pneuma-one-pager"), { recursive: true }); copyKamiShared(ws); } },
  { mode: "diagram",    title: "Architecture (diagram)",     setup: (ws) => cpSync("modes/diagram/seed/diagram.drawio", join(ws, "pneuma-overview.drawio")) },
  { mode: "remotion",   title: "Pneuma Intro (remotion)",    setup: (ws) => cpSync("modes/remotion/seed/default", ws, { recursive: true }) },
  { mode: "cosmos",     title: "Codebase Cosmos (cosmos)",   setup: (ws) => cpSync("modes/cosmos/seed/en", ws, { recursive: true }) },
];

const only = process.argv.slice(2);
const selected = only.length ? DEMOS.filter((d) => only.includes(d.mode)) : DEMOS;

console.log(`Seeding ${selected.length} demo package(s) with stable ids:\n`);
const results: Array<{ mode: string; url?: string; err?: string }> = [];
for (const d of selected) {
  const id = `${d.mode}-demo`;
  process.stdout.write(`  ${d.mode.padEnd(11)} → `);
  try {
    const ws = mkdtempSync(join(tmpdir(), `demo-${d.mode}-`));
    mkdirSync(join(ws, ".pneuma"), { recursive: true });
    await initShadowGit(ws);
    d.setup(ws);
    await enqueueCheckpoint(ws, 1);
    writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: id, mode: d.mode, backendType: "claude-code", createdAt: Date.now() }));
    writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
      { type: "user_message", content: `Create a ${d.mode} demo for the online player`, timestamp: 1000, id: "u1" },
      { type: "assistant", message: { id: "a1", content: [{ type: "text", text: `Built the ${d.mode} demo and rendered it.` }], model: "demo", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
      { type: "result", data: { num_turns: 1 } },
    ]));
    const uploadConcurrency = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : undefined;
    const r = await shareProcess(ws, d.title, join(ws, ".pneuma"), { id, uploadConcurrency });
    console.log(`${r.playerUrl}   (supported=${r.supported})`);
    results.push({ mode: d.mode, url: r.playerUrl });
  } catch (e) {
    console.log(`FAILED: ${String(e)}`);
    results.push({ mode: d.mode, err: String(e) });
  }
}

const ok = results.filter((r) => r.url);
const failed = results.filter((r) => r.err);
console.log(`\nDone: ${ok.length} ok, ${failed.length} failed.`);
if (failed.length) process.exitCode = 1;
