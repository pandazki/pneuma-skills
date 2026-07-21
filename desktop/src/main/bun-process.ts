import { spawn, execSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { app } from "electron";
import { existsSync } from "node:fs";
import { logEntry, writeToTerminal } from "./logger.js";

/** Dev desktop stays on the memorable 17996 so devtools/logs are predictable.
 *  Packaged builds ask the OS for a free ephemeral port instead — avoids
 *  collisions with a terminal `bun run dev` (17996 Vite + 17007 backend)
 *  and with any prior packaged instance that's still shutting down. */
const DEV_BASE_PORT = 17996;
const MAX_PORT_ATTEMPTS = 10;

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Failed to allocate ephemeral port"));
      }
    });
  });
}

/** Launcher Bun process */
let launcherProcess: ChildProcess | null = null;
let launcherUrl: string | null = null;
let launcherPort: number | null = null;

/** Mode session child processes (tracked by PID) */
const sessionProcesses = new Map<
  number,
  { specifier: string; workspace: string; url: string; startedAt: number }
>();

// ── Path resolution ──────────────────────────────────────────────────────────

function getBunBinaryPath(): string {
  if (!app.isPackaged) {
    // Dev mode: use system Bun
    try {
      const bunPath = execSync(
        process.platform === "win32" ? "where bun" : "which bun",
        { encoding: "utf-8" }
      ).trim().split("\n")[0];
      return bunPath;
    } catch {
      throw new Error("Bun not found in PATH. Install Bun: https://bun.sh");
    }
  }

  // Packaged: use bundled Bun binary
  const bunName = process.platform === "win32" ? "bun.exe" : "bun";
  const bunPath = path.join(process.resourcesPath, "bun", bunName);
  if (!existsSync(bunPath)) {
    throw new Error(`Bundled Bun binary not found at ${bunPath}`);
  }
  return bunPath;
}

function getPneumaProjectRoot(): string {
  if (!app.isPackaged) {
    // Dev mode: use the actual project directory (one level up from desktop/)
    return path.resolve(__dirname, "..", "..", "..");
  }
  return path.join(process.resourcesPath, "pneuma");
}

function getPneumaEntryPoint(): string {
  return path.join(getPneumaProjectRoot(), "bin", "pneuma.ts");
}

const MARKER_START = "___PNEUMA_PATH_START___";
const MARKER_END = "___PNEUMA_PATH_END___";

/**
 * Read the user's PATH out of their login shell.
 *
 * Mirrors `server/path-resolver.ts::captureUserShellPath` — the desktop
 * tsconfig pins `rootDir: "src"`, so the logic is duplicated rather than
 * imported. Keep the two in sync.
 *
 * `echo $PATH` is wrong here: fish stores PATH as a list and joins it with
 * spaces, and `-i` runs interactive rc files, so greeters (fastfetch et al.)
 * write ANSI art to the same stdout. `printenv` plus own-line markers plus a
 * validation pass is what survives all three shells.
 */
function captureShellPath(): string {
  if (process.platform === "win32") return "";
  try {
    const script = `echo ${MARKER_START}; printenv PATH; echo ${MARKER_END}`;
    const raw = execSync(
      `${process.env.SHELL || "/bin/sh"} -ilc ${JSON.stringify(script)}`,
      { encoding: "utf-8", timeout: 5000 }
    );
    // eslint-disable-next-line no-control-regex
    const text = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    const start = text.indexOf(MARKER_START);
    if (start === -1) return "";
    const end = text.indexOf(MARKER_END, start + MARKER_START.length);
    if (end === -1) return "";
    const line = text
      .slice(start + MARKER_START.length, end)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!line) return "";
    // Guard against capturing greeter output instead of a real PATH.
    const entries = line.split(path.delimiter).filter(Boolean);
    if (!entries.some((dir) => dir.startsWith("/") && existsSync(dir))) return "";
    return line;
  } catch {
    return "";
  }
}

/** Build PATH with bundled Bun directory prepended */
function buildEnv(): NodeJS.ProcessEnv {
  const bunDir = path.dirname(getBunBinaryPath());
  const currentPath = process.env.PATH || "";
  const shellPath = captureShellPath();

  const combinedPath = [bunDir, shellPath, currentPath]
    .filter(Boolean)
    .join(path.delimiter);

  return {
    ...process.env,
    PATH: combinedPath,
    // Must unset CLAUDECODE to avoid conflicts with Claude Code CLI
    CLAUDECODE: undefined,
  };
}

// ── Launcher process ─────────────────────────────────────────────────────────

export async function spawnLauncherProcess(): Promise<void> {
  const bunPath = getBunBinaryPath();
  const entryPoint = getPneumaEntryPoint();
  const port = app.isPackaged ? await pickFreePort() : DEV_BASE_PORT;

  console.log(`[bun-process] Starting launcher: ${bunPath} ${entryPoint}`);
  console.log(`[bun-process] Project root: ${getPneumaProjectRoot()}`);

  const args = [entryPoint, "--no-open", "--no-prompt", "--port", String(port)];

  // In dev mode, pass --dev for Vite HMR
  if (!app.isPackaged) {
    args.push("--dev");
  }

  launcherProcess = spawn(bunPath, args, {
    cwd: getPneumaProjectRoot(),
    env: buildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  launcherPort = port;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Launcher process timed out waiting for ready signal"));
    }, 30000);

    let stderr = "";
    let resolved = false;

    launcherProcess!.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      // Each chunk can span multiple lines — split so the viewer can filter
      // and so individual session-child lines (already prefixed by the
      // launcher as `[launcher] ...`) land as separate rows.
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        writeToTerminal("info", `[launcher:stdout] ${line}`);
        logEntry("info", "launcher:stdout", line);
      }

      if (resolved) return;

      // Wait for the final "Marketplace → <url>" signal which means
      // both backend AND Vite dev server (if dev mode) are ready.
      // This is the URL the user should actually see.
      //
      // The launcher emits BOTH a localized human line (e.g.
      // `模式画廊 → http://...` for zh-CN) and a stable English marker line
      // `Marketplace → http://...` (since pneuma-skills 3.9.1). The English
      // marker is matched here so the wrapper survives any future i18n
      // additions without coordinated changes.
      //
      // The localized-line fallback below covers the small 3.8.0–3.9.0
      // window when the launcher emitted ONLY the localized form. Defense
      // in depth — a packaged wrapper that hasn't been rebuilt for years
      // should still survive an i18n drift in the launcher.
      const marketplaceMatch =
        text.match(/Marketplace\s+→\s+(https?:\/\/\S+)/) ||
        // Localized variants from 3.8.0+ — any line ending in `→ <url>`
        // counts. Launcher only emits `→ url` for the ready signal.
        text.match(/→\s+(https?:\/\/\S+)/);
      if (marketplaceMatch) {
        resolved = true;
        launcherUrl = marketplaceMatch[1].replace("0.0.0.0", "localhost");
        console.log(`[bun-process] Launcher ready at ${launcherUrl}`);
        clearTimeout(timeout);
        resolve();
        return;
      }

      // Fallback: also match "[pneuma] ready <url>" for non-launcher modes
      const readyMatch = text.match(/\[pneuma\] ready\s+(https?:\/\/\S+)/);
      if (readyMatch) {
        resolved = true;
        launcherUrl = readyMatch[1].replace("0.0.0.0", "localhost");
        console.log(`[bun-process] Launcher ready at ${launcherUrl}`);
        clearTimeout(timeout);
        resolve();
      }
    });

    launcherProcess!.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        writeToTerminal("error", `[launcher:stderr] ${line}`);
        logEntry("warn", "launcher:stderr", line);
      }
    });

    launcherProcess!.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn launcher: ${err.message}`));
    });

    launcherProcess!.on("exit", (code) => {
      clearTimeout(timeout);
      if (!launcherUrl) {
        reject(
          new Error(
            `Launcher exited with code ${code} before ready.\nstderr: ${stderr}`
          )
        );
      }
      launcherProcess = null;
      launcherUrl = null;
    });
  });
}

export function getLauncherUrl(): string | null {
  return launcherUrl;
}

export function getLauncherPort(): number | null {
  return launcherPort;
}

// ── Session tracking ─────────────────────────────────────────────────────────

export function trackSessionProcess(
  pid: number,
  info: { specifier: string; workspace: string; url: string }
) {
  sessionProcesses.set(pid, { ...info, startedAt: Date.now() });
}

export function untrackSessionProcess(pid: number) {
  sessionProcesses.delete(pid);
}

export function getRunningSessionsForTray(): Array<{
  pid: number;
  specifier: string;
  workspace: string;
  url: string;
}> {
  return Array.from(sessionProcesses.entries()).map(([pid, info]) => ({
    pid,
    ...info,
  }));
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function killAllProcesses() {
  if (launcherProcess && !launcherProcess.killed) {
    console.log("[bun-process] Killing launcher process");
    launcherProcess.kill("SIGTERM");
    launcherProcess = null;
  }

  // Session processes are spawned by the launcher, killing the launcher
  // should cascade. But we also send explicit kills.
  for (const [pid] of sessionProcesses) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  sessionProcesses.clear();
}
