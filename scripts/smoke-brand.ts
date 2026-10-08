// Run after building the player. This local-only fixture verifies Brand Studio
// with its production support declaration; it never publishes a share package.
import { mkdtemp, mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initShadowGit, enqueueCheckpoint } from "../server/shadow-git.js";
import { materializePlayPackage } from "../server/play-export.js";

const root = await mkdtemp(join(tmpdir(), "brand-player-"));
const workspace = join(root, "workspace");
const served = join(root, "served");
await mkdir(join(workspace, ".pneuma"), { recursive: true });
await cp("dist-player", served, { recursive: true });
await initShadowGit(workspace);
await cp("modes/brand/seed/morrow", join(workspace, "morrow"), { recursive: true });
await enqueueCheckpoint(workspace, 1);
await cp("modes/brand/seed/morrow", join(workspace, "morrow-social"), { recursive: true });
const manifestPath = join(workspace, "morrow-social/brand.json");
const project = JSON.parse(await readFile(manifestPath, "utf8"));
project.title = "Morrow — social exploration";
await writeFile(manifestPath, JSON.stringify(project));
await enqueueCheckpoint(workspace, 2);
await writeFile(join(workspace, ".pneuma/session.json"), JSON.stringify({ sessionId: "brand-smoke", mode: "brand", backendType: "claude-code", createdAt: Date.now() }));
await writeFile(join(workspace, ".pneuma/history.json"), JSON.stringify([
  { type: "user_message", content: "Define the Morrow brand", timestamp: 1000, id: "u1" },
  { type: "assistant", message: { id: "a1", role: "assistant", content: [{ type: "text", text: "Defined the brand identity and core assets." }], model: "fixture", stop_reason: "end_turn" }, timestamp: 1500 },
  { type: "result", data: { num_turns: 1 } },
  { type: "user_message", content: "Explore the brand in social contexts", timestamp: 2000, id: "u2" },
  { type: "assistant", message: { id: "a2", role: "assistant", content: [{ type: "text", text: "Added a second application exploration." }], model: "fixture", stop_reason: "end_turn" }, timestamp: 2500 },
  { type: "result", data: { num_turns: 1 } },
]));
const output = join(served, "plays/brand-smoke");
const result = await materializePlayPackage(workspace, { output, title: "Brand Studio smoke", importUrl: "https://example.invalid/brand.tar.gz" });
if (!result.index.supported) throw new Error("Brand is missing from the player support declaration");
const port = Number(process.env.BRAND_SMOKE_PORT ?? 18118);
Bun.serve({ port, hostname: "127.0.0.1", async fetch(req) {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname === "/" ? "/player.html" : url.pathname);
  if (path.split("/").includes("..")) return new Response("Invalid path", { status: 400 });
  const file = Bun.file(join(served, path));
  return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
} });
console.log(JSON.stringify({ root, checkpoints: result.checkpointCount, blobs: result.blobCount, url: `http://localhost:${port}/player.html?pkg=/plays/brand-smoke` }));
