import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { existsSync } from "node:fs";

/** Port range for pneuma server processes */
const BASE_PORT = 17996;
const MAX_PORT_ATTEMPTS = 10;

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

/** Build PATH with bundled Bun directory prepended */
function buildEnv(): NodeJS.ProcessEnv {
  const bunDir = path.dirname(getBunBinaryPath());
  const currentPath = process.env.PATH || "";

  // Capture user's shell PATH for Claude CLI detection
  let shellPath = "";
  try {
    if (process.platform !== "win32") {
      shellPath = execSync(
        `${process.env.SHELL || "/bin/sh"} -ilc 'echo $PATH'`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
    }
  } catch {}

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
  const port = BASE_PORT;

  console.log(`[bun-process] Starting launcher: ${bunPath} ${entryPoint}`);
  console.log(`[bun-process] Project root: ${getPneumaProjectRoot()}`);

  const args = [entryPoint, "--no-open", "--port", String(port)];

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
      console.log(`[launcher:stdout] ${text.trim()}`);

      if (resolved) return;

      // Wait for the final "Marketplace → <url>" signal which means
      // both backend AND Vite dev server (if dev mode) are ready.
      // This is the URL the user should actually see.
      const marketplaceMatch = text.match(/Marketplace\s+→\s+(https?:\/\/\S+)/);
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
      console.error(`[launcher:stderr] ${text.trim()}`);
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
