// One-off: reseed just the kami demo (now including _shared/ styles + fonts).
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { shareProcess } from "../server/share.js";

const ws = mkdtempSync(join(tmpdir(), "demo-kami-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
cpSync("modes/kami/seed/pneuma-one-pager", join(ws, "pneuma-one-pager"), { recursive: true });
cpSync("modes/kami/seed/_shared", join(ws, "_shared"), { recursive: true });
await enqueueCheckpoint(ws, 1);
writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "demo", mode: "kami", backendType: "claude-code", createdAt: Date.now() }));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "Create a kami demo for the online player", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Built the kami demo and rendered it." }], model: "demo", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
]));
const r = await shareProcess(ws, "One-Pager (kami)", join(ws, ".pneuma"));
console.log(`kami: ${r.playerUrl}`);
