/**
 * FakeAcpServer — an in-process stand-in for `kimi acp` used by adapter and
 * bridge tests. Speaks line-delimited JSON-RPC 2.0 over a Node stream pair,
 * with canned handshake responses whose payloads are lifted from frames
 * captured against the real Kimi Code CLI 0.26.0.
 *
 * The adapter writes to `stdin` (we parse + auto-respond) and reads from
 * `stdout` (we push frames). Tests drive the agent side: resolve prompts,
 * emit `session/update` notifications, issue `session/request_permission`
 * requests, and assert on the exact frames the adapter wrote.
 */

import { Readable, Writable } from "node:stream";

export interface RecordedFrame {
  method?: string;
  id?: number;
  params?: Record<string, unknown>;
  result?: unknown;
  raw: Record<string, unknown>;
}

export const FAKE_SESSION_ID = "session_11111111-2222-3333-4444-555555555555";

/** Captured `initialize` result (Kimi Code CLI 0.26.0, trimmed). */
export const FAKE_INITIALIZE_RESULT = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: { image: true, audio: false, embeddedContext: true },
    mcpCapabilities: { http: true, sse: true },
    sessionCapabilities: { list: {}, resume: {} },
  },
  authMethods: [],
  agentInfo: { name: "Kimi Code CLI", version: "0.26.0" },
};

/** Captured `session/new` configOptions (trimmed to the model + mode entries). */
export const FAKE_CONFIG_OPTIONS = [
  {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "kimi-code/k3",
    options: [
      { value: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
      { value: "kimi-code/k3", name: "K3" },
    ],
  },
  {
    type: "select",
    id: "mode",
    name: "Mode",
    category: "mode",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
      { value: "auto", name: "Auto" },
      { value: "yolo", name: "YOLO" },
    ],
  },
];

export interface FakeAcpServerOptions {
  /** Reject `session/resume` calls (simulates a lost session). */
  failResume?: boolean;
}

export class FakeAcpServer {
  readonly stdin: Writable;
  readonly stdout: Readable;

  /** Every frame the adapter wrote, in order. */
  readonly frames: RecordedFrame[] = [];

  /** Pending `session/prompt` ids awaiting `resolvePrompt()`. */
  private pendingPromptIds: number[] = [];
  private nextAgentRequestId = 0;
  private buffer = "";
  private waiters: Array<{
    predicate: (f: RecordedFrame) => boolean;
    resolve: (f: RecordedFrame) => void;
  }> = [];

  constructor(private readonly opts: FakeAcpServerOptions = {}) {
    this.stdout = new Readable({ read() {} });
    this.stdin = new Writable({
      write: (chunk, _enc, cb) => {
        this.buffer += chunk.toString("utf-8");
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 1);
          if (line.trim()) this.onFrame(JSON.parse(line));
        }
        cb();
      },
    });
  }

  // ── Test-facing controls ───────────────────────────────────────────────────

  /** Wait for a frame matching `predicate` (already-recorded frames count). */
  waitForFrame(
    predicate: (f: RecordedFrame) => boolean,
    timeoutMs = 2_000,
    description = "frame",
  ): Promise<RecordedFrame> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolveOnce);
        const seen = this.frames.map((f) => f.method ?? `resp:${f.id}`).join(", ");
        reject(new Error(`Timed out waiting for ${description}. Saw: [${seen}]`));
      }, timeoutMs);
      const resolveOnce = (f: RecordedFrame) => {
        clearTimeout(timer);
        resolve(f);
      };
      this.waiters.push({ predicate, resolve: resolveOnce });
    });
  }

  waitForMethod(method: string, timeoutMs = 2_000): Promise<RecordedFrame> {
    return this.waitForFrame((f) => f.method === method, timeoutMs, `method ${method}`);
  }

  /** Push a `session/update` notification to the adapter. */
  emitUpdate(update: Record<string, unknown>): void {
    this.push({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: FAKE_SESSION_ID, update },
    });
  }

  /**
   * Issue a `session/request_permission` request (agent's own id space,
   * starting at 0 like the real binary). Returns the RPC id used.
   */
  requestPermission(toolCall: { toolCallId: string; title: string; content?: unknown[] }): number {
    const id = this.nextAgentRequestId++;
    this.push({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId: FAKE_SESSION_ID,
        options: [
          { optionId: "approve_once", name: "Approve once", kind: "allow_once" },
          { optionId: "approve_always", name: "Approve for this session", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
        toolCall,
      },
    });
    return id;
  }

  /** Resolve the oldest pending `session/prompt` with the given stop reason. */
  resolvePrompt(stopReason = "end_turn"): void {
    const id = this.pendingPromptIds.shift();
    if (id === undefined) throw new Error("resolvePrompt: no pending session/prompt");
    this.push({ jsonrpc: "2.0", id, result: { stopReason } });
  }

  get pendingPromptCount(): number {
    return this.pendingPromptIds.length;
  }

  /** Simulate process death (stdout closes → transport closes). */
  close(): void {
    this.stdout.push(null);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private push(frame: Record<string, unknown>): void {
    this.stdout.push(JSON.stringify(frame) + "\n");
  }

  private onFrame(raw: Record<string, unknown>): void {
    const frame: RecordedFrame = {
      method: raw.method as string | undefined,
      id: raw.id as number | undefined,
      params: raw.params as Record<string, unknown> | undefined,
      result: raw.result,
      raw,
    };
    this.frames.push(frame);
    const stillWaiting: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (w.predicate(frame)) w.resolve(frame);
      else stillWaiting.push(w);
    }
    this.waiters = stillWaiting;

    // Canned agent behaviour for adapter-originated requests.
    if (frame.method === "initialize" && frame.id !== undefined) {
      this.push({ jsonrpc: "2.0", id: frame.id, result: FAKE_INITIALIZE_RESULT });
    } else if (frame.method === "session/new" && frame.id !== undefined) {
      this.push({
        jsonrpc: "2.0",
        id: frame.id,
        result: { sessionId: FAKE_SESSION_ID, configOptions: FAKE_CONFIG_OPTIONS },
      });
    } else if (frame.method === "session/resume" && frame.id !== undefined) {
      if (this.opts.failResume) {
        this.push({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32602, message: "session not found" },
        });
      } else {
        this.push({ jsonrpc: "2.0", id: frame.id, result: { configOptions: FAKE_CONFIG_OPTIONS } });
      }
    } else if (frame.method === "session/set_model" && frame.id !== undefined) {
      this.push({ jsonrpc: "2.0", id: frame.id, result: {} });
    } else if (frame.method === "session/set_mode" && frame.id !== undefined) {
      this.push({ jsonrpc: "2.0", id: frame.id, result: {} });
    } else if (frame.method === "session/prompt" && frame.id !== undefined) {
      // Held open until the test resolves the turn.
      this.pendingPromptIds.push(frame.id);
    }
    // Notifications (session/cancel) and responses to agent requests are
    // recorded only — tests assert on them explicitly.
  }
}

/** Yield to the event loop so stream callbacks settle. */
export function tick(times = 4): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}
