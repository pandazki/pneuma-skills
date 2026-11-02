import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const MARKER_START = "___PNEUMA_PATH_START___";
const MARKER_END = "___PNEUMA_PATH_END___";

/** Keep marker parsing aligned with server/path-resolver.ts (separate build roots). */
export function parseShellPath(raw: string): string | null {
  // Interactive shell greeters can emit ANSI before or around the markers.
  const text = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  const start = text.indexOf(MARKER_START);
  if (start === -1) return null;
  const end = text.indexOf(MARKER_END, start + MARKER_START.length);
  if (end === -1) return null;
  const line = text.slice(start + MARKER_START.length, end)
    .split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  if (!line || !line.split(path.delimiter).some((dir) => path.isAbsolute(dir) && existsSync(dir))) return null;
  return line;
}

export interface ShellPathResult {
  path: string;
  status: "captured" | "fallback" | "windows";
  reason?: string;
}

/** One bounded, asynchronous attempt. `printenv` preserves fish's colon-delimited PATH. */
export async function captureShellPath(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<ShellPathResult> {
  if (process.platform === "win32") return { path: env.PATH || "", status: "windows" };
  return new Promise((resolve) => {
    const script = `echo ${MARKER_START}; printenv PATH; echo ${MARKER_END}`;
    execFile(env.SHELL || "/bin/sh", ["-ilc", script], {
      env,
      encoding: "utf-8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      signal,
    }, (error, stdout) => {
      if (error) {
        resolve({ path: env.PATH || "", status: "fallback", reason: signal?.aborted ? "shell capture cancelled" : error.killed ? "shell timeout" : "shell execution failed" });
        return;
      }
      const captured = parseShellPath(stdout);
      resolve(captured
        ? { path: captured, status: "captured" }
        : { path: env.PATH || "", status: "fallback", reason: "shell returned no valid PATH" });
    });
  });
}

/**
 * Desktop → Bun descendants: READY records a completed attempt, including fallback,
 * not successful shell capture. The server validates inherited PATH and appends
 * its existing fallback directories; unmarked CLI launches still capture normally.
 */
export function launcherEnvironment(bunPath: string, shellPath: ShellPathResult, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: [...new Set([path.dirname(bunPath), ...shellPath.path.split(path.delimiter), ...(env.PATH || "").split(path.delimiter)].filter(Boolean))].join(path.delimiter),
    PNEUMA_DESKTOP_PATH_READY: "1",
    CLAUDECODE: undefined,
  };
}
