// One-shot: materialize a webcraft (gazette seed) play package into the running
// smoke server's dir, to validate the /content/* service worker with real
// relative-path image assets. Run while smoke-player.ts server is up.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

const out = "/tmp/pneuma-player-serve/plays/webcraft-smoke";
rmSync(out, { recursive: true, force: true });

const ws = mkdtempSync(join(tmpdir(), "smoke-web-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
// Real seed content: gazette has index.html + manifest.json + images/*.webp
cpSync("modes/webcraft/seed/gazette", join(ws, "gazette"), { recursive: true });
await enqueueCheckpoint(ws, 1);

writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "smoke", mode: "webcraft", backendType: "claude-code", createdAt: Date.now() }));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "Build a gazette landing page", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Built the gazette with hero imagery." }, { type: "tool_use", name: "Write", input: { file_path: "gazette/index.html" } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
]));

const res = await materializePlayPackage(ws, { output: out, title: "Gazette (webcraft)", importUrl: "https://example.r2.dev/histories/web.tar.gz" });
console.log("[smoke] webcraft package:", res.index.id, "blobs:", res.blobCount, "bytes:", res.totalBytes);
