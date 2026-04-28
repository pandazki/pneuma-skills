/**
 * Claude Code CLI Launcher — stdio stream-json transport.
 *
 * Replaces the old `--sdk-url ws://localhost:PORT` bridge. Anthropic locked
 * `--sdk-url` behind an Anthropic-host whitelist (CC 2.1.118+ rejects
 * `localhost`), and they explicitly position the headless CLI itself as
 * "Anthropic's official product built for scripted and automated use."
 * Crystal, Conductor, and opcode all converged on the same shape, which
 * is what we use here:
 *
 *   claude --print
 *          --output-format stream-json
 *          --input-format  stream-json
 *          --include-partial-messages
 *          --verbose
 *          --permission-mode bypassPermissions
 *          [--model X]
 *          [--resume <claudeSessionId>]
 *
 * - `--print` keeps CC out of the interactive TTY UI.
 * - `--output-format stream-json` makes stdout NDJSON: one event per line,
 *   exactly the protocol Pneuma's bridge already speaks.
 * - `--input-format stream-json` lets us deliver multiple user turns over
 *   stdin without having to kill+respawn per turn (closer to the existing
 *   long-running bridge model).
 * - The user's `~/.claude/.credentials.json` flows through unmodified, so
 *   the spawned process authenticates as the user's own Claude Code client
 *   — Pro/Max subscription keeps working, and Anthropic's OpenClaw
 *   third-party-OAuth ban does not apply.
 *
 * Permissions: v1 stays on `bypassPermissions` to match Pneuma's existing
 * default; an MCP-based `--permission-prompt-tool` is a follow-up.
 */

import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { resolveBinary, getEnrichedPath } from "../../server/path-resolver.js";

export interface SdkSessionInfo {
  sessionId: string;
  pid?: number;
  state: "starting" | "connected" | "running" | "exited";
  exitCode?: number | null;
  model?: string;
  permissionMode?: string;
  cwd: string;
  createdAt: number;
  /** The CLI's internal session ID (from system.init), used for --resume */
  cliSessionId?: string;
}

export interface LaunchOptions {
  model?: string;
  permissionMode?: string;
  cwd?: string;
  claudeBinary?: string;
  allowedTools?: string[];
  env?: Record<string, string>;
  /** Existing session ID to reuse (Pneuma-side, not CC-side) */
  sessionId?: string;
  /** CC's internal session ID for `--resume` */
  resumeSessionId?: string;
}

export interface ClaudeStdioHandlers {
  /** Fired with each NDJSON line CC writes to stdout. */
  onMessage: (sessionId: string, line: string) => void;
  /** Fired when the CLI process attaches (immediately after spawn). */
  onConnect: (sessionId: string, sendInput: (line: string) => void, close: () => void) => void;
  /** Fired when the CLI process exits. */
  onDisconnect: (sessionId: string) => void;
}

/**
 * Manages Claude Code CLI backend processes via stdio stream-json.
 *
 * Constructor takes no port — there is no WebSocket endpoint anymore. The
 * bridge wiring happens via the handler callbacks set with `setHandlers`.
 */
export class CliLauncher {
  private sessions = new Map<string, SdkSessionInfo>();
  private processes = new Map<string, ChildProcess>();
  private exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];
  private streamHandlers: ClaudeStdioHandlers | null = null;

  constructor(_port?: number) {
    // `_port` accepted for backwards compatibility with the old --sdk-url
    // signature (`new CliLauncher(port)`) so callers that haven't been
    // updated still construct cleanly. The value is ignored.
  }

  /** Wire stream callbacks. Called by bin/pneuma.ts at boot. */
  setHandlers(handlers: ClaudeStdioHandlers): void {
    this.streamHandlers = handlers;
  }

  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.exitHandlers.push(cb);
  }

  launch(options: LaunchOptions = {}): SdkSessionInfo {
    const sessionId = options.sessionId || randomUUID();
    const cwd = options.cwd || process.cwd();

    const info: SdkSessionInfo = {
      sessionId,
      state: "starting",
      model: options.model,
      permissionMode: options.permissionMode,
      cwd,
      createdAt: Date.now(),
      // Pre-populate so the exit handler can detect a failed --resume.
      cliSessionId: options.resumeSessionId,
    };

    this.sessions.set(sessionId, info);
    this.spawnCLI(sessionId, info, options);
    return info;
  }

  private spawnCLI(sessionId: string, info: SdkSessionInfo, options: LaunchOptions): void {
    let binary = options.claudeBinary || "claude";
    const resolved = resolveBinary(binary);
    if (resolved) {
      binary = resolved;
    } else {
      console.error(`[cli-launcher] Binary "${binary}" not found in PATH`);
      info.state = "exited";
      info.exitCode = 127;
      return;
    }

    const args: string[] = [
      "--print",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--include-hook-events",
      "--verbose",
    ];

    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    } else {
      // Match the previous default — the higher layers expect skipped prompts.
      args.push("--permission-mode", "bypassPermissions");
    }

    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.allowedTools) {
      for (const tool of options.allowedTools) {
        args.push("--allowedTools", tool);
      }
    }
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      // CC sets CLAUDECODE itself when running; clearing it ensures we're not
      // mistaken for a nested invocation that would short-circuit.
      CLAUDECODE: undefined,
      ...options.env,
      PATH: getEnrichedPath(),
    };

    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(spawnEnv)) {
      if (v !== undefined) cleanEnv[k] = v;
    }

    console.log(`[cli-launcher] Spawning session ${sessionId}: ${binary} ${args.join(" ")}`);

    // node:child_process used here for the same reason codex does:
    // Bun.spawn's ReadableStream can close prematurely on long-running
    // stdio pipes. node:child_process keeps streams open until the
    // process actually exits.
    const proc = nodeSpawn(binary, args, {
      cwd: info.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    info.pid = proc.pid ?? undefined;
    this.processes.set(sessionId, proc);

    // Wire stream callbacks. This happens synchronously after spawn so the
    // bridge can register the transport before the first stdout line lands.
    if (this.streamHandlers) {
      const stdin = proc.stdin;
      const sendInput = (line: string) => {
        if (!stdin || stdin.destroyed) return;
        // Each user message is one NDJSON line. The bridge already appends
        // "\n" via the existing sendToCLI path, so we just write what we got.
        stdin.write(line.endsWith("\n") ? line : line + "\n");
      };
      const close = () => {
        try {
          if (stdin && !stdin.destroyed) stdin.end();
        } catch {}
      };
      this.streamHandlers.onConnect(sessionId, sendInput, close);

      // Mark connected — there is no WS handshake to wait for anymore.
      info.state = "connected";
    }

    this.pipeStdoutNDJSON(sessionId, proc);
    this.pipeStderr(sessionId, proc);

    const spawnedAt = Date.now();
    proc.once("exit", (exitCode) => {
      console.log(`[cli-launcher] Session ${sessionId} exited (code=${exitCode})`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.state = "exited";
        session.exitCode = exitCode ?? null;

        // If exited immediately after --resume, the resume likely failed —
        // clear cliSessionId so the next launch starts fresh.
        const uptime = Date.now() - spawnedAt;
        if (uptime < 5000 && options.resumeSessionId) {
          console.error(`[cli-launcher] Session ${sessionId} exited immediately after --resume (${uptime}ms). Clearing cliSessionId.`);
          session.cliSessionId = undefined;
        }
      }
      this.processes.delete(sessionId);
      this.streamHandlers?.onDisconnect(sessionId);
      for (const handler of this.exitHandlers) {
        try { handler(sessionId, exitCode ?? null); } catch {}
      }
    });

    proc.once("error", (err) => {
      console.error(`[cli-launcher] Spawn error for session ${sessionId}:`, err);
      info.state = "exited";
      info.exitCode = -1;
    });
  }

  /**
   * Compatibility no-op. The legacy `--sdk-url` path called this when the
   * CLI's WebSocket finished its handshake. With stdio there is nothing to
   * wait for — the spawn is the connection. Kept so existing callers don't
   * have to branch on backend.
   */
  markConnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "starting") {
      session.state = "connected";
    }
  }

  /** Stash CC's internal session ID (from system.init) for next-launch resume. */
  setCLISessionId(sessionId: string, cliSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cliSessionId = cliSessionId;
    }
  }

  async kill(sessionId: string): Promise<boolean> {
    const proc = this.processes.get(sessionId);
    if (!proc) return false;

    const sigterm = process.platform === "win32" ? undefined : "SIGTERM";
    try { proc.kill(sigterm as NodeJS.Signals | undefined); } catch {}

    const exited = await Promise.race([
      new Promise<true>((resolve) => proc.once("exit", () => resolve(true))),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);

    if (!exited) {
      console.log(`[cli-launcher] Force-killing session ${sessionId}`);
      const sigkill = process.platform === "win32" ? undefined : "SIGKILL";
      try { proc.kill(sigkill as NodeJS.Signals | undefined); } catch {}
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = "exited";
      session.exitCode = -1;
    }
    this.processes.delete(sessionId);
    return true;
  }

  getSession(sessionId: string): SdkSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  isAlive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.state !== "exited";
  }

  async killAll(): Promise<void> {
    const ids = [...this.processes.keys()];
    await Promise.all(ids.map((id) => this.kill(id)));
  }

  // ── Stream plumbing ─────────────────────────────────────────────────────

  /**
   * Buffer stdout until newlines arrive, then dispatch each complete NDJSON
   * line to the bridge. CC can split a single event across multiple chunks
   * on slow connections, so partials must accumulate in a leftover buffer.
   */
  private pipeStdoutNDJSON(sessionId: string, proc: ChildProcess): void {
    const stdout = proc.stdout;
    if (!stdout) return;
    let buffer = "";
    stdout.setEncoding("utf-8");
    stdout.on("data", (chunk: string) => {
      buffer += chunk;
      // Split on the last newline so any trailing partial stays in the buffer.
      const lastNl = buffer.lastIndexOf("\n");
      if (lastNl < 0) return;
      const complete = buffer.slice(0, lastNl);
      buffer = buffer.slice(lastNl + 1);
      // Pass the whole complete chunk to the bridge — feedCLIMessage handles
      // multi-line splits internally so we don't lose framing.
      if (complete.length > 0 && this.streamHandlers) {
        this.streamHandlers.onMessage(sessionId, complete);
      }
    });
    stdout.on("end", () => {
      if (buffer.trim() && this.streamHandlers) {
        this.streamHandlers.onMessage(sessionId, buffer);
      }
    });
  }

  private pipeStderr(sessionId: string, proc: ChildProcess): void {
    const stderr = proc.stderr;
    if (!stderr) return;
    stderr.setEncoding("utf-8");
    stderr.on("data", (chunk: string) => {
      const trimmed = chunk.trimEnd();
      if (trimmed) {
        console.error(`[session:${sessionId}:stderr] ${trimmed}`);
      }
    });
  }
}
