// scripts/smoke-kami.ts — local end-to-end smoke harness for kami in the player.
// Materializes a play package from a kami workspace (one-pager + portfolio, with
// the substituted _shared/ stylesheet) and serves it alongside the player build
// from one origin, so the SW + provider work without R2/CORS. This exercises the
// REAL KamiPreview viewer (scroll desk inset + overlays) against fresh content.
// Open: http://localhost:18081/player.html?pkg=/plays/kami-smoke
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

const serveRoot = "/tmp/pneuma-kami-serve";
rmSync(serveRoot, { recursive: true, force: true });
mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync("dist-player", serveRoot, { recursive: true });

// A4 portrait — what `deriveParams` would substitute for the default kami session.
const VARS: Record<string, string> = {
  pageWidthMm: "210", pageHeightMm: "297",
  safeTopMm: "18", safeSideMm: "16", safeBottomMm: "18",
};

const ws = mkdtempSync(join(tmpdir(), "smoke-kami-"));
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);

// _shared/ with placeholders substituted (the skill installer's job in a real session).
cpSync("modes/kami/seed/_shared", join(ws, "_shared"), { recursive: true });
const cssPath = join(ws, "_shared", "styles.css");
let css = readFileSync(cssPath, "utf8");
for (const [k, v] of Object.entries(VARS)) css = css.replaceAll(`{{${k}}}`, v);
writeFileSync(cssPath, css);

// A multi-page portfolio (tests scroll inter-sheet desk gaps) as the active doc.
cpSync("modes/kami/seed/kaku-portfolio", join(ws, "kaku-portfolio"), { recursive: true });
await enqueueCheckpoint(ws, 1);

writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: "kami-smoke", mode: "kami", backendType: "claude-code", createdAt: Date.now() }));
writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
  { type: "user_message", content: "Build a kami portfolio", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Typeset the portfolio across sheets." }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
]));

const res = await materializePlayPackage(ws, { output: join(serveRoot, "plays", "kami-smoke"), title: "Kami portfolio (smoke)", importUrl: "https://example.r2.dev/histories/x.tar.gz" });
console.log("[smoke] kami package:", res.index.id, "checkpoints:", res.checkpointCount, "blobs:", res.blobCount);

Bun.serve({
  port: 18081,
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
console.log("[smoke] serving http://localhost:18081/player.html?pkg=/plays/kami-smoke");
