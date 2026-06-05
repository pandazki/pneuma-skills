import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { shareProcess } from "../server/share.js";

const ws = mkdtempSync(join(tmpdir(), "demo-remotion-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
cpSync("modes/remotion/seed/default", ws, { recursive: true });
await enqueueCheckpoint(ws, 1);
writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "demo", mode: "remotion", backendType: "claude-code", createdAt: Date.now() }));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "Create a remotion demo for the online player", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Built the remotion intro and rendered it." }], model: "demo", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
]));
const r = await shareProcess(ws, "Pneuma Intro (remotion)", join(ws, ".pneuma"));
console.log(`remotion: ${r.playerUrl}`);
