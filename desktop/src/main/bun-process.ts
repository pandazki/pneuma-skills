import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import { app } from "electron";
import { existsSync } from "node:fs";
import { logEntry, writeToTerminal } from "./logger.js";
import { captureShellPath, launcherEnvironment, type ShellPathResult } from "./startup-environment.js";
import { markBoot } from "./boot-profile.js";
import { createLauncherReadyParser } from "./launcher-readiness.js";

/** Dev desktop stays on the memorable 17996 so devtools/logs are predictable.
 *  Packaged builds ask the OS for a free ephemeral port instead — avoids
 *  collisions with a terminal `bun run dev` (17996 Vite + 17007 backend)
 *  and with any prior packaged instance that's still shutting down. */
const DEV_BASE_PORT = 17996;
const execFileAsync = promisify(execFile);

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
const startupAbort = new AbortController();

/** Mode session child processes (tracked by PID) */
const sessionProcesses = new Map<
  number,
  { specifier: string; workspace: string; url: string; startedAt: number }
>();

// ── Path resolution ──────────────────────────────────────────────────────────

async function getBunBinaryPath(shellPath: string): Promise<string> {
  if (!app.isPackaged) {
    // Dev mode: use system Bun
    try {
      const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", ["bun"], {
        encoding: "utf-8", timeout: 5000, killSignal: "SIGKILL", signal: startupAbort.signal,
        env: { ...process.env, PATH: [shellPath, process.env.PATH].filter(Boolean).join(path.delimiter) },
      });
      const bunPath = stdout.trim().split("\n")[0];
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

// One capture per desktop process, shared by every launcher attempt.
let shellPathPromise: Promise<ShellPathResult> | undefined;
function getShellPath(): Promise<ShellPathResult> {
  if (!shellPathPromise) {
    markBoot("shell-path-start");
    shellPathPromise = captureShellPath(process.env, 5000, startupAbort.signal).then((result) => {
      startupAbort.signal.throwIfAborted();
      if (result.status === "fallback") {
        console.warn(`[bun-process] ${result.reason}; using inherited PATH and server fallback directories`);
      }
      markBoot("shell-path-ready", { status: result.status });
      return result;
    });
  }
  return shellPathPromise;
}

// ── Launcher process ─────────────────────────────────────────────────────────

export async function spawnLauncherProcess(): Promise<void> {
  const [shellPath, port] = await Promise.all([
    getShellPath(),
    app.isPackaged ? pickFreePort() : Promise.resolve(DEV_BASE_PORT),
  ]);
  startupAbort.signal.throwIfAborted();
  const bunPath = await getBunBinaryPath(shellPath.path);
  startupAbort.signal.throwIfAborted();
  const entryPoint = getPneumaEntryPoint();

  console.log(`[bun-process] Starting launcher: ${bunPath} ${entryPoint}`);
  console.log(`[bun-process] Project root: ${getPneumaProjectRoot()}`);

  const args = [entryPoint, "--no-open", "--no-prompt", "--port", String(port)];

  // In dev mode, pass --dev for Vite HMR
  if (!app.isPackaged) {
    args.push("--dev");
  }

  markBoot("launcher-spawn");
  const child = launcherProcess = spawn(bunPath, args, {
    cwd: getPneumaProjectRoot(),
    env: launcherEnvironment(bunPath, shellPath, process.env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  launcherPort = port;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const parseReady = createLauncherReadyParser();
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      startupAbort.signal.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        launcherUrl = url!;
        console.log(`[bun-process] Launcher ready at ${launcherUrl}`);
        markBoot("launcher-service-ready");
        resolve();
      }
    };
    const onAbort = () => finish(new Error("Launcher startup cancelled"));
    const timeout = setTimeout(() => {
      finish(new Error("Launcher process timed out waiting for ready signal"));
      child.kill("SIGTERM");
    }, 30000);
    startupAbort.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        writeToTerminal("info", `[launcher:stdout] ${line}`);
        logEntry("info", "launcher:stdout", line);
      }
      if (!settled) {
        const url = parseReady(data);
        if (url) finish(undefined, url);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr = (stderr + text).slice(-65536);
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        writeToTerminal("error", `[launcher:stderr] ${line}`);
        logEntry("warn", "launcher:stderr", line);
      }
    });

    child.on("error", (err) => finish(new Error(`Failed to spawn launcher: ${err.message}`)));
    child.on("exit", (code) => {
      finish(new Error(`Launcher exited with code ${code} before ready.\nstderr: ${stderr}`));
      if (launcherProcess === child) {
        launcherProcess = null;
        launcherUrl = null;
      }
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
  startupAbort.abort();
  launcherUrl = null;
  launcherPort = null;
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
