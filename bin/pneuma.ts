#!/usr/bin/env bun
/**
 * Pneuma Skills CLI entry point.
 *
 * Usage:
 *   pneuma doc --workspace /path/to/project [--port 7996] [--no-open]
 */

import { resolve, dirname, join } from "node:path";
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import * as readline from "node:readline";
import { startServer } from "../server/index.js";
import { CliLauncher } from "../server/cli-launcher.js";
import { installSkill } from "../server/skill-installer.js";
import { startFileWatcher } from "../server/file-watcher.js";

const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

function parseArgs(argv: string[]) {
  const args = argv.slice(2); // skip bun + script path
  let mode = "";
  let workspace = process.cwd();
  let port = 17996;
  let noOpen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" && i + 1 < args.length) {
      workspace = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[++i]);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (!arg.startsWith("--")) {
      mode = arg;
    }
  }

  return { mode, workspace: resolve(workspace), port, noOpen };
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const { mode, workspace, port, noOpen } = parseArgs(process.argv);

  if (!mode || mode !== "doc") {
    console.log("Usage: pneuma doc --workspace /path/to/project [--port 7996] [--no-open]");
    process.exit(1);
  }

  if (!existsSync(workspace)) {
    const answer = await ask(`Workspace does not exist: ${workspace}\nCreate it? [Y/n] `);
    if (answer.toLowerCase() === "n") {
      console.log("[pneuma] Aborted.");
      process.exit(0);
    }
    mkdirSync(workspace, { recursive: true });
    console.log(`[pneuma] Created workspace: ${workspace}`);
  }

  console.log(`[pneuma] Mode: ${mode}`);
  console.log(`[pneuma] Workspace: ${workspace}`);

  // 1. Install skill + inject CLAUDE.md
  console.log("[pneuma] Installing skill and preparing environment...");
  installSkill(workspace);

  // 1.5 Seed default content if workspace has no meaningful markdown files
  const contentFiles = Array.from(
    new Bun.Glob("**/*.md").scanSync({ cwd: workspace, absolute: false })
  ).filter((f) => f !== "CLAUDE.md" && !f.startsWith(".claude/"));

  const hasContent = contentFiles.some((f) => {
    try {
      return readFileSync(join(workspace, f), "utf-8").trim().length > 0;
    } catch { return false; }
  });

  if (!hasContent) {
    const readmeSrc = join(PROJECT_ROOT, "README.md");
    if (existsSync(readmeSrc)) {
      copyFileSync(readmeSrc, join(workspace, "README.md"));
      console.log("[pneuma] Seeded workspace with default README.md");
    }
  }

  // 2. Detect dev vs production mode
  const distDir = resolve(PROJECT_ROOT, "dist");
  const isDev = !existsSync(join(distDir, "index.html"));

  if (isDev) {
    console.log("[pneuma] Development mode (serving via Vite)");
  } else {
    console.log("[pneuma] Production mode (serving built assets)");
  }

  // 3. Start server
  const { server, wsBridge, port: actualPort } = startServer({
    port,
    workspace,
    ...(isDev ? {} : { distDir }),
  });

  // 4. Launch CLI
  const launcher = new CliLauncher(actualPort);

  // When the CLI reports its internal session_id, store it
  wsBridge.onCLISessionIdReceived((sessionId, cliSessionId) => {
    launcher.setCLISessionId(sessionId, cliSessionId);
  });

  const session = launcher.launch({
    cwd: workspace,
    permissionMode: "bypassPermissions",
  });

  console.log(`[pneuma] CLI session started: ${session.sessionId}`);

  // 5. Start file watcher
  startFileWatcher(workspace, (files) => {
    wsBridge.broadcastToSession(session.sessionId, {
      type: "content_update",
      files,
    });
  });

  // 6. Frontend serving
  let viteProc: ReturnType<typeof Bun.spawn> | null = null;
  let browserPort = actualPort;

  if (isDev) {
    // Dev mode: start Vite dev server
    const VITE_PORT = 7996;
    console.log(`[pneuma] Starting Vite dev server on port ${VITE_PORT}...`);
    viteProc = Bun.spawn(
      ["bunx", "vite", "--port", String(VITE_PORT), "--strictPort"],
      {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const pipeViteOutput = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.trim()) console.log(`[vite] ${line}`);
        }
      }
    };
    if (viteProc.stdout && typeof viteProc.stdout !== "number") pipeViteOutput(viteProc.stdout);
    if (viteProc.stderr && typeof viteProc.stderr !== "number") pipeViteOutput(viteProc.stderr);
    browserPort = VITE_PORT;
    // Wait for Vite to start
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 7. Open browser
  if (!noOpen) {
    const url = `http://localhost:${browserPort}?session=${session.sessionId}`;
    console.log(`[pneuma] Opening browser: ${url}`);
    try {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
    } catch {
      console.log(`[pneuma] Could not open browser. Visit: ${url}`);
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[pneuma] Shutting down...");
    viteProc?.kill();
    await launcher.killAll();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[pneuma] Fatal error:", err);
  process.exit(1);
});
