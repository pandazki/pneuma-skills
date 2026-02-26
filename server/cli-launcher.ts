/**
 * CLI Launcher — spawns Claude Code CLI with --sdk-url WebSocket connection.
 * Ported from Companion, stripped of Codex/Docker/Agent/Container branches.
 */

import { randomUUID } from "node:crypto";
import type { Subprocess } from "bun";
import { resolveBinary, getEnrichedPath } from "./path-resolver.js";

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
  /** Existing session ID to reuse for WS routing (instead of generating a new UUID) */
  sessionId?: string;
  /** CLI's internal session ID for --resume */
  resumeSessionId?: string;
}

/**
 * Manages Claude Code CLI backend processes.
 */
export class CliLauncher {
  private sessions = new Map<string, SdkSessionInfo>();
  private processes = new Map<string, Subprocess>();
  private port: number;
  private exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];

  constructor(port: number) {
    this.port = port;
  }

  /** Register a callback for when a CLI process exits. */
  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.exitHandlers.push(cb);
  }

  /**
   * Launch a new CLI session.
   */
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
      // Pre-populate for resume so exit handler knows the session was valid
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

    const sdkUrl = `ws://localhost:${this.port}/ws/cli/${sessionId}`;

    const args: string[] = [
      "--sdk-url", sdkUrl,
      "--print",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }
    if (options.allowedTools) {
      for (const tool of options.allowedTools) {
        args.push("--allowedTools", tool);
      }
    }

    // Resume a previous CLI session if requested
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }

    // Always pass -p "" for headless mode
    args.push("-p", "");

    const spawnCmd = [binary, ...args];
    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: undefined,
      ...options.env,
      PATH: getEnrichedPath(),
    };

    console.log(`[cli-launcher] Spawning session ${sessionId}: ${spawnCmd.join(" ")}`);

    const proc = Bun.spawn(spawnCmd, {
      cwd: info.cwd,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    info.pid = proc.pid;
    this.processes.set(sessionId, proc);

    // Stream stdout/stderr for debugging
    this.pipeOutput(sessionId, proc);

    // Monitor process exit
    const spawnedAt = Date.now();
    proc.exited.then((exitCode) => {
      console.log(`[cli-launcher] Session ${sessionId} exited (code=${exitCode})`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.state = "exited";
        session.exitCode = exitCode;

        // If exited immediately after --resume, resume likely failed — clear cliSessionId
        const uptime = Date.now() - spawnedAt;
        if (uptime < 5000 && options.resumeSessionId) {
          console.error(`[cli-launcher] Session ${sessionId} exited immediately after --resume (${uptime}ms). Clearing cliSessionId.`);
          session.cliSessionId = undefined;
        }
      }
      this.processes.delete(sessionId);
      for (const handler of this.exitHandlers) {
        try { handler(sessionId, exitCode); } catch {}
      }
    });
  }

  /**
   * Mark a session as connected (called when CLI establishes WS connection).
   */
  markConnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && (session.state === "starting" || session.state === "connected")) {
      session.state = "connected";
      console.log(`[cli-launcher] Session ${sessionId} connected via WebSocket`);
    }
  }

  /**
   * Store the CLI's internal session ID (from system.init message).
   */
  setCLISessionId(sessionId: string, cliSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cliSessionId = cliSessionId;
    }
  }

  /**
   * Kill a session's CLI process.
   */
  async kill(sessionId: string): Promise<boolean> {
    const proc = this.processes.get(sessionId);
    if (!proc) return false;

    proc.kill("SIGTERM");

    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);

    if (!exited) {
      console.log(`[cli-launcher] Force-killing session ${sessionId}`);
      proc.kill("SIGKILL");
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

  private async pipeStream(
    sessionId: string,
    stream: ReadableStream<Uint8Array> | null,
    label: "stdout" | "stderr",
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const log = label === "stdout" ? console.log : console.error;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.trim()) {
          log(`[session:${sessionId}:${label}] ${text.trimEnd()}`);
        }
      }
    } catch {
      // stream closed
    }
  }

  private pipeOutput(sessionId: string, proc: Subprocess): void {
    const stdout = proc.stdout;
    const stderr = proc.stderr;
    if (stdout && typeof stdout !== "number") {
      this.pipeStream(sessionId, stdout, "stdout");
    }
    if (stderr && typeof stderr !== "number") {
      this.pipeStream(sessionId, stderr, "stderr");
    }
  }
}
