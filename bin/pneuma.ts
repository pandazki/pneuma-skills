#!/usr/bin/env bun
/**
 * Pneuma Skills CLI entry point.
 *
 * Usage:
 *   pneuma doc --workspace /path/to/project [--port 17996] [--no-open]
 */

import { resolve, dirname, join } from "node:path";
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { startServer } from "../server/index.js";
import { CliLauncher } from "../server/cli-launcher.js";
import { installSkill } from "../server/skill-installer.js";
import { startFileWatcher } from "../server/file-watcher.js";

const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

// ── Session persistence ──────────────────────────────────────────────────────

interface PersistedSession {
  sessionId: string;
  cliSessionId?: string;
  mode: string;
  createdAt: number;
}

function loadSession(workspace: string): PersistedSession | null {
  const filePath = join(workspace, ".pneuma", "session.json");
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function saveSession(workspace: string, session: PersistedSession): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
}

function loadHistory(workspace: string): unknown[] {
  try {
    const content = readFileSync(join(workspace, ".pneuma", "history.json"), "utf-8");
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory(workspace: string, history: unknown[]): void {
  const dir = join(workspace, ".pneuma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "history.json"), JSON.stringify(history));
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2); // skip bun + script path
  let mode = "";
  let workspace = process.cwd();
  let port = 0; // 0 = auto-detect based on mode
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

// ── Main ─────────────────────────────────────────────────────────────────────

function checkBunVersion() {
  const MIN_BUN = "1.3.5"; // Required for Bun.spawn terminal (PTY) support
  const current = typeof Bun !== "undefined" ? Bun.version : null;
  if (!current) {
    console.warn("[pneuma] Warning: Not running under Bun. Pneuma requires Bun >= " + MIN_BUN);
    return;
  }
  const [curMajor, curMinor, curPatch] = current.split(".").map(Number);
  const [minMajor, minMinor, minPatch] = MIN_BUN.split(".").map(Number);
  const ok =
    curMajor > minMajor ||
    (curMajor === minMajor && curMinor > minMinor) ||
    (curMajor === minMajor && curMinor === minMinor && curPatch >= minPatch);
  if (!ok) {
    console.warn(
      `[pneuma] Warning: Bun ${current} detected, but >= ${MIN_BUN} is required.` +
      ` Terminal features may not work. Run \`bun upgrade\` to update.`
    );
  }
}

async function main() {
  checkBunVersion();
  const { mode, workspace, port, noOpen } = parseArgs(process.argv);

  if (!mode || mode !== "doc") {
    console.log("Usage: pneuma doc --workspace /path/to/project [--port 17996] [--no-open]");
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
  //    Dev mode:  backend on 17007, Vite on 17996 (user-facing)
  //    Prod mode: backend on 17996 (serves everything)
  const serverPort = port || (isDev ? 17007 : 17996);
  const { server, wsBridge, port: actualPort } = startServer({
    port: serverPort,
    workspace,
    ...(isDev ? {} : { distDir }),
  });

  // 4. Launch CLI (with session resume if available)
  const launcher = new CliLauncher(actualPort);

  // When the CLI reports its internal session_id, persist it
  wsBridge.onCLISessionIdReceived((sessionId, cliSessionId) => {
    launcher.setCLISessionId(sessionId, cliSessionId);
    // Persist to .pneuma/session.json
    const persisted = loadSession(workspace);
    if (persisted && persisted.sessionId === sessionId) {
      persisted.cliSessionId = cliSessionId;
      saveSession(workspace, persisted);
      console.log(`[pneuma] Saved cliSessionId for resume: ${cliSessionId}`);
    }
  });

  // Check for existing session to resume
  const existing = loadSession(workspace);
  let resuming = false;

  const session = launcher.launch({
    cwd: workspace,
    permissionMode: "bypassPermissions",
    // Reuse sessionId for stable WS routing
    ...(existing?.cliSessionId ? {
      sessionId: existing.sessionId,
      resumeSessionId: existing.cliSessionId,
    } : {}),
  });

  if (existing?.cliSessionId) {
    resuming = true;
    console.log(`[pneuma] Resuming session: ${existing.cliSessionId}`);
  }

  // Persist session info
  saveSession(workspace, {
    sessionId: session.sessionId,
    cliSessionId: existing?.cliSessionId,
    mode,
    createdAt: existing?.createdAt || Date.now(),
  });

  console.log(`[pneuma] CLI session started: ${session.sessionId}`);

  // Load persisted message history into WsBridge
  const savedHistory = loadHistory(workspace);
  if (savedHistory.length > 0) {
    wsBridge.loadMessageHistory(session.sessionId, savedHistory as any);
    console.log(`[pneuma] Restored ${savedHistory.length} messages from history`);
  }

  // Periodically persist message history (debounced — every 5s)
  const historyInterval = setInterval(() => {
    const history = wsBridge.getMessageHistory(session.sessionId);
    if (history.length > 0) {
      saveHistory(workspace, history);
    }
  }, 5_000);

  // If resume fails (CLI exits quickly), clear cliSessionId from persistence
  launcher.onSessionExited((exitedId, exitCode) => {
    if (exitedId === session.sessionId && resuming) {
      const info = launcher.getSession(exitedId);
      if (info && !info.cliSessionId) {
        // Resume failed, cliSessionId was cleared by launcher
        const persisted = loadSession(workspace);
        if (persisted) {
          persisted.cliSessionId = undefined;
          saveSession(workspace, persisted);
          console.log("[pneuma] Resume failed, cleared cliSessionId. Restart for fresh session.");
        }
      }
    }
  });

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
    const VITE_PORT = 17996;
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
    clearInterval(historyInterval);
    // Final history save
    const history = wsBridge.getMessageHistory(session.sessionId);
    if (history.length > 0) {
      saveHistory(workspace, history);
      console.log(`[pneuma] Saved ${history.length} messages to history`);
    }
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
