/**
 * Kimi CLI launcher — spawns the kimi process with stream-json IO and tracks
 * lifecycle. Mirrors the structure of CodexCliLauncher (backends/codex/cli-launcher.ts)
 * but for a simpler stdio NDJSON protocol.
 *
 * The kimi process is long-lived: stays alive across turns as long as stdin
 * remains open. Each user turn = one NDJSON line on stdin. Verified against
 * kimi-cli v1.41.0.
 */

import { randomUUID } from "node:crypto";
import { delimiter, resolve } from "node:path";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { resolveBinary, getEnrichedPath } from "../../server/path-resolver.js";
import { KimiAdapter } from "./kimi-adapter.js";

export interface KimiSessionInfo {
  sessionId: string;
  pid?: number;
  state: "starting" | "connected" | "running" | "exited";
  exitCode?: number | null;
  model?: string;
  cwd: string;
  createdAt: number;
  /** Kimi session UUID, captured from stderr; used for `-r` resume. */
  kimiSessionId?: string;
}

export interface KimiLaunchOptions {
  cwd?: string;
  model?: string;
  kimiBinary?: string;
  env?: Record<string, string>;
  /** Pneuma-side session ID (preserved if provided). */
  sessionId?: string;
  /** Kimi session ID for resume (passed as `-r <id>`). */
  resumeKimiSessionId?: string;
}

export class KimiCliLauncher {
  private sessions = new Map<string, KimiSessionInfo>();
  private nodeProcesses = new Map<string, ChildProcess>();
  private adapters = new Map<string, KimiAdapter>();
  private exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];
  private adapterCreatedHandlers: ((sessionId: string, adapter: KimiAdapter) => void)[] = [];

  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.exitHandlers.push(cb);
  }

  onAdapterCreated(cb: (sessionId: string, adapter: KimiAdapter) => void): void {
    this.adapterCreatedHandlers.push(cb);
  }

  launch(options: KimiLaunchOptions = {}): KimiSessionInfo {
    const sessionId = options.sessionId || randomUUID();
    const cwd = options.cwd || process.cwd();
    const info: KimiSessionInfo = {
      sessionId,
      state: "starting",
      model: options.model,
      cwd,
      createdAt: Date.now(),
      kimiSessionId: options.resumeKimiSessionId,
    };
    this.sessions.set(sessionId, info);
    this.spawnKimi(sessionId, info, options);
    return info;
  }

  private spawnKimi(sessionId: string, info: KimiSessionInfo, options: KimiLaunchOptions): void {
    let binary = options.kimiBinary || "kimi";
    const resolved = resolveBinary(binary);
    if (resolved) {
      binary = resolved;
    } else {
      console.error(`[kimi-launcher] Binary "${binary}" not found in PATH`);
      info.state = "exited";
      info.exitCode = 127;
      return;
    }

    // Pre-allocate the kimi session UUID so we know it before the agent starts.
    // Kimi only prints `kimi -r <uuid>` to stderr at process exit, so we can't
    // capture it from a live session — but it accepts any UUID via -r and
    // creates a new session with that id when not found.
    const kimiSessionId = options.resumeKimiSessionId ?? randomUUID();
    info.kimiSessionId = kimiSessionId;

    const args: string[] = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "-y",
      "--work-dir", info.cwd,
      "-r", kimiSessionId,
    ];
    if (options.model) args.push("--model", options.model);

    const binaryDir = resolve(binary, "..");
    const enrichedPath = getEnrichedPath();
    const spawnPath = [binaryDir, ...enrichedPath.split(delimiter)].filter(Boolean).join(delimiter);

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: undefined, // matches codex/claude convention — prevents nested-invocation confusion
      ...options.env,
      PATH: spawnPath,
    };
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(spawnEnv)) {
      if (v !== undefined) cleanEnv[k] = v;
    }

    console.log(`[kimi-launcher] Spawning session ${sessionId}: ${binary} ${args.join(" ")}`);

    const nodeProc = nodeSpawn(binary, args, {
      cwd: info.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"], // stderr piped (we parse it for session ID)
    });

    info.pid = nodeProc.pid;
    this.nodeProcesses.set(sessionId, nodeProc);

    const adapter = new KimiAdapter({
      sessionId,
      stdin: nodeProc.stdin!,
      stdout: nodeProc.stdout!,
      stderr: nodeProc.stderr!,
      killProcess: async () => {
        nodeProc.kill("SIGTERM");
        await new Promise<void>((res) => {
          const timer = setTimeout(() => { nodeProc.kill("SIGKILL"); res(); }, 5000);
          nodeProc.once("exit", () => { clearTimeout(timer); res(); });
        });
      },
      interruptProcess: () => {
        // SIGINT (not SIGTERM) — kimi's print-mode signal handler turns SIGINT
        // into a `cancel_event` that aborts the in-flight step but keeps the
        // process alive to read the next user message. SIGTERM would kill it.
        try { nodeProc.kill("SIGINT"); } catch {}
      },
    });
    this.adapters.set(sessionId, adapter);

    adapter.onSessionId((kimiSessionId: string) => {
      info.kimiSessionId = kimiSessionId;
      info.state = "connected";
    });

    adapter.onDisconnect(() => {
      info.state = "exited";
      this.adapters.delete(sessionId);
    });

    for (const handler of this.adapterCreatedHandlers) {
      try { handler(sessionId, adapter); } catch {}
    }

    // Now that both the launcher's and the bridge's onSessionId subscribers
    // are wired, seed the kimi session id we pre-allocated. This fires the
    // bridge's onCLISessionId callback which persists agentSessionId to disk.
    adapter.seedSessionId(kimiSessionId);

    nodeProc.once("exit", (exitCode) => {
      const session = this.sessions.get(sessionId);
      const uptime = session ? Math.round((Date.now() - session.createdAt) / 1000) : 0;
      console.error(`[kimi-launcher] Session ${sessionId} exited (code=${exitCode}, uptime=${uptime}s)`);
      if (session) {
        session.state = "exited";
        session.exitCode = exitCode;
      }
      this.nodeProcesses.delete(sessionId);
      this.adapters.delete(sessionId);
      for (const handler of this.exitHandlers) {
        try { handler(sessionId, exitCode); } catch {}
      }
    });
  }

  markConnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "starting") session.state = "connected";
  }

  setKimiSessionId(sessionId: string, kimiSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.kimiSessionId = kimiSessionId;
  }

  getSession(sessionId: string): KimiSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAdapter(sessionId: string): KimiAdapter | undefined {
    return this.adapters.get(sessionId);
  }

  isAlive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.state !== "exited";
  }

  async kill(sessionId: string): Promise<boolean> {
    const adapter = this.adapters.get(sessionId);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(sessionId);
    }

    const nodeProc = this.nodeProcesses.get(sessionId);
    if (!nodeProc) return false;

    nodeProc.kill("SIGTERM");
    await new Promise<void>((res) => {
      const timer = setTimeout(() => { nodeProc.kill("SIGKILL"); res(); }, 5000);
      nodeProc.once("exit", () => { clearTimeout(timer); res(); });
    });

    const session = this.sessions.get(sessionId);
    if (session) { session.state = "exited"; session.exitCode = -1; }
    this.nodeProcesses.delete(sessionId);
    return true;
  }

  async killAll(): Promise<void> {
    const ids = [...this.nodeProcesses.keys()];
    await Promise.all(ids.map((id) => this.kill(id)));
  }
}
