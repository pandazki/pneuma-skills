// scripts/smoke-bansho.ts — local end-to-end smoke harness for bansho in the
// player. Materializes TWO play packages and serves them alongside the player
// build from one origin, so the SW + provider work without R2/CORS:
//
//   1. /plays/bansho-smoke — the shipped tech-zh seed (Amdahl's law: two
//      display formulas, three-layer chart, @strike, @erase, @overview) under
//      the slate-cursive preset theme, so the chalk texture + hand-wipe erase
//      path runs. Two checkpoints exercise checkpoint scrubbing.
//   2. /plays/bansho-real — a real narrated lecture (board.md + narration
//      clips + pre-mixed track) copied from a genuine session workspace, so
//      the audio conductor's /api/file fetches resolve through the service
//      worker (Range support included).
//
// Open: http://localhost:18082/player.html?pkg=/plays/bansho-smoke
//       http://localhost:18082/player.html?pkg=/plays/bansho-real
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";
import { BOARD_THEMES, presetCss } from "../modes/bansho/viewer/themes.js";

const serveRoot = "/tmp/pneuma-bansho-serve";
rmSync(serveRoot, { recursive: true, force: true });
mkdirSync(join(serveRoot, "plays"), { recursive: true });
cpSync("dist-player", serveRoot, { recursive: true });

// ── Package 1: tech-zh seed + slate chalk theme, two checkpoints ────────────
{
  const ws = mkdtempSync(join(tmpdir(), "smoke-bansho-"));
  mkdirSync(join(ws, ".pneuma"), { recursive: true });
  await initShadowGit(ws);

  const seed = readFileSync("modes/bansho/seed/tech-zh/board.md", "utf8");
  mkdirSync(join(ws, "tech-zh"), { recursive: true });
  // The picker-written slate theme: chalk on green slate, cursive hand. This
  // is byte-what the theme picker writes, so the package carries a real look.
  const slate = BOARD_THEMES.find((t) => t.id === "slate-cursive")!;
  writeFileSync(join(ws, "tech-zh", "theme.css"), presetCss(slate));

  // Checkpoint 1: the lecture up to (not including) the chart section.
  const chartAt = seed.indexOf("## 把两条曲线画在一起");
  writeFileSync(join(ws, "tech-zh", "board.md"), seed.slice(0, chartAt));
  await enqueueCheckpoint(ws, 1);

  // Checkpoint 2: the full lecture — charts, @overview, @erase, @strike.
  writeFileSync(join(ws, "tech-zh", "board.md"), seed);
  await enqueueCheckpoint(ws, 2);

  writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({
    sessionId: "bansho-smoke", mode: "bansho", backendType: "claude-code", createdAt: Date.now(),
  }));
  writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
    { type: "user_message", content: "讲讲为什么加机器不一定更快", timestamp: 1000, id: "u1" },
    { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "先立住那句口头禅，再下两刀。" }, { type: "tool_use", name: "Write", input: { file_path: "tech-zh/board.md" } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
    { type: "result", data: { num_turns: 1 } },
    { type: "user_message", content: "把两条曲线画在一起收尾", timestamp: 2000, id: "u2" },
    { type: "assistant", message: { id: "a2", content: [{ type: "text", text: "曲线画完，结论写在擦掉的板上。" }, { type: "tool_use", name: "Edit", input: { file_path: "tech-zh/board.md" } }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 2500 },
    { type: "result", data: { num_turns: 1 } },
  ]));

  const res = await materializePlayPackage(ws, {
    output: join(serveRoot, "plays", "bansho-smoke"),
    title: "为什么加机器不一定更快 (bansho)",
    importUrl: "https://example.r2.dev/histories/bansho.tar.gz",
  });
  console.log("[smoke] bansho-smoke:", res.index.id, "supported:", res.index.supported, "checkpoints:", res.checkpointCount, "blobs:", res.blobCount);
}

// ── Package 2: a real narrated lecture (read-only source; copy, never touch) ─
{
  const real = `${process.env.HOME}/pneuma-projects/bansho-20260814-0420`;
  if (!existsSync(join(real, "board.md"))) {
    console.log("[smoke] bansho-real: source workspace not found, skipping");
  } else {
    const ws = mkdtempSync(join(tmpdir(), "smoke-bansho-real-"));
    mkdirSync(join(ws, ".pneuma"), { recursive: true });
    await initShadowGit(ws);
    cpSync(join(real, "board.md"), join(ws, "board.md"));
    cpSync(join(real, "narration"), join(ws, "narration"), { recursive: true });
    await enqueueCheckpoint(ws, 1);

    writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "bansho-real", mode: "bansho", backendType: "claude-code", createdAt: Date.now(),
    }));
    writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify([
      { type: "user_message", content: "讲讲 DeepSeek Harness", timestamp: 1000, id: "u1" },
      { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "四块板讲透 harness 与模型的分工。" }], model: "x", stop_reason: "end_turn", role: "assistant" }, timestamp: 1500 },
      { type: "result", data: { num_turns: 1 } },
    ]));

    const res = await materializePlayPackage(ws, {
      output: join(serveRoot, "plays", "bansho-real"),
      title: "DeepSeek Harness (narrated bansho)",
      importUrl: "https://example.r2.dev/histories/bansho-real.tar.gz",
    });
    console.log("[smoke] bansho-real:", res.index.id, "supported:", res.index.supported, "checkpoints:", res.checkpointCount, "blobs:", res.blobCount);
  }
}

Bun.serve({
  port: 18082,
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
console.log("[smoke] serving http://localhost:18082/player.html?pkg=/plays/bansho-smoke");
console.log("[smoke]         http://localhost:18082/player.html?pkg=/plays/bansho-real");
