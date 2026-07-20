/**
 * Kimi CLI launcher — spawns `kimi acp` (the Kimi Code ACP server over stdio)
 * and tracks process lifecycle. Mirrors the structure of CodexCliLauncher
 * (backends/codex/cli-launcher.ts) for a stdio JSON-RPC protocol.
 *
 * The process is long-lived: one `kimi acp` server per Pneuma session, alive
 * across turns. All protocol work (handshake, session setup, prompt turns,
 * permission round trips) lives in `KimiAdapter`; this file only owns spawn,
 * environment, and kill.
 *
 * The ACP session id is returned synchronously by `session/new` — the adapter
 * fires `onSessionId` when it lands, and the launcher records it here for
 * `AgentSessionInfo.agentSessionId` / resume.
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
  /** ACP session id (returned by `session/new`); used for `session/resume`. */
  kimiSessionId?: string;
}

export interface KimiLaunchOptions {
  cwd?: string;
  model?: string;
  kimiBinary?: string;
  env?: Record<string, string>;
  /** Pneuma-side session ID (preserved if provided). */
  sessionId?: string;
  /** ACP session ID to resume (passed to `session/resume`). */
  resumeKimiSessionId?: string;
  /** Pneuma permission mode — mapped onto ACP session modes by the adapter. */
  permissionMode?: string;
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

    // `kimi acp` takes no other flags — working directory rides the process
    // cwd plus the ACP `session/new` `cwd` param; model selection goes
    // through `session/set_model`; interrupts are the `session/cancel`
    // notification (no signal games).
    const args = ["acp"];

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
      stdio: ["pipe", "pipe", "pipe"],
    });

    info.pid = nodeProc.pid;
    this.nodeProcesses.set(sessionId, nodeProc);

    const adapter = new KimiAdapter({
      sessionId,
      stdin: nodeProc.stdin!,
      stdout: nodeProc.stdout!,
      stderr: nodeProc.stderr!,
      cwd: info.cwd,
      resumeSessionId: options.resumeKimiSessionId,
      model: options.model,
      permissionMode: options.permissionMode,
      killProcess: async () => {
        nodeProc.kill("SIGTERM");
        await new Promise<void>((res) => {
          const timer = setTimeout(() => { nodeProc.kill("SIGKILL"); res(); }, 5000);
          nodeProc.once("exit", () => { clearTimeout(timer); res(); });
        });
      },
    });
    this.adapters.set(sessionId, adapter);

    adapter.onSessionId((acpSessionId: string) => {
      info.kimiSessionId = acpSessionId;
      info.state = "connected";
    });

    adapter.onDisconnect(() => {
      info.state = "exited";
      this.adapters.delete(sessionId);
    });

    for (const handler of this.adapterCreatedHandlers) {
      try { handler(sessionId, adapter); } catch {}
    }

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
