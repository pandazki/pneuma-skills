/**
 * Codex App-Server Adapter
 *
 * Translates between the Codex app-server JSON-RPC protocol (stdin/stdout)
 * and Pneuma's BrowserIncomingMessage/BrowserOutgoingMessage types.
 *
 * The browser sees the same message types regardless of whether Claude Code
 * or Codex is the backend.
 */

import { randomUUID } from "node:crypto";
import type { Subprocess } from "bun";
import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  SessionState,
  PermissionRequest,
  CLIResultMessage,
  ContentBlock,
} from "../../server/session-types.js";

// ─── Codex JSON-RPC Types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// Codex item types
interface CodexItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

/** Safely extract a string kind from a Codex file change entry. */
function safeKind(kind: unknown): string {
  if (typeof kind === "string") return kind;
  if (kind && typeof kind === "object" && "type" in kind) {
    const t = (kind as Record<string, unknown>).type;
    if (typeof t === "string") return t;
  }
  return "modify";
}

// ─── Transport Interface ─────────────────────────────────────────────────────

/** Abstract transport for Codex JSON-RPC communication. */
export interface ICodexTransport {
  call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  respond(id: number, result: unknown): Promise<void>;
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void;
  onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void;
  isConnected(): boolean;
}

/** Default RPC call timeout in milliseconds. */
const DEFAULT_RPC_TIMEOUT_MS = 60_000;

/** Per-method timeout overrides (ms). */
const RPC_METHOD_TIMEOUTS: Record<string, number> = {
  "turn/start": 120_000,
  "turn/interrupt": 15_000,
  "thread/start": 30_000,
  "thread/resume": 30_000,
};

// ─── Stdio JSON-RPC Transport ────────────────────────────────────────────────

export class StdioTransport implements ICodexTransport {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  private requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  /** Node.js Writable stream for stdin. */
  private nodeStdin: import("node:stream").Writable | null = null;
  /** Fallback WritableStream writer for non-Node stdin (tests). */
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private connected = true;
  private buffer = "";

  /**
   * Constructor for test usage with WritableStream/ReadableStream.
   * Production code should use `StdioTransport.fromNodeStreams()`.
   */
  constructor(
    stdin: WritableStream<Uint8Array> | { write(data: Uint8Array): number },
    stdout: ReadableStream<Uint8Array>,
  ) {
    if ("write" in stdin && typeof stdin.write === "function") {
      const writable = new WritableStream({
        write(chunk) {
          (stdin as { write(data: Uint8Array): number }).write(chunk);
        },
      });
      this.writer = writable.getWriter();
    } else {
      this.writer = (stdin as WritableStream<Uint8Array>).getWriter();
    }
    this.readStdout(stdout);
  }

  /**
   * Create a StdioTransport from Node.js child_process streams.
   * Avoids Bun's ReadableStream bug where proc.stdout prematurely closes.
   */
  static fromNodeStreams(
    stdin: import("node:stream").Writable,
    stdout: import("node:stream").Readable,
  ): StdioTransport {
    const transport = Object.create(StdioTransport.prototype) as StdioTransport;
    transport.nextId = 1;
    transport.pending = new Map();
    transport.pendingTimers = new Map();
    transport.notificationHandler = null;
    transport.requestHandler = null;
    transport.stdinSink = null;
    transport.writer = null;
    transport.nodeStdin = stdin;
    transport.connected = true;
    transport.buffer = "";
    transport.readNodeStdout(stdout);
    return transport;
  }

  private readNodeStdout(stdout: import("node:stream").Readable): void {
    stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      this.processBuffer();
    });
    stdout.on("end", () => {
      console.error(`[codex-adapter] Node stdout stream ended`);
      this.closeTransport();
    });
    stdout.on("error", (err) => {
      console.error(`[codex-adapter] Node stdout error:`, err);
      this.closeTransport();
    });
  }

  private closeTransport(): void {
    if (!this.connected) return;
    const pendingCount = this.pending.size;
    if (pendingCount > 0) {
      console.error(`[codex-adapter] Transport closed with ${pendingCount} pending RPC call(s)`);
    }
    this.connected = false;
    for (const [, timer] of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    for (const [, { reject }] of this.pending) {
      reject(new Error("Transport closed"));
    }
    this.pending.clear();
  }

  /** Read from a web ReadableStream (used by tests; production uses readNodeStdout). */
  private async readStdout(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch (err) {
      console.error("[codex-adapter] stdout reader error:", err);
    } finally {
      this.closeTransport();
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
        console.warn("[codex-adapter] Failed to parse JSON-RPC:", trimmed.substring(0, 200));
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if ("id" in msg && msg.id !== undefined) {
      if ("method" in msg && msg.method) {
        // Request FROM the server (e.g., approval request)
        this.requestHandler?.(msg.method, msg.id as number, (msg as JsonRpcRequest).params || {});
      } else {
        // Response to one of our requests
        const msgId = msg.id as number;
        const pending = this.pending.get(msgId);
        if (pending) {
          this.pending.delete(msgId);
          const timer = this.pendingTimers.get(msgId);
          if (timer) {
            clearTimeout(timer);
            this.pendingTimers.delete(msgId);
          }
          const resp = msg as JsonRpcResponse;
          if (resp.error) {
            pending.reject(new Error(resp.error.message));
          } else {
            pending.resolve(resp.result);
          }
        }
      }
    } else if ("method" in msg) {
      this.notificationHandler?.(msg.method, (msg as JsonRpcNotification).params || {});
    }
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const effectiveTimeout = timeoutMs ?? RPC_METHOD_TIMEOUTS[method] ?? DEFAULT_RPC_TIMEOUT_MS;
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.pendingTimers.delete(id);
        reject(new Error(`RPC timeout: ${method} did not respond within ${effectiveTimeout}ms`));
      }, effectiveTimeout);
      this.pendingTimers.set(id, timer);
      this.pending.set(id, { resolve, reject });
      const request = JSON.stringify({ method, id, params });
      try {
        await this.writeRaw(request + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pendingTimers.delete(id);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const notification = JSON.stringify({ method, params });
    await this.writeRaw(notification + "\n");
  }

  async respond(id: number, result: unknown): Promise<void> {
    const response = JSON.stringify({ id, result });
    await this.writeRaw(response + "\n");
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }

  onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void {
    this.requestHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async writeRaw(data: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Transport closed");
    }
    if (this.nodeStdin) {
      return new Promise<void>((resolve, reject) => {
        this.nodeStdin!.write(data, "utf-8", (err) => {
          if (err) reject(err); else resolve();
        });
      });
    }
    if (this.writer) {
      await this.writer.write(new TextEncoder().encode(data));
    } else {
      throw new Error("No stdin writer available");
    }
  }
}

// ─── Adapter Options ──────────────────────────────────────────────────────────

export interface CodexAdapterOptions {
  model?: string;
  cwd?: string;
  approvalMode?: string;
  sandbox?: "workspace-write" | "danger-full-access";
  /** If provided, resume an existing thread instead of starting a new one. */
  threadId?: string;
  /** Callback to kill the underlying process on disconnect. */
  killProcess?: () => Promise<void> | void;
}

// ─── Codex Adapter ────────────────────────────────────────────────────────────

export class CodexAdapter {
  private transport: ICodexTransport;
  private sessionId: string;
  private options: CodexAdapterOptions;

  private browserMessageCb: ((msg: BrowserIncomingMessage) => void) | null = null;
  private sessionMetaCb: ((meta: { cliSessionId?: string; model?: string; cwd?: string }) => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private initErrorCb: ((error: string) => void) | null = null;

  // State
  private threadId: string | null = null;
  private currentTurnId: string | null = null;
  private connected = false;
  private initialized = false;
  private initFailed = false;
  private initInProgress = false;

  // Streaming accumulator
  private streamingText = "";
  private streamingItemId: string | null = null;

  // Reasoning accumulator
  private reasoningText = "";
  private reasoningItemId: string | null = null;

  // Track command execution for progress indicator
  private commandStartTimes = new Map<string, number>();

  // Track requested runtime permission mode
  private currentPermissionMode: string;

  // Track which item IDs we have already emitted a tool_use block for
  private emittedToolUseIds = new Set<string>();

  // Queue messages received before initialization completes
  private pendingOutgoing: BrowserOutgoingMessage[] = [];

  // Pending approval requests (Codex sends these as JSON-RPC requests with an id)
  private pendingApprovals = new Map<string, number>(); // request_id -> JSON-RPC id
  private pendingReviewDecisions = new Set<string>(); // request_ids that need ReviewDecision format

  // Cumulative session statistics
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeCostUsd = 0;
  private turnCount = 0;
  private totalLinesAdded = 0;
  private totalLinesRemoved = 0;

  // Model reported by Codex (may differ from initial option)
  private activeModel: string;

  constructor(transportOrProc: ICodexTransport | Subprocess, sessionId: string, options: CodexAdapterOptions = {}) {
    this.sessionId = sessionId;
    this.options = options;
    this.currentPermissionMode = options.approvalMode || "default";
    this.activeModel = options.model || "";

    if (this.isTransport(transportOrProc)) {
      this.transport = transportOrProc;
    } else {
      const proc = transportOrProc;
      const stdout = proc.stdout;
      const stdin = proc.stdin;
      if (!stdout || !stdin || typeof stdout === "number" || typeof stdin === "number") {
        throw new Error("Codex process must have stdio pipes");
      }
      this.transport = new StdioTransport(
        stdin as WritableStream<Uint8Array> | { write(data: Uint8Array): number },
        stdout as ReadableStream<Uint8Array>,
      );

      if (!options.killProcess) {
        options.killProcess = async () => {
          try {
            proc.kill("SIGTERM");
            await Promise.race([
              proc.exited,
              new Promise((r) => setTimeout(r, 5000)),
            ]);
          } catch {}
        };
      }

      proc.exited.then(() => {
        this.connected = false;
        this.disconnectCb?.();
      });
    }

    this.transport.onNotification((method, params) => this.handleNotification(method, params));
    this.transport.onRequest((method, id, params) => this.handleRequest(method, id, params));

    // Start initialization
    this.initialize();
  }

  private isTransport(obj: ICodexTransport | Subprocess): obj is ICodexTransport {
    return typeof (obj as ICodexTransport).call === "function"
      && typeof (obj as ICodexTransport).notify === "function"
      && typeof (obj as ICodexTransport).respond === "function"
      && typeof (obj as ICodexTransport).onNotification === "function";
  }

  // ── Public API ──────────────────────────────────────────────────────────

  sendBrowserMessage(msg: BrowserOutgoingMessage): boolean {
    if (this.initFailed) return false;

    // Queue messages if not yet initialized
    if (!this.initialized || !this.threadId || this.initInProgress) {
      if (msg.type === "user_message" || msg.type === "permission_response") {
        console.log(`[codex-adapter] Queuing ${msg.type} — adapter not yet initialized`);
        this.pendingOutgoing.push(msg);
        return true;
      }
      if (!this.connected) return false;
    }

    if (!this.transport.isConnected()) {
      console.warn(`[codex-adapter] Transport disconnected — cannot dispatch ${msg.type}`);
      return false;
    }

    this.flushPendingOutgoing();
    return this.dispatchOutgoing(msg);
  }

  private flushPendingOutgoing(): void {
    if (this.pendingOutgoing.length === 0) return;
    if (!this.transport.isConnected()) return;
    console.log(`[codex-adapter] Flushing ${this.pendingOutgoing.length} queued message(s)`);
    const queued = this.pendingOutgoing.splice(0);
    for (const msg of queued) {
      this.dispatchOutgoing(msg);
    }
  }

  private dispatchOutgoing(msg: BrowserOutgoingMessage): boolean {
    switch (msg.type) {
      case "user_message":
        this.handleOutgoingUserMessage(msg);
        return true;
      case "permission_response":
        this.handleOutgoingPermissionResponse(msg);
        return true;
      case "interrupt":
        this.handleOutgoingInterrupt();
        return true;
      case "set_model":
        this.handleOutgoingSetModel(msg as { type: "set_model"; model: string });
        return true;
      default:
        return false;
    }
  }

  onBrowserMessage(cb: (msg: BrowserIncomingMessage) => void): void {
    this.browserMessageCb = cb;
  }

  onSessionMeta(cb: (meta: { cliSessionId?: string; model?: string; cwd?: string }) => void): void {
    this.sessionMetaCb = cb;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }

  onInitError(cb: (error: string) => void): void {
    this.initErrorCb = cb;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.options.killProcess) {
      try { await this.options.killProcess(); } catch {}
    }
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  // ── Initialization ──────────────────────────────────────────────────────

  private static readonly INIT_THREAD_MAX_RETRIES = 3;
  private static readonly INIT_THREAD_RETRY_BASE_MS = 500;

  private async initialize(): Promise<void> {
    if (this.initInProgress) return;
    this.initInProgress = true;

    try {
      // Step 1: Send initialize request
      const initResult = await this.transport.call("initialize", {
        clientInfo: {
          name: "pneuma-skills",
          title: "Pneuma Skills",
          version: "1.0.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      }) as { serverInfo?: { name?: string; version?: string }; userAgent?: string } | undefined;

      // v0.114+: response has `userAgent` instead of `serverInfo`
      let serverVersion = initResult?.serverInfo?.version || "";
      if (!serverVersion && initResult?.userAgent) {
        // Parse version from userAgent string like "pneuma-skills/0.114.0 (...)"
        const match = initResult.userAgent.match(/\/([\d.]+)/);
        if (match) serverVersion = match[1];
      }

      // Step 2: Send initialized notification
      await this.transport.notify("initialized", {});

      this.connected = true;

      // Step 3: Start or resume a thread with retry
      let threadStarted = false;
      let lastThreadError: unknown;
      let threadResult: { thread: { id: string }; model?: string; model_provider?: string } | undefined;

      for (let attempt = 0; attempt < CodexAdapter.INIT_THREAD_MAX_RETRIES; attempt++) {
        if (!this.transport.isConnected()) {
          lastThreadError = new Error("Transport closed before thread start");
          break;
        }

        try {
          if (this.options.threadId) {
            try {
              threadResult = await this.transport.call("thread/resume", {
                threadId: this.options.threadId,
                model: this.options.model,
                cwd: this.options.cwd || "",
                approvalPolicy: this.mapApprovalPolicy(this.currentPermissionMode),
                sandbox: this.mapSandboxPolicy(this.currentPermissionMode),
              }) as { thread: { id: string }; model?: string; model_provider?: string };
              this.threadId = threadResult.thread.id;
            } catch (resumeErr) {
              // Thread not found (e.g. rollout file cleaned up, version upgrade) — fall back to new thread
              console.warn(`[codex-adapter] thread/resume failed: ${resumeErr}, falling back to thread/start`);
              this.options.threadId = undefined;
              threadResult = await this.transport.call("thread/start", {
                model: this.options.model,
                cwd: this.options.cwd || "",
                approvalPolicy: this.mapApprovalPolicy(this.currentPermissionMode),
                sandbox: this.mapSandboxPolicy(this.currentPermissionMode),
              }) as { thread: { id: string }; model?: string; model_provider?: string };
              this.threadId = threadResult.thread.id;
            }
          } else {
            threadResult = await this.transport.call("thread/start", {
              model: this.options.model,
              cwd: this.options.cwd || "",
              approvalPolicy: this.mapApprovalPolicy(this.currentPermissionMode),
              sandbox: this.mapSandboxPolicy(this.currentPermissionMode),
            }) as { thread: { id: string }; model?: string; model_provider?: string };
            this.threadId = threadResult.thread.id;
          }
          threadStarted = true;
          break;
        } catch (threadErr) {
          lastThreadError = threadErr;
          const isTransportClosed = threadErr instanceof Error && threadErr.message === "Transport closed";
          if (!isTransportClosed || attempt >= CodexAdapter.INIT_THREAD_MAX_RETRIES - 1) {
            break;
          }
          const delay = CodexAdapter.INIT_THREAD_RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`[codex-adapter] thread start attempt ${attempt + 1} failed, retrying in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!threadStarted) {
        throw lastThreadError || new Error("Failed to start thread");
      }

      // Extract model from thread/start response (top-level field per Codex protocol)
      if (threadResult?.model) {
        this.activeModel = threadResult.model;
      }

      this.initialized = true;
      console.log(`[codex-adapter] Session ${this.sessionId} initialized (threadId=${this.threadId})`);

      // Notify session metadata
      this.sessionMetaCb?.({
        cliSessionId: this.threadId ?? undefined,
        model: this.activeModel,
        cwd: this.options.cwd,
      });

      // Send session_init to browser
      const state: Partial<SessionState> = {
        session_id: this.sessionId,
        backend_type: "codex",
        model: this.activeModel,
        cwd: this.options.cwd || "",
        tools: [],
        permissionMode: this.currentPermissionMode,
        agent_version: serverVersion ? `codex ${serverVersion}` : "codex",
        claude_code_version: "",
        mcp_servers: [],
        agents: [],
        slash_commands: [],
        skills: [],
        total_cost_usd: 0,
        num_turns: 0,
        context_used_percent: 0,
        is_compacting: false,
        total_lines_added: 0,
        total_lines_removed: 0,
      };

      this.emit({ type: "session_init", session: state as SessionState });

      // Best-effort: fetch rate limits, model list, skills (non-blocking)
      this.transport.call("account/rateLimits/read", {}).catch(() => {});
      this.fetchAvailableModels();
      this.fetchSkills();

      // Flush queued messages
      this.flushPendingOutgoing();
    } catch (err) {
      const errorMsg = `Codex initialization failed: ${err}`;
      console.error(`[codex-adapter] ${errorMsg}`);
      this.initFailed = true;
      this.connected = false;
      this.pendingOutgoing.length = 0;
      this.emit({ type: "error", message: errorMsg });
      this.initErrorCb?.(errorMsg);
    } finally {
      this.initInProgress = false;
    }
  }

  // ── Outgoing message handlers ───────────────────────────────────────────

  private async handleOutgoingUserMessage(
    msg: { type: "user_message"; content: string; images?: { media_type: string; data: string }[] },
  ): Promise<void> {
    if (!this.threadId) {
      this.emit({ type: "error", message: "No Codex thread started yet" });
      return;
    }

    const input: Array<{ type: string; text?: string; url?: string }> = [];

    if (msg.images?.length) {
      for (const img of msg.images) {
        input.push({
          type: "image",
          url: `data:${img.media_type};base64,${img.data}`,
        });
      }
    }

    input.push({ type: "text", text: msg.content });

    try {
      const turnParams: Record<string, unknown> = {
        threadId: this.threadId,
        input,
        cwd: this.options.cwd || "",
        approvalPolicy: this.mapApprovalPolicy(this.currentPermissionMode),
        sandboxPolicy: this.mapSandboxPolicyObject(this.currentPermissionMode),
        model: this.activeModel || undefined,
      };
      const result = await this.transport.call("turn/start", turnParams) as { turn: { id: string } };
      this.currentTurnId = result.turn.id;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.startsWith("RPC timeout")) {
        this.emit({ type: "error", message: "Codex is not responding. Try relaunching the session." });
      } else if (errMsg === "Transport closed") {
        this.emit({ type: "error", message: "Connection to Codex lost. Try relaunching the session." });
      } else {
        this.emit({ type: "error", message: `Failed to start turn: ${err}` });
      }
    }
  }

  private async handleOutgoingPermissionResponse(
    msg: { type: "permission_response"; request_id: string; behavior: "allow" | "deny" | "allowAlways"; updated_input?: Record<string, unknown> },
  ): Promise<void> {
    const jsonRpcId = this.pendingApprovals.get(msg.request_id);
    if (jsonRpcId === undefined) {
      console.warn(`[codex-adapter] No pending approval for request_id=${msg.request_id}`);
      return;
    }

    this.pendingApprovals.delete(msg.request_id);

    // Review decisions (applyPatchApproval / execCommandApproval) need ReviewDecision
    if (this.pendingReviewDecisions.has(msg.request_id)) {
      this.pendingReviewDecisions.delete(msg.request_id);
      const decision = (msg.behavior === "allow" || msg.behavior === "allowAlways") ? "approved" : "denied";
      await this.transport.respond(jsonRpcId, { decision });
      return;
    }

    // Standard item/*/requestApproval — uses accept/decline
    const decision = (msg.behavior === "allow" || msg.behavior === "allowAlways") ? "accept" : "decline";
    await this.transport.respond(jsonRpcId, { decision });
  }

  private async handleOutgoingInterrupt(): Promise<void> {
    if (!this.threadId || !this.currentTurnId) return;
    try {
      await this.transport.call("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.currentTurnId,
      });
    } catch (err) {
      console.warn("[codex-adapter] Interrupt failed:", err);
    }
  }

  private handleOutgoingSetModel(msg: { type: "set_model"; model: string }): void {
    this.activeModel = msg.model;
    console.log(`[codex-adapter] Model set to ${msg.model} — will apply on next turn`);
    // Codex applies model per-turn via turn/start params, so we just store it.
    // Emit session update so the browser UI reflects the change immediately.
    this.emitSessionUpdate({ model: this.activeModel });
  }

  /** Fetch available models from Codex and send to browser as session update. */
  private async fetchAvailableModels(): Promise<void> {
    try {
      // Codex model/list returns { data: Model[] } where Model has { id, model, displayName, hidden, isDefault, ... }
      const result = await this.transport.call("model/list", {}) as {
        data?: { id: string; model?: string; displayName?: string; hidden?: boolean; isDefault?: boolean }[];
      };
      const models = result?.data || [];
      if (Array.isArray(models) && models.length > 0) {
        const available = models
          .filter((m) => !m.hidden)
          .map((m) => ({ id: m.id, name: m.displayName || m.id }));
        console.log(`[codex-adapter] Available models: ${available.map((m) => `${m.id} (${m.name})`).join(", ")}`);
        this.emitSessionUpdate({ available_models: available });
        // If no active model set yet, use the default
        if (!this.activeModel) {
          const defaultModel = models.find((m) => m.isDefault);
          if (defaultModel) {
            this.activeModel = defaultModel.id;
            this.emitSessionUpdate({ model: defaultModel.id });
          }
        }
      }
    } catch (err) {
      console.warn("[codex-adapter] Failed to fetch model list:", err);
    }
  }

  /** Fetch skills from Codex and expose as slash_commands. */
  private async fetchSkills(): Promise<void> {
    try {
      // Codex skills/list returns { data: [{ cwd, skills: SkillMetadata[], errors }] }
      // where SkillMetadata has { name, description, enabled, path, scope, ... }
      const result = await this.transport.call("skills/list", {
        cwds: [this.options.cwd || ""],
      }) as {
        data?: { cwd: string; skills: { name: string; enabled: boolean; description?: string }[]; errors: unknown[] }[];
      };
      console.log("[codex-adapter] skills/list response:", JSON.stringify(result).slice(0, 500));
      const allSkills = result?.data?.flatMap((entry) => entry.skills) || [];
      const enabledNames = allSkills
        .filter((s) => s.enabled)
        .map((s) => s.name)
        .filter(Boolean);
      if (enabledNames.length > 0) {
        console.log(`[codex-adapter] Skills: ${enabledNames.join(", ")}`);
        this.emitSessionUpdate({ slash_commands: enabledNames, skills: enabledNames });
      }
    } catch (err) {
      console.warn("[codex-adapter] Failed to fetch skills:", err);
    }
  }

  // ── Notification handling (Codex → Browser) ─────────────────────────────

  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "thread/started":
        break; // We already got the thread ID from the RPC response

      case "thread/status/changed": {
        // v0.114+: status is an object { type: "active"|"idle"|"systemError"|"notLoaded", activeFlags?: [] }
        // Legacy: status was a plain string
        const rawStatus = params.status;
        const statusType = typeof rawStatus === "object" && rawStatus !== null
          ? (rawStatus as Record<string, unknown>).type as string
          : rawStatus as string;

        if (statusType === "active" || statusType === "running") {
          this.emit({ type: "status_change", status: "running" });
        } else if (statusType === "idle" || statusType === "completed" || statusType === "notLoaded") {
          this.emit({ type: "status_change", status: "idle" });
        } else if (statusType === "systemError") {
          this.emit({ type: "error", message: "Codex reported a system error" } as BrowserIncomingMessage);
          this.emit({ type: "status_change", status: "idle" });
        }
        // Extract model if reported in status
        if (params.model && typeof params.model === "string") {
          this.activeModel = params.model;
          this.emitSessionUpdate({ model: this.activeModel });
        }
        break;
      }

      case "turn/started":
        this.currentTurnId = params.turnId as string || this.currentTurnId;
        this.emit({ type: "status_change", status: "running" });
        break;

      case "turn/completed": {
        this.flushStreamingText();
        this.flushReasoningText();
        this.currentTurnId = null;
        this.emittedToolUseIds.clear();

        // Update turn count
        this.turnCount++;

        // v0.114+: status is in params.turn.status; legacy: params.status
        const turn = params.turn as { status?: string; error?: { message?: string } } | undefined;
        const status = turn?.status ?? params.status as string ?? "completed";
        // Legacy: params.usage; v0.114+: usage arrives via thread/tokenUsage/updated
        const usage = params.usage as Record<string, number> | undefined;
        if (usage) {
          this.cumulativeInputTokens += usage.inputTokens ?? 0;
          this.cumulativeOutputTokens += usage.outputTokens ?? 0;
        }

        // Surface turn errors
        if (turn?.error?.message) {
          this.emit({ type: "error", message: turn.error.message } as BrowserIncomingMessage);
        }

        // Build a synthetic result message
        const result: CLIResultMessage = {
          type: "result",
          subtype: status === "completed" ? "success" : "error_during_execution",
          is_error: status !== "completed",
          duration_ms: 0,
          duration_api_ms: 0,
          num_turns: this.turnCount,
          total_cost_usd: this.cumulativeCostUsd,
          stop_reason: status,
          usage: {
            input_tokens: usage?.inputTokens ?? 0,
            output_tokens: usage?.outputTokens ?? 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          uuid: randomUUID(),
          session_id: this.sessionId,
        };
        this.emit({ type: "result", data: result });

        // Push cumulative stats to session state
        this.emitSessionUpdate({
          num_turns: this.turnCount,
          total_cost_usd: this.cumulativeCostUsd,
          total_lines_added: this.totalLinesAdded,
          total_lines_removed: this.totalLinesRemoved,
        });

        this.emit({ type: "status_change", status: "idle" });
        break;
      }

      case "item/started":
        this.handleItemStarted(params);
        break;

      case "item/completed":
        this.handleItemCompleted(params);
        break;

      case "item/updated":
        // General item status update — update tool progress if applicable
        this.handleItemUpdated(params);
        break;

      case "item/agentMessage/delta":
        this.handleAgentMessageDelta(params);
        break;

      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
        this.handleCommandOutputDelta(params);
        break;

      // ── Reasoning / thinking ──
      case "item/reasoning/textDelta":
      case "item/reasoning/textSummaryDelta":
      case "item/reasoning/summaryTextDelta":
        this.handleReasoningDelta(params);
        break;

      case "item/reasoning/summaryPartAdded":
        // Part boundary — can ignore for now
        break;

      // ── Token usage ──
      case "thread/tokenUsage/updated":
        this.handleTokenUsageUpdated(params);
        break;

      // ── Rate limits ──
      case "account/rateLimits/updated":
        // Rate limit updates — log but don't block
        break;

      // ── Codex stream events ──
      case "codex/event/stream_error": {
        const msg = params.msg as { message?: string } | undefined;
        if (msg?.message) {
          console.log(`[codex-adapter] Stream error: ${msg.message}`);
          this.emit({ type: "error", message: msg.message } as BrowserIncomingMessage);
        }
        break;
      }

      case "codex/event/error": {
        const msg = params.msg as { message?: string } | undefined;
        if (msg?.message) {
          console.error(`[codex-adapter] Codex error: ${msg.message}`);
          this.emit({ type: "error", message: msg.message } as BrowserIncomingMessage);
        }
        break;
      }

      case "codex/event/mcp_startup_complete":
      case "codex/event/mcp_startup_update":
        // MCP servers loading / finished loading
        break;

      case "codex/event/user_message":
        // Echo of user message — handled already
        break;

      case "error": {
        const message = (params.message as string) || (params.msg as { message?: string })?.message || "Unknown error";
        console.error(`[codex-adapter] Error notification: ${message}`);
        this.emit({ type: "error", message } as BrowserIncomingMessage);
        break;
      }

      // v0.114+: model rerouted — update active model
      case "model/rerouted": {
        const toModel = params.toModel as string | undefined;
        if (toModel) {
          this.activeModel = toModel;
          this.emitSessionUpdate({ model: toModel });
        }
        break;
      }

      // v0.114+: context compacted via notification (not just item)
      case "thread/compacted":
        this.emitSessionUpdate({ is_compacting: false });
        break;

      // v0.114+: hooks, plans, diffs, server request resolved — informational
      case "hook/started":
      case "hook/completed":
      case "turn/diff/updated":
      case "turn/plan/updated":
      case "item/plan/delta":
      case "serverRequest/resolved":
      case "deprecationNotice":
      case "configWarning":
      case "thread/started":
      case "thread/closed":
      case "thread/archived":
      case "thread/unarchived":
      case "thread/name/updated":
      case "skills/changed":
      case "item/mcpToolCall/progress":
        // Known notifications — no action needed
        break;

      default:
        // Silently ignore known event prefixes, log truly unknown ones
        if (!method.startsWith("account/")
          && !method.startsWith("codex/event/")
          && !method.startsWith("rawResponseItem/")
          && !method.startsWith("fuzzyFileSearch/")
          && !method.startsWith("thread/realtime/")
          && !method.startsWith("app/")
          && !method.startsWith("mcpServer/")
          && !method.startsWith("windows")) {
          console.log(`[codex-adapter] Unhandled notification: ${method}`);
        }
        break;
    }
  }

  // ── Request handling (Codex → Browser, expects response) ────────────────

  private handleRequest(method: string, id: number, params: Record<string, unknown>): void {
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval": {
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);
        this.pendingReviewDecisions.add(requestId);

        const isCommand = method === "item/commandExecution/requestApproval";
        const toolName = isCommand ? "Bash" : "Edit";
        const input: Record<string, unknown> = isCommand
          ? { command: params.command ?? "" }
          : { changes: params.changes ?? [] };

        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: toolName,
          input,
          description: isCommand
            ? `Run command: ${params.command}`
            : `File change: ${(params.changes as Array<{ path?: string }>)?.[0]?.path ?? ""}`,
          tool_use_id: (params.itemId as string) || randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      case "item/mcpToolCall/requestApproval": {
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);

        // v0.114+: `server`/`tool`/`arguments`; legacy: `serverName`/`toolName`/`args`
        const serverName = (params.server ?? params.serverName) as string || "";
        const toolName = (params.tool ?? params.toolName) as string || "";
        const toolArgs = (params.arguments ?? params.args) as Record<string, unknown> || {};
        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: `mcp:${serverName}:${toolName}`,
          input: toolArgs,
          description: `MCP tool: ${serverName}/${toolName}`,
          tool_use_id: (params.itemId as string) || randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      case "applyPatchApproval":
      case "execCommandApproval": {
        // Alternative approval format — same handling as above
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);
        this.pendingReviewDecisions.add(requestId);

        const isExec = method === "execCommandApproval";
        const toolName = isExec ? "Bash" : "Edit";
        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: toolName,
          input: isExec ? { command: params.command ?? "" } : { patch: params.patch ?? "" },
          description: isExec
            ? `Run command: ${params.command}`
            : `Apply patch to: ${params.path ?? ""}`,
          tool_use_id: (params.itemId as string) || randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      // v0.114+: permissions approval request
      case "item/permissions/requestApproval": {
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);
        const reason = params.reason as string || "Permission request";
        const permissions = params.permissions as Record<string, unknown> || {};
        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: "Permissions",
          input: permissions,
          description: reason,
          tool_use_id: (params.itemId as string) || randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      // v0.114+: tool requests user input — treat as permission request
      case "item/tool/requestUserInput": {
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);
        const questions = params.questions as Array<{ text?: string }> | undefined;
        const desc = questions?.map((q) => q.text).filter(Boolean).join("; ") || "Tool requests input";
        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: "UserInput",
          input: { questions: questions || [] },
          description: desc,
          tool_use_id: (params.itemId as string) || randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      // v0.114+: MCP server elicitation
      case "mcpServer/elicitation/request": {
        const requestId = randomUUID();
        this.pendingApprovals.set(requestId, id);
        const serverName = params.serverName as string || "";
        const message = params.message as string || "MCP server elicitation";
        const perm: PermissionRequest = {
          request_id: requestId,
          tool_name: `mcp:${serverName}:elicitation`,
          input: params,
          description: message,
          tool_use_id: randomUUID(),
          timestamp: Date.now(),
        };
        this.emit({ type: "permission_request", request: perm });
        break;
      }

      // v0.114+: dynamic tool call — execute client-side
      case "item/tool/call": {
        // We don't support client-side dynamic tools — decline gracefully
        console.log(`[codex-adapter] Dynamic tool call not supported: ${params.tool}`);
        this.transport.respond(id, { error: "Dynamic tools not supported by this client" }).catch(() => {});
        break;
      }

      // Account token refresh — respond silently
      case "account/chatgptAuthTokens/refresh":
        this.transport.respond(id, {}).catch(() => {});
        break;

      default:
        // Unknown request — log and reject to avoid silently approving dangerous operations
        console.warn(`[codex-adapter] Unknown request method: ${method}, rejecting`);
        this.transport.respond(id, { decision: "decline" }).catch(() => {});
        break;
    }
  }

  // ── Item event handlers ─────────────────────────────────────────────────

  private handleItemStarted(params: Record<string, unknown>): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    switch (item.type) {
      case "agentMessage":
        this.flushStreamingText();
        this.streamingItemId = item.id;
        this.streamingText = "";
        break;

      case "commandExecution": {
        this.commandStartTimes.set(item.id, Date.now());
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          const cmd = item.command;
          const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
          this.emitToolUse(toolUseId, "Bash", { command: cmdStr });
        }
        break;
      }

      case "fileChange": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
          const firstPath = changes?.[0]?.path ?? "";
          const firstKind = safeKind(changes?.[0]?.kind);
          this.emitToolUse(toolUseId, "Edit", {
            file_path: firstPath,
            operation: firstKind,
          });
        }
        break;
      }

      case "webSearch": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          this.emitToolUse(toolUseId, "WebSearch", {
            query: item.query || "",
          });
        }
        break;
      }

      case "mcpToolCall": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          // v0.114+: `server`/`tool`/`arguments`; legacy: `serverName`/`toolName`/`args`
          const serverName = (item.server ?? item.serverName) as string || "";
          const toolName = (item.tool ?? item.toolName) as string || "";
          const toolArgs = (item.arguments ?? item.args) as Record<string, unknown> || {};
          this.emitToolUse(toolUseId, `mcp:${serverName}:${toolName}`, { ...toolArgs });
        }
        break;
      }

      case "reasoning":
        this.flushReasoningText();
        this.reasoningItemId = item.id;
        this.reasoningText = "";
        break;

      case "contextCompaction":
        this.emit({ type: "status_change", status: "compacting" });
        this.emitSessionUpdate({ is_compacting: true });
        break;

      case "userMessage":
        // Echo of user message — no action needed
        break;

      default:
        // Silently ignore — new item types added frequently
        break;
    }
  }

  private handleItemCompleted(params: Record<string, unknown>): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    switch (item.type) {
      case "agentMessage":
        this.flushStreamingText();
        break;

      case "commandExecution": {
        const toolUseId = item.id;
        // If we never emitted the tool_use (auto-approved), emit it now
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          const cmd = item.command;
          const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
          this.emitToolUse(toolUseId, "Bash", { command: cmdStr });
        }

        // Emit tool_result with output
        const exitCode = item.exitCode as number | undefined;
        // v0.114+: `aggregatedOutput`; legacy: `output`
        const output = (item.aggregatedOutput ?? item.output) as string | undefined;
        const isError = item.status === "failed" || (exitCode !== undefined && exitCode !== 0);
        const resultText = output
          ? output.substring(0, 2000) + (output.length > 2000 ? "\n…truncated" : "")
          : (isError ? `Command failed (exit code ${exitCode})` : "Command completed successfully");
        this.emitToolResult(toolUseId, resultText, isError);

        this.commandStartTimes.delete(item.id);
        break;
      }

      case "fileChange": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
          const firstPath = changes?.[0]?.path ?? "";
          const firstKind = safeKind(changes?.[0]?.kind);
          this.emitToolUse(toolUseId, "Edit", {
            file_path: firstPath,
            operation: firstKind,
          });
        }

        const isError = item.status === "failed";
        const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
        const summary = changes?.map((c) => `${safeKind(c.kind)} ${c.path}`).join("; ") ?? "File change completed";
        this.emitToolResult(item.id, summary, isError);

        // Track line changes
        if (changes) {
          for (const c of changes) {
            if (c.diff) {
              const lines = c.diff.split("\n");
              for (const line of lines) {
                if (line.startsWith("+") && !line.startsWith("+++")) this.totalLinesAdded++;
                if (line.startsWith("-") && !line.startsWith("---")) this.totalLinesRemoved++;
              }
            }
          }
        }
        break;
      }

      case "webSearch": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          this.emitToolUse(toolUseId, "WebSearch", { query: item.query || "" });
        }
        const output = item.output as string | undefined;
        this.emitToolResult(toolUseId, output || "Search completed", false);
        break;
      }

      case "mcpToolCall": {
        const toolUseId = item.id;
        if (!this.emittedToolUseIds.has(toolUseId)) {
          this.emittedToolUseIds.add(toolUseId);
          // v0.114+: `server`/`tool`; legacy: `serverName`/`toolName`
          const serverName = (item.server ?? item.serverName) as string || "";
          const toolName = (item.tool ?? item.toolName) as string || "";
          this.emitToolUse(toolUseId, `mcp:${serverName}:${toolName}`, {});
        }
        const isError = item.status === "failed";
        // v0.114+: error is { message: string }; result is { content: [...] }
        const errorObj = item.error as { message?: string } | string | undefined;
        const errorStr = typeof errorObj === "string" ? errorObj : errorObj?.message;
        const resultObj = item.result as { content?: unknown[] } | undefined;
        const output = item.output as string || errorStr || (resultObj?.content ? JSON.stringify(resultObj.content) : undefined) || "MCP call completed";
        this.emitToolResult(toolUseId, typeof output === "string" ? output : JSON.stringify(output), isError);
        break;
      }

      case "reasoning":
        this.flushReasoningText();
        break;

      case "contextCompaction":
        this.emit({ type: "status_change", status: "running" });
        this.emitSessionUpdate({ is_compacting: false });
        break;

      case "userMessage":
        // Echo of user message completed — no action needed
        break;

      default:
        // Silently ignore
        break;
    }
  }

  private handleItemUpdated(params: Record<string, unknown>): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    // Update status for long-running tool executions
    if (item.type === "commandExecution" && item.status === "inProgress") {
      const startTime = this.commandStartTimes.get(item.id);
      if (startTime) {
        const elapsed = Date.now() - startTime;
        this.emit({
          type: "tool_progress",
          tool_use_id: item.id,
          progress: `Running... (${Math.round(elapsed / 1000)}s)`,
        } as BrowserIncomingMessage);
      }
    }
  }

  private handleAgentMessageDelta(params: Record<string, unknown>): void {
    const delta = params.delta as string;
    if (!delta) return;

    this.streamingText += delta;

    // Emit streaming event for real-time updates
    this.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: delta },
      },
      parent_tool_use_id: null,
    });
  }

  private handleCommandOutputDelta(params: Record<string, unknown>): void {
    const itemId = params.itemId as string;
    const delta = params.delta as string;
    if (!itemId || !delta) return;

    // Emit as tool progress so the UI shows live command output
    this.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: delta },
      },
      parent_tool_use_id: itemId,
    });
  }

  private handleReasoningDelta(params: Record<string, unknown>): void {
    const delta = (params.delta as string) || (params.text as string) || "";
    if (!delta) return;

    this.reasoningText += delta;

    // Emit as thinking/reasoning stream event
    this.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: delta },
      },
      parent_tool_use_id: null,
    });
  }

  private handleTokenUsageUpdated(params: Record<string, unknown>): void {
    // v0.114+: params.tokenUsage = { total: { totalTokens, inputTokens, ... }, last: {...}, modelContextWindow }
    // Legacy: flat params.inputTokens, params.outputTokens, etc.
    const tokenUsage = params.tokenUsage as {
      total?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningOutputTokens?: number };
      last?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
      modelContextWindow?: number | null;
    } | undefined;

    let inputTokens: number;
    let outputTokens: number;
    let modelContextWindow: number;
    let costUsd: number;
    let model: string | undefined;

    if (tokenUsage?.total) {
      // v0.114+ format
      inputTokens = tokenUsage.total.inputTokens ?? 0;
      outputTokens = tokenUsage.total.outputTokens ?? 0;
      modelContextWindow = tokenUsage.modelContextWindow ?? 128_000;
      costUsd = (params.costUsd as number) || 0;
      model = params.model as string | undefined;

      // Update cumulative counters from total
      this.cumulativeInputTokens = inputTokens;
      this.cumulativeOutputTokens = outputTokens;
    } else {
      // Legacy flat format
      inputTokens = (params.inputTokens as number) || 0;
      outputTokens = (params.outputTokens as number) || 0;
      modelContextWindow = (params.modelContextWindow as number) || 128_000;
      costUsd = (params.costUsd as number) || 0;
      model = params.model as string | undefined;
    }

    // Update cumulative cost if provided
    if (costUsd > 0) {
      this.cumulativeCostUsd = costUsd;
    }

    // Update active model if reported
    if (model && model !== this.activeModel) {
      this.activeModel = model;
    }

    const contextPercent = Math.round(((inputTokens + outputTokens) / modelContextWindow) * 100);

    this.emitSessionUpdate({
      model: this.activeModel,
      context_used_percent: contextPercent,
      total_cost_usd: this.cumulativeCostUsd,
    });
  }

  // ── Helper methods ──────────────────────────────────────────────────────

  private emit(msg: BrowserIncomingMessage): void {
    if (!this.browserMessageCb) return;
    this.browserMessageCb(msg);
  }

  private emitSessionUpdate(fields: Partial<SessionState>): void {
    this.emit({
      type: "session_update",
      session: fields,
    } as BrowserIncomingMessage);
  }

  private flushStreamingText(): void {
    if (!this.streamingText || !this.streamingItemId) return;

    const content: ContentBlock[] = [{ type: "text", text: this.streamingText }];
    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: this.streamingItemId,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    };

    this.emit(assistantMsg);
    this.streamingText = "";
    this.streamingItemId = null;
  }

  private flushReasoningText(): void {
    if (!this.reasoningText || !this.reasoningItemId) return;

    // Emit reasoning as a thinking content block in an assistant message
    const content: ContentBlock[] = [
      { type: "thinking", thinking: this.reasoningText } as ContentBlock,
    ];
    this.emit({
      type: "assistant",
      message: {
        id: `reasoning-${this.reasoningItemId}`,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    });

    this.reasoningText = "";
    this.reasoningItemId = null;
  }

  private emitToolUse(toolUseId: string, toolName: string, input: Record<string, unknown>): void {
    const content: ContentBlock[] = [
      { type: "tool_use", id: toolUseId, name: toolName, input },
    ];
    this.emit({
      type: "assistant",
      message: {
        id: `msg-${toolUseId}`,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    });
  }

  private emitToolResult(toolUseId: string, resultText: string, isError: boolean): void {
    const content: ContentBlock[] = [
      { type: "tool_result", tool_use_id: toolUseId, content: resultText, is_error: isError },
    ];
    this.emit({
      type: "assistant",
      message: {
        id: `result-${toolUseId}`,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now(),
    });
  }

  // ── Policy mapping ──────────────────────────────────────────────────────

  private mapApprovalPolicy(mode: string): string {
    switch (mode) {
      case "bypassPermissions":
        return "never";
      default:
        return "unless-allow-listed";
    }
  }

  private mapSandboxPolicy(mode: string): string {
    if (mode === "bypassPermissions") return "danger-full-access";
    return this.options.sandbox || "workspace-write";
  }

  /** Map to SandboxPolicy object for turn/start (uses camelCase values). */
  private mapSandboxPolicyObject(mode: string): Record<string, unknown> {
    if (mode === "bypassPermissions") return { type: "dangerFullAccess" };
    // Map kebab-case to camelCase for the turn/start sandboxPolicy field
    const kebab = this.options.sandbox || "workspace-write";
    const camelMap: Record<string, string> = {
      "danger-full-access": "dangerFullAccess",
      "workspace-write": "workspaceWrite",
      "read-only": "readOnly",
    };
    return { type: camelMap[kebab] || "workspaceWrite" };
  }
}
