#!/usr/bin/env bun
/**
 * Pneuma Skills CLI entry point.
 *
 * Usage:
 *   pneuma <mode> --workspace /path/to/project [--port 17996] [--no-open]
 *
 * Driven by ModeManifest + AgentBackend — no hardcoded mode knowledge.
 */

import { resolve, dirname, join } from "node:path";
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as readline from "node:readline";
import { startServer } from "../server/index.js";
import { ClaudeCodeBackend } from "../backends/claude-code/index.js";
import { installSkill } from "../server/skill-installer.js";
import { startFileWatcher } from "../server/file-watcher.js";
import { loadModeManifest, listModes } from "../core/mode-loader.js";
import type { ModeManifest } from "../core/types/mode-manifest.js";

const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

// ── Session persistence ──────────────────────────────────────────────────────

interface PersistedSession {
  sessionId: string;
  /** Agent's internal session ID (e.g. Claude Code's --resume ID) */
  agentSessionId?: string;
  mode: string;
  createdAt: number;
}

function loadSession(workspace: string): PersistedSession | null {
  const filePath = join(workspace, ".pneuma", "session.json");
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    // Backward compat: rename cliSessionId → agentSessionId
    if (data.cliSessionId && !data.agentSessionId) {
      data.agentSessionId = data.cliSessionId;
      delete data.cliSessionId;
    }
    return data;
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

  // Validate mode
  const availableModes = listModes();
  if (!mode || !availableModes.includes(mode)) {
    const modeList = availableModes.join(" | ");
    console.log(`Usage: pneuma <${modeList}> --workspace /path/to/project [--port 17996] [--no-open]`);
    process.exit(1);
  }

  // Load mode manifest (no React deps — backend safe)
  let manifest: ModeManifest;
  try {
    manifest = await loadModeManifest(mode);
  } catch (err) {
    console.error(`[pneuma] Failed to load mode "${mode}":`, err);
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

  console.log(`[pneuma] Mode: ${manifest.displayName} (${mode})`);
  console.log(`[pneuma] Workspace: ${workspace}`);

  // 1. Install skill + inject CLAUDE.md (driven by manifest)
  console.log("[pneuma] Installing skill and preparing environment...");
  const modeSourceDir = resolve(PROJECT_ROOT, "modes", mode);
  installSkill(workspace, manifest.skill, modeSourceDir);

  // 1.5 Seed default content if workspace has no meaningful files
  if (manifest.init && manifest.init.contentCheckPattern) {
    const checkPattern = manifest.init.contentCheckPattern;
    const contentFiles = Array.from(
      new Bun.Glob(checkPattern).scanSync({ cwd: workspace, absolute: false })
    ).filter((f) => f !== "CLAUDE.md" && !f.startsWith(".claude/"));

    const hasContent = contentFiles.some((f) => {
      try {
        return readFileSync(join(workspace, f), "utf-8").trim().length > 0;
      } catch { return false; }
    });

    if (!hasContent && manifest.init.seedFiles) {
      for (const [src, dst] of Object.entries(manifest.init.seedFiles)) {
        const srcPath = join(PROJECT_ROOT, src);
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, join(workspace, dst));
          console.log(`[pneuma] Seeded workspace with ${dst}`);
        }
      }
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

  // 4. Launch Agent backend (driven by manifest)
  const backend = new ClaudeCodeBackend(actualPort);

  // When the CLI reports its internal session_id, persist it
  wsBridge.onCLISessionIdReceived((sessionId, agentSessionId) => {
    backend.setAgentSessionId(sessionId, agentSessionId);
    // Persist to .pneuma/session.json
    const persisted = loadSession(workspace);
    if (persisted && persisted.sessionId === sessionId) {
      persisted.agentSessionId = agentSessionId;
      saveSession(workspace, persisted);
      console.log(`[pneuma] Saved agentSessionId for resume: ${agentSessionId}`);
    }
  });

  // Check for existing session to resume
  const existing = loadSession(workspace);
  let resuming = false;

  const permissionMode = manifest.agent?.permissionMode;
  const session = backend.launch({
    cwd: workspace,
    permissionMode,
    // Reuse sessionId for stable WS routing
    ...(existing?.agentSessionId ? {
      sessionId: existing.sessionId,
      resumeSessionId: existing.agentSessionId,
    } : {}),
  });

  if (existing?.agentSessionId) {
    resuming = true;
    console.log(`[pneuma] Resuming session: ${existing.agentSessionId}`);
  }

  // Persist session info
  saveSession(workspace, {
    sessionId: session.sessionId,
    agentSessionId: existing?.agentSessionId,
    mode,
    createdAt: existing?.createdAt || Date.now(),
  });

  console.log(`[pneuma] Agent session started: ${session.sessionId}`);

  // Auto-greeting for fresh sessions (driven by manifest)
  if (!resuming && manifest.agent?.greeting) {
    wsBridge.injectGreeting(session.sessionId, manifest.agent.greeting);
    console.log("[pneuma] Sent auto-greeting for fresh session");
  }

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

  // Handle Agent exit: surface errors + clear stale resume state
  backend.onSessionExited((exitedId, exitCode) => {
    // Broadcast Agent errors to browser
    if (exitCode !== 0 && exitCode !== 143 /* SIGTERM = normal shutdown */) {
      let errorMsg: string;
      if (exitCode === 127) {
        errorMsg = "Claude Code CLI not found. Please install it: https://docs.anthropic.com/claude-code";
      } else {
        errorMsg = `Claude Code exited unexpectedly (code ${exitCode}). Check CLI installation and subscription status.`;
      }
      wsBridge.broadcastToSession(exitedId, { type: "error", message: errorMsg });
    }

    // If resume fails (Agent exits quickly), clear agentSessionId from persistence
    if (exitedId === session.sessionId && resuming) {
      const info = backend.getSession(exitedId);
      if (info && !info.agentSessionId) {
        const persisted = loadSession(workspace);
        if (persisted) {
          persisted.agentSessionId = undefined;
          saveSession(workspace, persisted);
          console.log("[pneuma] Resume failed, cleared agentSessionId. Restart for fresh session.");
        }
      }
    }
  });

  // 5. Start file watcher (driven by manifest)
  startFileWatcher(workspace, manifest.viewer, (files) => {
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

  // 7. Open browser (include mode in URL for frontend)
  if (!noOpen) {
    const url = `http://localhost:${browserPort}?session=${session.sessionId}&mode=${mode}`;
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
    await backend.killAll();
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
