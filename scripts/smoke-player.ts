// scripts/smoke-player.ts — local end-to-end smoke harness for the hosted player.
// Generates a play package from a synthetic doc session, copies the player build
// alongside it, and serves both from one origin so the SW + provider work without
// R2/CORS. Open: http://localhost:18080/player.html?pkg=/plays/doc-smoke
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

const serveRoot = "/tmp/pneuma-player-serve";
rmSync(serveRoot, { recursive: true, force: true });
mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync("dist-player", serveRoot, { recursive: true });

// --- Synthetic doc session ---
const ws = mkdtempSync(join(tmpdir(), "smoke-doc-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
writeFileSync(join(ws, "notes.md"), "# Hello Player\n\nThis is the **first** draft.\n");
await enqueueCheckpoint(ws, 1);
writeFileSync(join(ws, "notes.md"), "# Hello Player\n\nThis is the **second** draft, with more text.\n\n- point A\n- point B\n\n> A quote to render.\n");
await enqueueCheckpoint(ws, 2);
writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "smoke", mode: "doc", backendType: "claude-code", createdAt: Date.now() }));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "Write some notes about the player", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Here's a first draft of the notes." }, { type: "tool_use", name: "Write", input: { file_path: "notes.md" } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
  { type: "user_message", content: "Expand it with bullet points and a quote", timestamp: 2000, id: "u2" },
  { type: "assistant", message: { id: "a2", content: [{ type: "text", text: "Expanded with bullets and a blockquote." }, { type: "tool_use", name: "Edit", input: { file_path: "notes.md" } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 2500 },
  { type: "result", data: { num_turns: 1 } },
]));
const res = await materializePlayPackage(ws, { output: join(serveRoot, "plays", "doc-smoke"), title: "Doc smoke test", importUrl: "https://example.r2.dev/histories/x.tar.gz" });
console.log("[smoke] doc package:", res.index.id, "checkpoints:", res.checkpointCount, "blobs:", res.blobCount);

Bun.serve({
  port: 18080,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/player.html";
    const file = Bun.file(join(serveRoot, p));
    if (await file.exists()) {
      return new Response(file, { headers: { "access-control-allow-origin": "*" } });
    }
    if (p.startsWith("/s/")) return new Response(Bun.file(join(serveRoot, "player.html")));
    return new Response("not found", { status: 404 });
  },
});
console.log("[smoke] serving http://localhost:18080/player.html?pkg=/plays/doc-smoke");
