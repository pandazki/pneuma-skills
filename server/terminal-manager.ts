/**
 * Terminal Manager — manages PTY processes and their WebSocket connections.
 * Uses Bun's native terminal support (Bun.spawn with terminal option).
 */

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type { ServerWebSocket } from "bun";

interface TerminalSocketData {
  kind: "terminal";
  terminalId: string;
}

interface TerminalInstance {
  id: string;
  cwd: string;
  proc: ReturnType<typeof Bun.spawn>;
  browserSockets: Set<ServerWebSocket<TerminalSocketData>>;
  cols: number;
  rows: number;
  orphanTimer: ReturnType<typeof setTimeout> | null;
}

function resolveShell(): string {
  // process.env.SHELL may not reflect the user's configured default shell
  // (e.g. when launched from Claude Code which runs zsh).
  // On macOS, query the directory service for the real login shell.
  if (process.platform === "darwin") {
    try {
      const user = process.env.USER || execSync("whoami", { encoding: "utf-8" }).trim();
      const shell = execSync(`dscl . -read /Users/${user} UserShell`, { encoding: "utf-8", timeout: 3_000 })
        .trim().split(/\s+/).pop();
      if (shell && shell.startsWith("/")) return shell;
    } catch {}
  }
  return process.env.SHELL || "/bin/bash";
}

export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();

  spawn(cwd: string, cols = 80, rows = 24): string {
    const id = randomUUID();
    const shell = resolveShell();
    const sockets = new Set<ServerWebSocket<TerminalSocketData>>();

    const proc = Bun.spawn([shell, "-l"], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", CLAUDECODE: undefined as any },
      terminal: {
        cols,
        rows,
        data: (_terminal: any, data: Uint8Array) => {
          for (const ws of sockets) {
            try { ws.sendBinary(data); } catch {}
          }
        },
        exit: () => {
          const exitMsg = JSON.stringify({ type: "exit", exitCode: proc.exitCode ?? 0 });
          for (const ws of sockets) {
            try { ws.send(exitMsg); } catch {}
          }
          this.terminals.delete(id);
          console.log(`[terminal] Terminal ${id} exited`);
        },
      },
    });

    const inst: TerminalInstance = {
      id,
      cwd,
      proc,
      browserSockets: sockets,
      cols,
      rows,
      orphanTimer: null,
    };

    this.terminals.set(id, inst);
    console.log(`[terminal] Spawned terminal ${id} (shell=${shell}, cwd=${cwd})`);
    return id;
  }

  getInfo(terminalId?: string): { id: string; cwd: string } | null {
    if (terminalId) {
      const inst = this.terminals.get(terminalId);
      return inst ? { id: inst.id, cwd: inst.cwd } : null;
    }
    // Return first active terminal
    const first = this.terminals.values().next().value;
    return first ? { id: first.id, cwd: first.cwd } : null;
  }

  addBrowserSocket(ws: ServerWebSocket<TerminalSocketData>) {
    const { terminalId } = ws.data;
    const inst = this.terminals.get(terminalId);
    if (!inst) {
      ws.close(4004, "Terminal not found");
      return;
    }
    inst.browserSockets.add(ws);
    if (inst.orphanTimer) {
      clearTimeout(inst.orphanTimer);
      inst.orphanTimer = null;
    }
    console.log(`[terminal] Browser connected to terminal ${terminalId}`);
  }

  removeBrowserSocket(ws: ServerWebSocket<TerminalSocketData>) {
    const { terminalId } = ws.data;
    const inst = this.terminals.get(terminalId);
    if (!inst) return;
    inst.browserSockets.delete(ws);
    console.log(`[terminal] Browser disconnected from terminal ${terminalId}`);
    // Grace period before killing orphaned terminal
    if (inst.browserSockets.size === 0) {
      inst.orphanTimer = setTimeout(() => {
        const alive = this.terminals.get(terminalId);
        if (alive && alive.browserSockets.size === 0) {
          this.kill(terminalId);
        }
      }, 5_000);
    }
  }

  handleBrowserMessage(ws: ServerWebSocket<TerminalSocketData>, msg: string | Buffer) {
    const { terminalId } = ws.data;
    const inst = this.terminals.get(terminalId);
    if (!inst) return;
    const str = typeof msg === "string" ? msg : msg.toString("utf-8");
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === "input" && typeof parsed.data === "string") {
        const terminal = (inst.proc as any).terminal;
        if (terminal) terminal.write(parsed.data);
      } else if (parsed.type === "resize" && typeof parsed.cols === "number") {
        const terminal = (inst.proc as any).terminal;
        if (terminal) terminal.resize(parsed.cols, parsed.rows);
        inst.cols = parsed.cols;
        inst.rows = parsed.rows;
      }
    } catch {}
  }

  kill(terminalId?: string) {
    const id = terminalId || this.terminals.keys().next().value;
    if (!id) return;
    const inst = this.terminals.get(id);
    if (!inst) return;

    console.log(`[terminal] Killing terminal ${id}`);
    inst.proc.kill("SIGTERM");
    // Force kill after 2s
    setTimeout(() => {
      try { inst.proc.kill("SIGKILL"); } catch {}
    }, 2_000);

    for (const ws of inst.browserSockets) {
      try { ws.close(1000, "Terminal killed"); } catch {}
    }
    this.terminals.delete(id);
    if (inst.orphanTimer) clearTimeout(inst.orphanTimer);
  }

  killAll() {
    for (const id of [...this.terminals.keys()]) {
      this.kill(id);
    }
  }
}
