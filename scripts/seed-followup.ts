// Publish demo packages for the follow-up modes (diagram / remotion / cosmos).
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { shareProcess } from "../server/share.js";

async function demo(mode: string, title: string, setup: (ws: string) => void) {
  const ws = mkdtempSync(join(tmpdir(), `demo-${mode}-`));
  mkdirSync(join(ws, ".pneuma"), { recursive: true });
  await initShadowGit(ws);
  setup(ws);
  await enqueueCheckpoint(ws, 1);
  writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "demo", mode, backendType: "claude-code", createdAt: Date.now() }));
  writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
    { type: "user_message", content: `Create a ${mode} demo for the online player`, timestamp: 1000, id: "u1" },
    { type: "assistant", message: { id: "a1", content: [{ type: "text", text: `Built the ${mode} demo and rendered it.` }], model: "demo", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
    { type: "result", data: { num_turns: 1 } },
  ]));
  const r = await shareProcess(ws, title, join(ws, ".pneuma"));
  console.log(`  ${mode.padEnd(10)} ${r.playerUrl}   (supported=${r.supported})`);
}

console.log("Publishing follow-up demo packages:\n");
// Each mode's seedFiles maps its seed dir to the workspace ROOT, so the
// demo must mirror that layout (src/Root.tsx, cosmos.json at root), not nest
// it under the seed-folder name.
await demo("diagram", "Architecture (diagram)", (ws) => cpSync("modes/diagram/seed/diagram.drawio", join(ws, "pneuma-overview.drawio")));
await demo("remotion", "Pneuma Intro (remotion)", (ws) => cpSync("modes/remotion/seed/default", ws, { recursive: true }));
await demo("cosmos", "Codebase Cosmos (cosmos)", (ws) => cpSync("modes/cosmos/seed/en", ws, { recursive: true }));
console.log("\nDone.");
