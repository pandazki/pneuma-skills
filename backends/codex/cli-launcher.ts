/**
 * Codex CLI Launcher — spawns Codex app-server as a child process with stdio transport.
 *
 * Unlike Claude Code which connects back via WebSocket (--sdk-url),
 * Codex communicates via JSON-RPC over stdin/stdout.
 */

import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { existsSync, realpathSync, readFileSync } from "node:fs";
import type { Subprocess } from "bun";
import { resolveBinary, getEnrichedPath } from "../../server/path-resolver.js";
import { CodexAdapter, StdioTransport } from "./codex-adapter.js";
import type { CodexAdapterOptions } from "./codex-adapter.js";

export interface CodexSessionInfo {
  sessionId: string;
  pid?: number;
  state: "starting" | "connected" | "running" | "exited";
  exitCode?: number | null;
  model?: string;
  permissionMode?: string;
  cwd: string;
  createdAt: number;
  /** Codex thread ID, used for resume */
  threadId?: string;
}

export interface CodexLaunchOptions {
  model?: string;
  permissionMode?: string;
  cwd?: string;
  codexBinary?: string;
  env?: Record<string, string>;
  /** Existing session ID to reuse */
  sessionId?: string;
  /** Codex thread ID for resume */
  resumeThreadId?: string;
  /** Sandbox mode */
  sandbox?: "workspace-write" | "danger-full-access";
}

/** Check if a file is a text script (not a native binary) by reading its first bytes. */
function isTextScript(filePath: string): boolean {
  try {
    const buf = readFileSync(filePath, { encoding: null });
    // Native binaries start with magic bytes (ELF, Mach-O, PE).
    // Scripts start with "#!" or printable text.
    if (buf.length < 2) return false;
    // Mach-O: 0xFEEDFACE, 0xFEEDFACF, 0xCAFEBABE
    if (buf[0] === 0xfe || buf[0] === 0xca || buf[0] === 0xcf) return false;
    // ELF: 0x7F 'E'
    if (buf[0] === 0x7f && buf[1] === 0x45) return false;
    // PE (Windows): 'M' 'Z'
    if (buf[0] === 0x4d && buf[1] === 0x5a) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Manages Codex CLI backend processes via stdio JSON-RPC transport.
 */
export class CodexCliLauncher {
  private sessions = new Map<string, CodexSessionInfo>();
  private processes = new Map<string, Subprocess>();
  private adapters = new Map<string, CodexAdapter>();
  private exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];
  private adapterCreatedHandlers: ((sessionId: string, adapter: CodexAdapter) => void)[] = [];

  /** Register a callback for when a CLI process exits. */
  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.exitHandlers.push(cb);
  }

  /** Register a callback for when a CodexAdapter is created. */
  onAdapterCreated(cb: (sessionId: string, adapter: CodexAdapter) => void): void {
    this.adapterCreatedHandlers.push(cb);
  }

  /**
   * Launch a new Codex session.
   */
  launch(options: CodexLaunchOptions = {}): CodexSessionInfo {
    const sessionId = options.sessionId || randomUUID();
    const cwd = options.cwd || process.cwd();

    const info: CodexSessionInfo = {
      sessionId,
      state: "starting",
      model: options.model,
      permissionMode: options.permissionMode,
      cwd,
      createdAt: Date.now(),
      threadId: options.resumeThreadId,
    };

    this.sessions.set(sessionId, info);
    this.spawnCodex(sessionId, info, options);
    return info;
  }

  private spawnCodex(sessionId: string, info: CodexSessionInfo, options: CodexLaunchOptions): void {
    let binary = options.codexBinary || "codex";
    const resolved = resolveBinary(binary);
    if (resolved) {
      binary = resolved;
    } else {
      console.error(`[codex-launcher] Binary "${binary}" not found in PATH`);
      info.state = "exited";
      info.exitCode = 127;
      return;
    }

    const args: string[] = ["app-server"];
    // Enable Codex multi-agent mode (matches companion behavior)
    args.push("--enable", "multi_agent");

    // Use the user's default CODEX_HOME (~/.codex) so their existing
    // login credentials and config are inherited.

    // Sibling node resolution — if `node` exists next to the codex binary AND
    // the binary is a text script (not a native executable), use node to run it.
    // This avoids shebang issues with npm-installed codex.
    const binaryDir = resolve(binary, "..");
    const siblingNode = join(binaryDir, "node");
    const enrichedPath = getEnrichedPath();
    const spawnPath = [binaryDir, ...enrichedPath.split(":")].filter(Boolean).join(":");

    let spawnCmd: string[];
    const useSiblingNode = existsSync(siblingNode) && isTextScript(binary);
    if (useSiblingNode) {
      let codexScript: string;
      try {
        codexScript = realpathSync(binary);
      } catch {
        codexScript = binary;
      }
      spawnCmd = [siblingNode, codexScript, ...args];
    } else {
      spawnCmd = [binary, ...args];
    }

    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: undefined,
      ...options.env,
      PATH: spawnPath,
    };

    console.log(`[codex-launcher] Spawning session ${sessionId}: ${spawnCmd.join(" ")}`);

    const proc = Bun.spawn(spawnCmd, {
      cwd: info.cwd,
      env: spawnEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    info.pid = proc.pid;
    this.processes.set(sessionId, proc);

    // Pipe stderr for debugging
    this.pipeStderr(sessionId, proc);

    // Create adapter — this handles init, thread start, and all JSON-RPC communication
    const adapterOptions: CodexAdapterOptions = {
      model: options.model,
      cwd: info.cwd,
      approvalMode: options.permissionMode,
      sandbox: options.sandbox,
      threadId: options.resumeThreadId,
      killProcess: async () => {
        try {
          proc.kill("SIGTERM");
          await Promise.race([
            proc.exited,
            new Promise((r) => setTimeout(r, 5000)),
          ]);
        } catch {}
      },
    };

    const adapter = new CodexAdapter(proc, sessionId, adapterOptions);
    this.adapters.set(sessionId, adapter);

    // Wire adapter callbacks
    adapter.onSessionMeta((meta) => {
      if (meta.cliSessionId) {
        info.threadId = meta.cliSessionId;
      }
      info.state = "connected";
    });

    adapter.onDisconnect(() => {
      info.state = "exited";
      this.adapters.delete(sessionId);
    });

    adapter.onInitError((error) => {
      console.error(`[codex-launcher] Session ${sessionId} init failed: ${error}`);
      info.state = "exited";
      info.exitCode = 1;
    });

    // Notify listeners that adapter is ready
    for (const handler of this.adapterCreatedHandlers) {
      try { handler(sessionId, adapter); } catch {}
    }

    // Monitor process exit
    proc.exited.then((exitCode) => {
      console.log(`[codex-launcher] Session ${sessionId} exited (code=${exitCode})`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.state = "exited";
        session.exitCode = exitCode;
      }
      this.processes.delete(sessionId);
      this.adapters.delete(sessionId);
      for (const handler of this.exitHandlers) {
        try { handler(sessionId, exitCode); } catch {}
      }
    });
  }

  markConnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === "starting") {
      session.state = "connected";
    }
  }

  setThreadId(sessionId: string, threadId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.threadId = threadId;
    }
  }

  getSession(sessionId: string): CodexSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAdapter(sessionId: string): CodexAdapter | undefined {
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

    const proc = this.processes.get(sessionId);
    if (!proc) return false;

    if (process.platform === "win32") {
      proc.kill();
    } else {
      proc.kill("SIGTERM");
    }

    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);

    if (!exited) {
      if (process.platform === "win32") {
        proc.kill();
      } else {
        proc.kill("SIGKILL");
      }
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = "exited";
      session.exitCode = -1;
    }
    this.processes.delete(sessionId);
    return true;
  }

  async killAll(): Promise<void> {
    const ids = [...this.processes.keys()];
    await Promise.all(ids.map((id) => this.kill(id)));
  }

  private async pipeStderr(sessionId: string, proc: Subprocess): Promise<void> {
    const stderr = proc.stderr;
    if (!stderr || typeof stderr === "number") return;
    const reader = (stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.trim()) {
          console.error(`[codex:${sessionId}:stderr] ${text.trimEnd()}`);
        }
      }
    } catch {
      // stream closed
    }
  }
}
