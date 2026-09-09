// scripts/smoke-sprite.ts — local end-to-end smoke harness for sprite in the player.
//
// Materializes a play package from a workspace holding the shipped Lumi seed as
// the `lumi/` content set, and serves it alongside the player build from ONE
// origin — that single-origin detail is the point: the content service worker
// (`public/player-content-sw.js`) only intercepts same-origin `/content/*`, so a
// package served from anywhere else silently bypasses the layer under test.
//
// What this exercises that a unit test cannot: the seed is ~5 MB of real
// binaries — 28 frame PNGs, two packed sheets, GIF/WebP previews and a Seedance
// mp4 — none of which reach the store (`src/replay/provider.ts` feeds it text
// files only). Every one of them has to arrive through the service worker, the
// mp4 with Range support so the Video tab can play and seek.
//
// Open: http://localhost:18082/player.html?pkg=/plays/sprite-smoke
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

/** Repo root, derived from this file rather than cwd, so the harness runs from
 *  anywhere in a clean checkout. */
const repoRoot = resolve(import.meta.dir, "..");
const PORT = 18082;

const distPlayer = join(repoRoot, "dist-player");
if (!existsSync(join(distPlayer, "player.html"))) {
  console.error(
    "[smoke] dist-player/player.html missing — build the player first:\n" +
      "        bunx vite build --config vite.player.config.ts",
  );
  process.exit(1);
}

// Both temp trees are ours and get removed on the way out — the harness is run
// repeatedly during verification and must not leave 5 MB packages behind.
const serveRoot = mkdtempSync(join(tmpdir(), "smoke-sprite-serve-"));
const ws = mkdtempSync(join(tmpdir(), "smoke-sprite-ws-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(serveRoot, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}

mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync(distPlayer, serveRoot, { recursive: true });

// The character directory IS the content set (`init.seedFiles` copies
// `modes/sprite/seed/lumi/` to `<workspace>/lumi/`), so the package carries the
// same shape a real session would.
mkdirSync(join(ws, ".pneuma"), { recursive: true });
await initShadowGit(ws);
cpSync(join(repoRoot, "modes/sprite/seed/lumi"), join(ws, "lumi"), { recursive: true });
await enqueueCheckpoint(ws, 1);

writeFileSync(
  join(ws, ".pneuma", "session.json"),
  JSON.stringify({
    sessionId: "sprite-smoke",
    mode: "sprite",
    backendType: "claude-code",
    createdAt: Date.now(),
  }),
);
writeFileSync(
  join(ws, ".pneuma", "history.json"),
  JSON.stringify([
    {
      type: "user_message",
      content: "Design a chibi lantern courier and give her an idle and an attack",
      timestamp: 1000,
      id: "u1",
    },
    {
      type: "assistant",
      message: {
        id: "a1",
        content: [
          {
            type: "text",
            text: "Lumi is drawn, both motions are sliced and packed — idle loops at 8 fps, attack swings the lantern at 10 fps with a Seedance clip beside it.",
          },
          { type: "tool_use", name: "Write", input: { file_path: "lumi/project.json" } },
        ],
        model: "x",
        stop_reason: "end_turn",
        role: "assistant",
      },
      timestamp: 1500,
    },
    { type: "result", data: { num_turns: 1 } },
  ]),
);

const res = await materializePlayPackage(ws, {
  output: join(serveRoot, "plays", "sprite-smoke"),
  title: "Lumi — lantern courier (sprite)",
  importUrl: "https://example.r2.dev/histories/sprite.tar.gz",
});
console.log(
  "[smoke] sprite-smoke:",
  res.index.id,
  "supported:",
  res.index.supported,
  "checkpoints:",
  res.checkpointCount,
  "blobs:",
  res.blobCount,
  "bytes:",
  res.totalBytes,
);

// Chicken-and-egg: `materializePlayPackage` stamps `supported` from
// `WEB_PLAYER_SUPPORTED_MODES`, and the shell refuses to mount the viewer for a
// package it thinks is unplayable — so before sprite is whitelisted, the harness
// that is supposed to EARN the entry would only ever show the local-client
// fallback. Forcing the stamp is the sanctioned way through: `isPackagePlayable`
// already trusts a positive stamp on purpose ("a future exporter may know modes
// this build does not — loadMode still arbitrates"), which is exactly this
// situation with the two sides swapped. Once sprite is in the whitelist the
// exporter stamps true itself and this branch stops firing.
if (!res.index.supported) {
  const playJson = join(serveRoot, "plays", "sprite-smoke", "play.json");
  writeFileSync(playJson, JSON.stringify({ ...res.index, supported: true }));
  console.log(
    `[smoke] forced supported:true — "${res.index.mode}" is not in WEB_PLAYER_SUPPORTED_MODES yet`,
  );
}

Bun.serve({
  port: PORT,
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
console.log(`[smoke] serving http://localhost:${PORT}/player.html?pkg=/plays/sprite-smoke`);
