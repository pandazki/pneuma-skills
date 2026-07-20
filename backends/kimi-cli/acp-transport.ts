/**
 * AcpTransport — line-delimited JSON-RPC 2.0 over a child process's
 * stdin/stdout, for the Kimi Code ACP server (`kimi acp`).
 *
 * Modeled on `backends/codex/codex-adapter.ts`'s `StdioTransport`
 * (specifically its `fromNodeStreams()` path): Node `child_process` streams
 * are used instead of Bun's `Subprocess` web streams because Bun's
 * `ReadableStream` for child stdout can close prematurely mid-session —
 * the same bug the Codex backend works around applies here identically.
 *
 * Differences from the Codex transport, driven by ACP semantics:
 *   - Every outbound frame carries `"jsonrpc": "2.0"` (Kimi's server is a
 *     strict JSON-RPC 2.0 peer; it emits the member on every frame too).
 *   - `call()` accepts `timeoutMs: null` for calls with no upper bound.
 *     ACP's `session/prompt` resolves only at end of turn — a turn can run
 *     for many minutes and legitimately blocks on a human answering a
 *     `session/request_permission` round trip, so a wall-clock timeout
 *     would fire spuriously mid-turn. Liveness is still guarded: transport
 *     close (process death, stdout end/error) rejects every pending call.
 */

import type { Readable, Writable } from "node:stream";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Default timeout for bounded RPC calls (handshake, session setup, …). */
export const ACP_DEFAULT_RPC_TIMEOUT_MS = 30_000;

export class AcpTransport {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  private requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private connected = true;
  private buffer = "";

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    private readonly logTag = "kimi-acp",
  ) {
    stdout.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString("utf-8");
      this.processBuffer();
    });
    stdout.on("end", () => this.closeTransport());
    stdout.on("error", (err) => {
      console.error(`[${this.logTag}] stdout error:`, err);
      this.closeTransport();
    });
  }

  /**
   * Send a request and await its response. `timeoutMs: null` disables the
   * timer entirely (used for `session/prompt` — see the module docblock);
   * transport close still rejects the call.
   */
  call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number | null = ACP_DEFAULT_RPC_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Transport closed"));
        return;
      }
      if (timeoutMs !== null) {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          this.pendingTimers.delete(id);
          reject(new Error(`ACP timeout: ${method} did not respond within ${timeoutMs}ms`));
        }, timeoutMs);
        this.pendingTimers.set(id, timer);
      }
      this.pending.set(id, { resolve, reject });
      this.writeFrame({ jsonrpc: "2.0", id, method, params }, (err) => {
        if (!err) return;
        const timer = this.pendingTimers.get(id);
        if (timer) clearTimeout(timer);
        this.pendingTimers.delete(id);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  /** Send a fire-and-forget notification (no id, no response expected). */
  notify(method: string, params: Record<string, unknown> = {}): void {
    this.writeFrame({ jsonrpc: "2.0", method, params }, (err) => {
      if (err) console.error(`[${this.logTag}] notify(${method}) write error:`, err);
    });
  }

  /** Answer an agent→client request (e.g. `session/request_permission`). */
  respond(id: number, result: unknown): void {
    this.writeFrame({ jsonrpc: "2.0", id, result }, (err) => {
      if (err) console.error(`[${this.logTag}] respond(id=${id}) write error:`, err);
    });
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }

  onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void {
    this.requestHandler = handler;
  }

  /** Fired once when the transport closes (process/stream death). */
  onClose(handler: () => void): void {
    if (!this.connected) {
      handler();
      return;
    }
    this.closeHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private writeFrame(frame: Record<string, unknown>, onError: (err: Error | null) => void): void {
    if (!this.connected) {
      onError(new Error("Transport closed"));
      return;
    }
    try {
      this.stdin.write(JSON.stringify(frame) + "\n", "utf-8", (err) => {
        onError(err instanceof Error ? err : err ? new Error(String(err)) : null);
      });
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        console.warn(`[${this.logTag}] unparseable frame:`, trimmed.substring(0, 200));
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if ("id" in msg && msg.id !== undefined) {
      if ("method" in msg && msg.method) {
        // Request FROM the agent (its own id space — e.g. permission requests
        // start at id 0 and increment independently of our outbound ids).
        this.requestHandler?.(msg.method, msg.id, (msg as JsonRpcRequest).params ?? {});
        return;
      }
      // Response to one of our requests.
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      const timer = this.pendingTimers.get(msg.id);
      if (timer) {
        clearTimeout(timer);
        this.pendingTimers.delete(msg.id);
      }
      const resp = msg as JsonRpcResponse;
      if (resp.error) {
        pending.reject(new Error(`ACP error ${resp.error.code}: ${resp.error.message}`));
      } else {
        pending.resolve(resp.result);
      }
      return;
    }
    if ("method" in msg) {
      this.notificationHandler?.(msg.method, (msg as JsonRpcNotification).params ?? {});
    }
  }

  private closeTransport(): void {
    if (!this.connected) return;
    this.connected = false;
    const pendingCount = this.pending.size;
    if (pendingCount > 0) {
      console.error(`[${this.logTag}] transport closed with ${pendingCount} pending call(s)`);
    }
    for (const [, timer] of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const [, { reject }] of this.pending) {
      reject(new Error("Transport closed"));
    }
    this.pending.clear();
    const handler = this.closeHandler;
    this.closeHandler = null;
    handler?.();
  }
}
