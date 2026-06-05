// scripts/seed-demo-packages.ts — publish demo play packages to R2 via the real
// shareProcess flow, so the deployed player can be tested. Prints player URLs.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
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

async function demo(mode: string, title: string, setup: (ws: string) => void | Promise<void>) {
  const ws = mkdtempSync(join(tmpdir(), `demo-${mode}-`));
  mkdirSync(join(ws, ".pneuma"), { recursive: true });
  await initShadowGit(ws);
  await setup(ws);
  await enqueueCheckpoint(ws, 1);
  writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "demo", mode, backendType: "claude-code", createdAt: Date.now() }));
  writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
    { type: "user_message", content: `Create a ${mode} demo for the online player`, timestamp: 1000, id: "u1" },
    { type: "assistant", message: { id: "a1", content: [{ type: "text", text: `Built the ${mode} demo and rendered it.` }], model: "demo", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
    { type: "result", data: { num_turns: 1 } },
  ]));
  const r = await shareProcess(ws, title, join(ws, ".pneuma"));
  console.log(`  ${mode.padEnd(11)} ${r.playerUrl}   (supported=${r.supported})`);
}

console.log("Publishing demo packages to R2 + printing player URLs:\n");
await demo("doc", "Doc — Online Player", (ws) => writeFileSync(join(ws, "notes.md"), DOC_MD));
await demo("webcraft", "Gazette (webcraft)", (ws) => cpSync("modes/webcraft/seed/gazette", join(ws, "gazette"), { recursive: true }));
await demo("slide", "Pneuma Slides", (ws) => cpSync("modes/slide/seed/en-dark", join(ws, "en-dark"), { recursive: true }));
await demo("draw", "Drawing (draw)", (ws) => cpSync("modes/draw/seed/drawing.excalidraw", join(ws, "drawing.excalidraw")));
await demo("illustrate", "Blog Heroes (illustrate)", (ws) => cpSync("modes/illustrate/seed/blog-heroes", join(ws, "blog-heroes"), { recursive: true }));
await demo("kami", "One-Pager (kami)", (ws) => {
  cpSync("modes/kami/seed/pneuma-one-pager", join(ws, "pneuma-one-pager"), { recursive: true });
  // kami pages link ../_shared/styles.css (which declares @font-face + bundles
  // the TsangerJinKai/JetBrainsMono fonts). Real workspaces get _shared via the
  // mode's seedFiles; the demo must copy it too or the paper renders fontless.
  cpSync("modes/kami/seed/_shared", join(ws, "_shared"), { recursive: true });
});
console.log("\nDone.");
