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
  SubagentInfo,
  SubagentStatus,
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

/** One scope's token counts, as carried by `thread/tokenUsage/updated`. */
interface CodexTokenCounts {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

/** Assumed window when codex reports none (older builds, unknown models). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * How much of the context window one request occupies. Codex's `totalTokens`
 * is that request's input plus output; the sum is the fallback for shapes that
 * omit it.
 */
function occupiedTokens(counts: CodexTokenCounts): number {
  return counts.totalTokens ?? (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0);
}

/**
 * Clamped, so a readout can never claim more of the window than exists. The
 * clamp is a backstop rather than the fix — it holds even if a future codex
 * release reshapes the notification again.
 */
function contextPercent(tokens: number, contextWindow: number): number {
  if (!(contextWindow > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((tokens / contextWindow) * 100)));
}

// ─── Threads and the subagent roster ─────────────────────────────────────────

/**
 * Everything the adapter accumulates for one Codex thread.
 *
 * Codex stamps every `item/*`, `turn/*`, delta, token-usage, status and
 * approval payload with the `threadId` that produced it, and a subagent runs
 * on its own thread over the same transport (`codex app-server --enable
 * multi_agent`). Keeping this state per thread is what stops a child's text
 * from landing in the root's streaming buffer and a child's `turn/completed`
 * from ending the root turn.
 */
interface ThreadState {
  threadId: string;
  /**
   * Attribution key stamped as `parent_tool_use_id` on every envelope
   * synthesized for this thread — `null` for the main thread (see
   * `SubagentInfo.id`). Fixed the first time the thread is seen, never
   * rewritten, because it is already on the wire by then.
   */
  anchorId: string | null;
  currentTurnId: string | null;
  streamingText: string;
  streamingItemId: string | null;
  reasoningText: string;
  reasoningItemId: string | null;
  /** Codex **item** ids a `tool_use` block was already emitted for. */
  emittedToolUseIds: Set<string>;
  /**
   * Codex `collabAgentToolCall` **item** id → the block id its card was
   * emitted with. A collab card's id is not always the item id (a spawn card
   * carries the spawned agent's anchor), and the two sightings of one item
   * (`item/started`, `item/completed`) do not know the same things — without
   * this memo the `tool_result` could name an id no `tool_use` ever had.
   */
  collabCardIds: Map<string, string>;
  commandStartTimes: Map<string, number>;
}

function createThreadState(threadId: string, anchorId: string | null): ThreadState {
  return {
    threadId,
    anchorId,
    currentTurnId: null,
    streamingText: "",
    streamingItemId: null,
    reasoningText: "",
    reasoningItemId: null,
    emittedToolUseIds: new Set<string>(),
    collabCardIds: new Map<string, string>(),
    commandStartTimes: new Map<string, number>(),
  };
}

/** One roster entry, keyed by the agent's own Codex thread id. */
interface SubagentRecord {
  threadId: string;
  /** See `ThreadState.anchorId`; for a subagent this is never null. */
  anchorId: string;
  /** Thread that spawned this one; the main thread id (or null) for a top-level agent. */
  parentThreadId: string | null;
  label: string;
  /** Set once `label` came from an `agentPath`, so a nickname cannot overwrite it. */
  labelFromPath: boolean;
  agentPath?: string;
  role?: string;
  detail?: string;
  status: SubagentStatus;
  model?: string;
  contextPercent?: number;
}

/** What a notification told us about an agent. Absent fields leave the record alone. */
interface SubagentSeed {
  /** Only a `spawnAgent` item may propose an anchor; first sight still wins. */
  anchorId?: string;
  parentThreadId?: string | null;
  agentPath?: string;
  /** `thread.agentNickname` — a weaker label source than `agentPath`. */
  nickname?: string;
  role?: string;
  /** Overwrites `detail` (error text, collab message). */
  detail?: string;
  model?: string;
}

/**
 * `collabAgentToolCall.tool` → the tool name the chat renders. Codex calls the
 * blocking wait `wait`, which says nothing on a card next to `spawn_agent`, so
 * it becomes `wait_agent`; the rest is the snake_case of the wire name.
 */
const COLLAB_TOOL_NAMES: Record<string, string> = {
  spawnAgent: "spawn_agent",
  sendInput: "send_input",
  wait: "wait_agent",
  closeAgent: "close_agent",
  resumeAgent: "resume_agent",
  sendMessage: "send_message",
  followupTask: "followup_task",
  interruptAgent: "interrupt_agent",
  listAgents: "list_agents",
};

/** How much of a collab prompt the tool card carries. */
const COLLAB_PROMPT_PREVIEW_CHARS = 400;

function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function collabToolName(tool: string): string {
  if (!tool) return "collab_agent_tool_call";
  return COLLAB_TOOL_NAMES[tool] ?? camelToSnake(tool);
}

/** `collabAgentToolCall.agentsStates[threadId].status` → roster status. */
function mapAgentStateStatus(status: unknown): SubagentStatus | undefined {
  switch (status) {
    case "pendingInit":
    case "running":
      return "running";
    case "completed":
    case "shutdown":
      return "completed";
    case "errored":
    case "notFound":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return undefined;
  }
}

/** `subAgentActivity.kind` → roster status. */
function mapActivityKind(kind: unknown): SubagentStatus | undefined {
  switch (kind) {
    case "started":
    case "interacted":
      return "running";
    case "interrupted":
      return "interrupted";
    case "completed":
      return "completed";
    default:
      return undefined;
  }
}

/** A child thread's `turn.status` → roster status. `turn/completed` is terminal. */
function mapChildTurnStatus(status: string | undefined): SubagentStatus {
  switch (status) {
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "completed";
  }
}

/**
 * The thread a payload names, or null when it names none.
 *
 * Codex stamps `threadId` on every notification that has a thread; the legacy
 * `execCommandApproval` / `applyPatchApproval` requests call the same value
 * `conversationId`.
 */
function threadIdOf(params: Record<string, unknown>): string | null {
  if (typeof params.threadId === "string" && params.threadId) return params.threadId;
  if (typeof params.conversationId === "string" && params.conversationId) return params.conversationId;
  return null;
}

/** Basename of a Codex `agentPath`, tolerating either separator and a trailing one. */
function basenameOf(agentPath: string): string {
  const trimmed = agentPath.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
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
  /** Register a handler fired once when the underlying transport closes (process/stream death). */
  onClose?(handler: () => void): void;
  isConnected(): boolean;
}

/** Default RPC call timeout in milliseconds. */
const DEFAULT_RPC_TIMEOUT_MS = 60_000;

/** Per-method timeout overrides (ms). */
const RPC_METHOD_TIMEOUTS: Record<string, number> = {
  "turn/start": 120_000,
  "turn/interrupt": 15_000,
  "turn/steer": 15_000,
  "thread/start": 30_000,
  "thread/resume": 30_000,
};

/**
 * Slash commands the adapter answers itself. Codex `app-server` has no
 * slash-command surface — the TUI owns those — so a browser `/compact` must
 * be translated into the native `thread/compact/start` RPC rather than handed
 * to the model as prose. Advertised in `slash_commands` so the composer's menu
 * lists it next to the skills `skills/list` returns.
 */
const CODEX_BUILTIN_SLASH_COMMANDS: readonly string[] = ["compact"];

/**
 * Bare `/compact`, whitespace tolerated. `/compact <note>` stays prose on
 * purpose: the RPC takes no focus instructions, and silently dropping the
 * note would be worse than the model reading it.
 */
const COMPACT_COMMAND_PATTERN = /^\s*\/compact\s*$/i;

/**
 * `error` notification payloads. v2 (0.114+) nests the text:
 * `{ threadId, turnId, error: { message, codexErrorInfo, additionalDetails }, willRetry }`;
 * legacy servers carried `message` (or `msg.message`) at the top level.
 * Reading only the legacy fields is what rendered every modern error as
 * "Unknown error" in the chat.
 */
export function describeErrorNotification(
  params: Record<string, unknown>,
): { message: string; willRetry: boolean; details?: string } {
  const nested = params.error as { message?: unknown; additionalDetails?: unknown } | undefined;
  const legacy = params.msg as { message?: unknown } | undefined;
  const text = [nested?.message, params.message, legacy?.message]
    .find((c): c is string => typeof c === "string" && c.trim().length > 0);
  const details = typeof nested?.additionalDetails === "string" && nested.additionalDetails.trim().length > 0
    ? nested.additionalDetails
    : undefined;
  return {
    message: text ?? `Codex reported an error without a message: ${JSON.stringify(params).slice(0, 200)}`,
    willRetry: params.willRetry === true,
    ...(details ? { details } : {}),
  };
}

// ─── Stdio JSON-RPC Transport ────────────────────────────────────────────────

export class StdioTransport implements ICodexTransport {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  private requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  /** Handler fired once when the transport closes (stdout end/error). */
  private closeHandler: (() => void) | null = null;
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
    transport.closeHandler = null;
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
    const handler = this.closeHandler;
    this.closeHandler = null;
    handler?.();
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
  /** The main thread — the one `thread/start` / `thread/resume` answered with. */
  private threadId: string | null = null;
  private connected = false;

  /**
   * Per-thread streaming / turn / tool state. The main thread's record is the
   * one with `anchorId === null`; it is created up front and keyed into the
   * map as soon as `thread/start` (or `thread/resume`) answers. Child records
   * are created on first sight of their thread id, from any source.
   */
  private readonly mainThread: ThreadState = createThreadState("", null);
  private readonly threads = new Map<string, ThreadState>();

  /**
   * Notifications that named a thread before `thread/start` / `thread/resume`
   * answered, in arrival order.
   *
   * Until the main thread id is known an explicit `threadId` cannot be
   * attributed: it is either the thread being started or a child of it, and
   * guessing "root" is exactly the issue #152 defect on the resume path — a
   * replayed child `turn/completed` would synthesize a root `result`. The
   * window is real rather than theoretical: the RPC response and the
   * following notifications share one stdout chunk, and `processBuffer`
   * dispatches the rest of that chunk synchronously while the continuation
   * that adopts the thread is still a queued microtask. `adoptMainThread`
   * drains this in order; a failed initialization discards it.
   */
  private readonly preAdoptionNotifications: { method: string; params: Record<string, unknown> }[] = [];

  /** Roster of spawned agents, keyed by their Codex thread id. */
  private readonly subagents = new Map<string, SubagentRecord>();
  /** Last broadcast `SubagentInfo` per agent, so a snapshot only goes out when it changed. */
  private readonly lastSubagentSnapshots = new Map<string, string>();

  // Context compaction bookkeeping. `manualCompactRequested` is set when a
  // browser `/compact` was translated into `thread/compact/start`, so the
  // boundary echo can say whether the user or Codex triggered it.
  // `compactionEchoed` dedupes that echo: v0.114+ reports one compaction as
  // both a `contextCompaction` item and a `thread/compacted` notification.
  private manualCompactRequested = false;
  private compactionEchoed = false;
  // Occupancy of the most recent request, from `thread/tokenUsage/updated`.
  private lastContextTokens = 0;
  // Snapshot of `lastContextTokens` taken when a compaction starts. Codex
  // 0.154 (probed live) emits a `thread/tokenUsage/updated` INSIDE the
  // compaction turn, before `item/completed`, and that update already reports
  // the post-compaction occupancy — so `pre_tokens` has to be captured at
  // `item/started`, not read at the boundary.
  private compactionPreTokens = 0;
  private initialized = false;
  private initFailed = false;
  private initInProgress = false;

  // Track requested runtime permission mode
  private currentPermissionMode: string;

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
      // Production path: the transport (StdioTransport.fromNodeStreams) owns process
      // lifetime. Wire its close signal to disconnectCb so process/stream death
      // propagates to CodexBridge (cli_disconnected) and the launcher (state=exited),
      // mirroring the Subprocess branch below and the Kimi adapter.
      this.transport.onClose?.(() => {
        this.connected = false;
        this.disconnectCb?.();
      });
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

  canSteer(): boolean {
    return this.connected
      && this.transport.isConnected()
      && this.threadId !== null
      && this.mainThread.currentTurnId !== null;
  }

  /** Append input to the active Codex turn via the native app-server RPC. */
  async steerUserMessage(
    content: string,
    images?: { media_type: string; data: string }[],
  ): Promise<void> {
    if (!this.canSteer() || !this.threadId || !this.mainThread.currentTurnId) {
      throw new Error("No active Codex turn to steer");
    }

    await this.transport.call("turn/steer", {
      threadId: this.threadId,
      input: this.buildTurnInput(content, images),
      expectedTurnId: this.mainThread.currentTurnId,
    });
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
              this.adoptMainThread(threadResult.thread.id);
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
              this.adoptMainThread(threadResult.thread.id);
            }
          } else {
            threadResult = await this.transport.call("thread/start", {
              model: this.options.model,
              cwd: this.options.cwd || "",
              approvalPolicy: this.mapApprovalPolicy(this.currentPermissionMode),
              sandbox: this.mapSandboxPolicy(this.currentPermissionMode),
            }) as { thread: { id: string }; model?: string; model_provider?: string };
            this.adoptMainThread(threadResult.thread.id);
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
        slash_commands: [...CODEX_BUILTIN_SLASH_COMMANDS],
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
      // No thread will ever be adopted, so nothing can attribute these.
      this.preAdoptionNotifications.length = 0;
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

    if (COMPACT_COMMAND_PATTERN.test(msg.content) && !msg.images?.length) {
      await this.startCompaction(this.threadId);
      return;
    }

    const input = this.buildTurnInput(msg.content, msg.images);

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
      this.mainThread.currentTurnId = result.turn.id;
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

  /**
   * Browser `/compact` → `thread/compact/start`. Codex runs the compaction as
   * a turn of its own (`turn/started` → `contextCompaction` item started /
   * completed → `turn/completed`; some builds add `thread/compacted`), so the
   * ordinary lifecycle handlers carry it through and nothing here waits on
   * the outcome. A
   * rejected RPC — servers before the method existed, a closed transport —
   * unwinds the browser's optimistic turn state with the same error `result`
   * a failed turn ends with.
   */
  private async startCompaction(threadId: string): Promise<void> {
    this.manualCompactRequested = true;
    this.compactionEchoed = false;
    this.compactionPreTokens = this.lastContextTokens;
    try {
      await this.transport.call("thread/compact/start", { threadId });
    } catch (err) {
      this.manualCompactRequested = false;
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`[codex-adapter] thread/compact/start failed: ${detail}`);
      this.emit({ type: "error", message: `Failed to compact context: ${detail}` } as BrowserIncomingMessage);
      this.emit({ type: "result", data: this.buildResultEnvelope("error_during_execution") });
      this.emit({ type: "status_change", status: "idle" });
    }
  }

  /**
   * The protocol-level trace of a compaction — the same `system_event` the
   * Claude bridge forwards from `system.compact_boundary`, so the chat draws
   * one marker for every backend. `pre_tokens` is the occupancy captured
   * when the compaction started. The context gauge is deliberately NOT
   * reset here: Codex reports the real post-compaction occupancy through
   * `thread/tokenUsage/updated` on its own (0.154: inside the compaction
   * turn, before this fires), and a forced 0 would overwrite that reading.
   */
  private emitCompactBoundary(): void {
    if (this.compactionEchoed) return;
    this.compactionEchoed = true;
    const trigger = this.manualCompactRequested ? "manual" : "auto";
    const preTokens = this.compactionPreTokens;
    this.manualCompactRequested = false;
    this.compactionPreTokens = 0;
    this.emit({
      type: "system_event",
      event: {
        subtype: "compact_boundary",
        compact_metadata: { trigger, pre_tokens: preTokens },
        uuid: randomUUID(),
        session_id: this.sessionId,
      },
      timestamp: Date.now(),
    });
    this.emitSessionUpdate({ is_compacting: false });
  }

  /** The synthetic `result` a Codex turn ends with; Codex has no native equivalent. */
  private buildResultEnvelope(
    status: string,
    usage?: Record<string, number>,
  ): CLIResultMessage {
    return {
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
  }

  private buildTurnInput(
    content: string,
    images?: { media_type: string; data: string }[],
  ): Array<{ type: string; text?: string; url?: string }> {
    const input: Array<{ type: string; text?: string; url?: string }> = [];
    for (const image of images ?? []) {
      input.push({
        type: "image",
        url: `data:${image.media_type};base64,${image.data}`,
      });
    }
    input.push({ type: "text", text: content });
    return input;
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
    if (!this.threadId || !this.mainThread.currentTurnId) return;
    try {
      await this.transport.call("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.mainThread.currentTurnId,
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
        this.emitSessionUpdate({
          slash_commands: [...CODEX_BUILTIN_SLASH_COMMANDS, ...enabledNames],
          skills: enabledNames,
        });
      }
    } catch (err) {
      console.warn("[codex-adapter] Failed to fetch skills:", err);
    }
  }

  // ── Threads and the subagent roster ─────────────────────────────────────

  /** Adopt the id `thread/start` / `thread/resume` answered with as the main thread. */
  private adoptMainThread(threadId: string): void {
    this.threadId = threadId;
    this.mainThread.threadId = threadId;
    this.threads.set(threadId, this.mainThread);
    // Anything that named a thread before this moment can be attributed now.
    // Drained in arrival order, and re-entrant only downwards: `threadId` is
    // set, so `handleNotification` no longer queues.
    const queued = this.preAdoptionNotifications.splice(0);
    for (const notification of queued) {
      this.handleNotification(notification.method, notification.params);
    }
  }

  /**
   * The thread a notification (or approval request) belongs to.
   *
   * Absence of a thread field means the server predates it, and such a server
   * has no second thread — so it is the main thread, not an unknown child. An
   * unknown non-main thread is registered on the spot (anchor rule source 4)
   * rather than dropped.
   *
   * A named thread arriving before the main id is known is unattributable;
   * notifications take the `preAdoptionNotifications` queue instead of this
   * path. Approval **requests** cannot be queued — Codex blocks on the
   * response — and there is no turn to approve that early, so they fall back
   * to the root here.
   */
  private resolveThread(params: Record<string, unknown>): ThreadState {
    const raw = threadIdOf(params);
    if (!raw) return this.mainThread;
    if (this.threadId === null || raw === this.threadId) return this.mainThread;
    const known = this.threads.get(raw);
    if (known) return known;
    this.ensureSubagent(raw, {});
    return this.threads.get(raw) ?? this.mainThread;
  }

  /**
   * Get-or-create the roster entry (and the `ThreadState`) for a child thread,
   * refining what we know about it.
   *
   * **The anchor is fixed the first time the thread is seen and never
   * rewritten**: it is already on the wire as `parent_tool_use_id` by the time
   * a later source could disagree. Only a `spawnAgent` item may propose one;
   * every other first sight falls back to `thread:<threadId>`.
   */
  private ensureSubagent(threadId: string, seed: SubagentSeed): SubagentRecord {
    let record = this.subagents.get(threadId);
    const created = !record;
    if (!record) {
      record = {
        threadId,
        anchorId: seed.anchorId ?? `thread:${threadId}`,
        parentThreadId: seed.parentThreadId ?? this.threadId,
        label: "",
        labelFromPath: false,
        status: "running",
      };
      this.subagents.set(threadId, record);
      if (!this.threads.has(threadId)) {
        this.threads.set(threadId, createThreadState(threadId, record.anchorId));
      }
      this.registerAncestor(record.parentThreadId, threadId);
    } else if (seed.parentThreadId && seed.parentThreadId !== record.parentThreadId) {
      // `parent_id` is roster display, not the wire key: a fallback
      // registration guesses the main thread, and the spawn item that later
      // names the real sender is allowed to correct it (nested agents).
      record.parentThreadId = seed.parentThreadId;
      this.registerAncestor(record.parentThreadId, threadId);
    }

    if (seed.agentPath) {
      record.agentPath = seed.agentPath;
      const label = basenameOf(seed.agentPath);
      if (label) {
        record.label = label;
        record.labelFromPath = true;
      }
    }
    if (seed.nickname && !record.labelFromPath) record.label = seed.nickname;
    if (seed.role) record.role = seed.role;
    if (seed.agentPath || seed.role) {
      const descriptor = [record.agentPath, record.role].filter((p): p is string => !!p).join(" · ");
      if (descriptor) record.detail = descriptor;
    }
    if (seed.detail) record.detail = seed.detail;
    if (seed.model) record.model = seed.model;
    // An agent appearing at all is a change of state: broadcast it here (once
    // the seed has been applied, so the first snapshot already carries the
    // label) rather than waiting for a status event that a text-only child
    // may never produce.
    if (created) this.emitSubagentUpdate(record);
    return record;
  }

  /**
   * Register an intermediate thread we have never otherwise seen, so a
   * grandchild's `parent_id` is stable from its first snapshot instead of
   * reading `null` until the parent happens to show up.
   */
  private registerAncestor(parentThreadId: string | null, childThreadId: string): void {
    if (!parentThreadId) return;
    if (parentThreadId === childThreadId) return;
    if (parentThreadId === this.threadId) return;
    if (this.subagents.has(parentThreadId)) return;
    this.ensureSubagent(parentThreadId, {});
  }

  /**
   * Record what a notification said about an agent and broadcast the snapshot
   * if it changed. Returns null for the main thread — the root agent is not a
   * roster entry.
   */
  private updateSubagent(
    threadId: string,
    seed: SubagentSeed,
    status?: SubagentStatus,
  ): SubagentRecord | null {
    if (!threadId) return null;
    if (this.threadId !== null && threadId === this.threadId) return null;
    const record = this.ensureSubagent(threadId, seed);
    if (status) record.status = status;
    this.emitSubagentUpdate(record);
    return record;
  }

  /** The roster snapshot for one agent, in the browser contract's shape. */
  private buildSubagentInfo(record: SubagentRecord): SubagentInfo {
    const parentId = record.parentThreadId && record.parentThreadId !== this.threadId
      ? this.subagents.get(record.parentThreadId)?.anchorId ?? null
      : null;
    const info: SubagentInfo = {
      id: record.anchorId,
      parent_id: parentId,
      label: record.label,
      status: record.status,
    };
    if (record.detail) info.detail = record.detail;
    if (record.model) info.model = record.model;
    if (record.contextPercent !== undefined) info.context_used_percent = record.contextPercent;
    return info;
  }

  /**
   * `subagent_update` is a state snapshot, so it is only worth sending when
   * the state moved: every status change, plus the `model` /
   * `context_used_percent` / label refinements the card renders. Never one per
   * message — an agent's own envelopes do not change its snapshot.
   */
  private emitSubagentUpdate(record: SubagentRecord): void {
    const info = this.buildSubagentInfo(record);
    const fingerprint = JSON.stringify(info);
    if (this.lastSubagentSnapshots.get(record.threadId) === fingerprint) return;
    this.lastSubagentSnapshots.set(record.threadId, fingerprint);
    this.emit({ type: "subagent_update", agent: info, timestamp: Date.now() });
  }

  // ── Notification handling (Codex → Browser) ─────────────────────────────

  private handleNotification(method: string, params: Record<string, unknown>): void {
    // A notification that names a thread we cannot yet place waits for the
    // main id rather than being charged to the root (see
    // `preAdoptionNotifications`). Notifications with no thread field are
    // legacy and have no second thread, so they proceed.
    if (this.threadId === null && threadIdOf(params) !== null) {
      this.preAdoptionNotifications.push({ method, params });
      return;
    }

    // Which agent produced this? Everything below operates on that thread's
    // state, and a child thread must never end the root turn, move the root
    // status, touch the root buffers, or move the root context gauge.
    const thread = this.resolveThread(params);
    const isChild = thread.anchorId !== null;

    switch (method) {
      case "thread/started": {
        // Our own thread came back on the `thread/start` RPC; this
        // notification only tells us something new when it announces a
        // subagent — `thread.parentThreadId` is set "only if this thread is a
        // subagent" — whose nickname/role are the label of last resort.
        const started = params.thread as {
          id?: string;
          parentThreadId?: string | null;
          agentNickname?: string | null;
          agentRole?: string | null;
          model?: string | null;
        } | undefined;
        if (started?.id && typeof started.parentThreadId === "string" && started.parentThreadId) {
          this.updateSubagent(started.id, {
            parentThreadId: started.parentThreadId,
            nickname: started.agentNickname ?? undefined,
            role: started.agentRole ?? undefined,
            model: started.model ?? undefined,
          });
        }
        break;
      }

      case "thread/status/changed": {
        // Per-thread lifecycle comes from the turn events; a child's status
        // notification would otherwise flip the whole session to idle.
        if (isChild) break;
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

      case "turn/started": {
        // v2 nests the id under `turn`; a turn Codex opened on its own (a
        // `/compact`) has no `turn/start` response to seed `currentTurnId`,
        // and interrupt needs it.
        const startedTurn = params.turn as { id?: string } | undefined;
        thread.currentTurnId = (params.turnId as string) || startedTurn?.id || thread.currentTurnId;
        if (isChild) {
          // The roster carries the child's liveness; the root status pill
          // keeps describing the root agent.
          this.updateSubagent(thread.threadId, {}, "running");
          break;
        }
        this.emit({ type: "status_change", status: "running" });
        break;
      }

      case "turn/completed": {
        // v0.114+: status is in params.turn.status; legacy: params.status
        const turn = params.turn as { status?: string; error?: { message?: string } } | undefined;
        const status = turn?.status ?? params.status as string ?? "completed";

        // This thread's own bookkeeping, whoever it belongs to.
        this.flushStreamingText(thread);
        this.flushReasoningText(thread);
        thread.currentTurnId = null;
        // Codex item ids are only unique within a turn, so both id-keyed
        // maps reset together — a stale collab card id would outlive the
        // card it belongs to.
        thread.emittedToolUseIds.clear();
        thread.collabCardIds.clear();

        if (isChild) {
          // Everything below is the root turn ending, and a subagent never
          // ends it: no `result`, no `num_turns`, no root `status_change`,
          // root buffers and gauge untouched.
          this.updateSubagent(
            thread.threadId,
            { detail: turn?.error?.message },
            mapChildTurnStatus(status),
          );
          break;
        }

        // Update turn count
        this.turnCount++;

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

        // A turn that ended without a boundary compacted nothing; do not let
        // a stale "manual" flag label the next auto-compaction.
        this.manualCompactRequested = false;

        this.emit({ type: "result", data: this.buildResultEnvelope(status, usage) });

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
        this.handleItemStarted(params, thread);
        break;

      case "item/completed":
        this.handleItemCompleted(params, thread);
        break;

      case "item/updated":
        // General item status update — update tool progress if applicable
        this.handleItemUpdated(params, thread);
        break;

      case "item/agentMessage/delta":
        this.handleAgentMessageDelta(params, thread);
        break;

      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
        this.handleCommandOutputDelta(params);
        break;

      // ── Reasoning / thinking ──
      case "item/reasoning/textDelta":
      case "item/reasoning/textSummaryDelta":
      case "item/reasoning/summaryTextDelta":
        this.handleReasoningDelta(params, thread);
        break;

      case "item/reasoning/summaryPartAdded":
        // Part boundary — can ignore for now
        break;

      // ── Token usage ──
      case "thread/tokenUsage/updated":
        // A child's window occupancy belongs on its roster card; the root
        // gauge only ever reports the root thread (issue #152: a child update
        // used to overwrite it).
        if (isChild) {
          this.handleChildTokenUsage(params, thread);
          break;
        }
        this.handleTokenUsageUpdated(params);
        break;

      // ── Rate limits ──
      case "account/rateLimits/updated":
        // Rate limit updates — log but don't block
        break;

      // ── Codex stream events ──
      case "codex/event/stream_error": {
        const msg = params.msg as { message?: string } | undefined;
        if (!msg?.message) break;
        console.log(`[codex-adapter] Stream error: ${msg.message}`);
        if (isChild) {
          // Same rule as the `error` notification: a subagent's failure is
          // its card's business, not a root bubble claiming the main agent
          // broke. No status change — these legacy events say nothing about
          // whether the turn is dead; `turn/completed` / `error` do.
          this.updateSubagent(thread.threadId, { detail: msg.message });
          break;
        }
        this.emit({ type: "error", message: msg.message } as BrowserIncomingMessage);
        break;
      }

      case "codex/event/error": {
        const msg = params.msg as { message?: string } | undefined;
        if (!msg?.message) break;
        console.error(`[codex-adapter] Codex error: ${msg.message}`);
        if (isChild) {
          this.updateSubagent(thread.threadId, { detail: msg.message });
          break;
        }
        this.emit({ type: "error", message: msg.message } as BrowserIncomingMessage);
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
        const { message, willRetry, details } = describeErrorNotification(params);
        console.error(`[codex-adapter] Error notification: ${message}${details ? `\n${details}` : ""}`);
        if (isChild) {
          // A subagent's failure is its card's business: no root `error`
          // bubble claiming the main agent broke.
          this.updateSubagent(thread.threadId, { detail: message }, willRetry ? undefined : "failed");
          break;
        }
        this.emit({
          type: "error",
          message: willRetry ? `${message} (retrying)` : message,
        } as BrowserIncomingMessage);
        break;
      }

      // v0.114+: model rerouted — update active model
      case "model/rerouted": {
        const toModel = params.toModel as string | undefined;
        if (!toModel) break;
        if (isChild) {
          // A reroute on a child thread reroutes that agent. Writing it to
          // `activeModel` would relabel the session and stamp the child's
          // model on every later root `assistant` message.
          this.updateSubagent(thread.threadId, { model: toModel });
          break;
        }
        this.activeModel = toModel;
        this.emitSessionUpdate({ model: toModel });
        break;
      }

      // v0.114+: context compacted via notification (not just item). Both
      // arrive for one compaction; `emitCompactBoundary` echoes it once.
      case "thread/compacted":
        // Compaction bookkeeping is the root session's, exactly as for the
        // `contextCompaction` item. A child compacting its own window used to
        // draw the ROOT boundary — labelled `manual` whenever the user had
        // armed `/compact`, carrying the root's `pre_tokens`, clearing
        // `is_compacting`, and spending the one echo the root's own
        // `thread/compacted` needed, so the real boundary emitted nothing.
        if (isChild) break;
        this.emitCompactBoundary();
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
    // Approvals are per-request and still block the whole session, but the
    // banner must be able to name the agent that asked: the v2 requests carry
    // `threadId`, the legacy ones call the same value `conversationId`.
    const thread = this.resolveThread(params);
    const parentToolUseId = thread.anchorId;

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
          parent_tool_use_id: parentToolUseId,
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
          parent_tool_use_id: parentToolUseId,
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
          parent_tool_use_id: parentToolUseId,
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
          parent_tool_use_id: parentToolUseId,
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
          parent_tool_use_id: parentToolUseId,
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
          parent_tool_use_id: parentToolUseId,
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

  private handleItemStarted(params: Record<string, unknown>, thread: ThreadState): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    switch (item.type) {
      case "agentMessage":
        this.flushStreamingText(thread);
        thread.streamingItemId = item.id;
        thread.streamingText = "";
        break;

      case "commandExecution": {
        thread.commandStartTimes.set(item.id, Date.now());
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          const cmd = item.command;
          const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
          this.emitToolUse(toolUseId, "Bash", { command: cmdStr }, thread.anchorId);
        }
        break;
      }

      case "fileChange": {
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
          const firstPath = changes?.[0]?.path ?? "";
          const firstKind = safeKind(changes?.[0]?.kind);
          this.emitToolUse(toolUseId, "Edit", {
            file_path: firstPath,
            operation: firstKind,
          }, thread.anchorId);
        }
        break;
      }

      case "webSearch": {
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          // Codex's webSearch item often arrives without `query` (the model
          // ran a web search but the protocol suppressed the actual term).
          // Only include the field when we actually have one — otherwise
          // the chat would render `{"query":""}` which is just noise.
          const input: Record<string, unknown> = {};
          if (typeof item.query === "string" && item.query.length > 0) {
            input.query = item.query;
          }
          this.emitToolUse(toolUseId, "WebSearch", input, thread.anchorId);
        }
        break;
      }

      case "mcpToolCall": {
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          // v0.114+: `server`/`tool`/`arguments`; legacy: `serverName`/`toolName`/`args`
          const serverName = (item.server ?? item.serverName) as string || "";
          const toolName = (item.tool ?? item.toolName) as string || "";
          const toolArgs = (item.arguments ?? item.args) as Record<string, unknown> || {};
          this.emitToolUse(toolUseId, `mcp:${serverName}:${toolName}`, { ...toolArgs }, thread.anchorId);
        }
        break;
      }

      case "reasoning":
        this.flushReasoningText(thread);
        thread.reasoningItemId = item.id;
        thread.reasoningText = "";
        break;

      case "collabAgentToolCall":
        this.handleCollabAgentToolCall(item, thread, false);
        break;

      case "subAgentActivity":
        this.handleSubAgentActivity(item, thread);
        break;

      case "contextCompaction":
        // Compaction bookkeeping is the root session's: a child compacting
        // its own window must not pin the session to `compacting`.
        if (thread.anchorId !== null) break;
        this.compactionEchoed = false;
        this.compactionPreTokens = this.lastContextTokens;
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

  private handleItemCompleted(params: Record<string, unknown>, thread: ThreadState): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    switch (item.type) {
      case "agentMessage":
        this.flushStreamingText(thread);
        break;

      case "commandExecution": {
        const toolUseId = item.id;
        // If we never emitted the tool_use (auto-approved), emit it now
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          const cmd = item.command;
          const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
          this.emitToolUse(toolUseId, "Bash", { command: cmdStr }, thread.anchorId);
        }

        // Emit tool_result with output
        const exitCode = item.exitCode as number | undefined;
        // v0.114+: `aggregatedOutput`; legacy: `output`
        const output = (item.aggregatedOutput ?? item.output) as string | undefined;
        const isError = item.status === "failed" || (exitCode !== undefined && exitCode !== 0);
        const resultText = output
          ? output.substring(0, 2000) + (output.length > 2000 ? "\n…truncated" : "")
          : (isError ? `Command failed (exit code ${exitCode})` : "Command completed successfully");
        this.emitToolResult(toolUseId, resultText, isError, thread.anchorId);

        thread.commandStartTimes.delete(item.id);
        break;
      }

      case "fileChange": {
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
          const firstPath = changes?.[0]?.path ?? "";
          const firstKind = safeKind(changes?.[0]?.kind);
          this.emitToolUse(toolUseId, "Edit", {
            file_path: firstPath,
            operation: firstKind,
          }, thread.anchorId);
        }

        const isError = item.status === "failed";
        const changes = item.changes as Array<{ path: string; kind: unknown; diff?: string }> | undefined;
        const summary = changes?.map((c) => `${safeKind(c.kind)} ${c.path}`).join("; ") ?? "File change completed";
        this.emitToolResult(item.id, summary, isError, thread.anchorId);

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
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          const input: Record<string, unknown> = {};
          if (typeof item.query === "string" && item.query.length > 0) {
            input.query = item.query;
          }
          this.emitToolUse(toolUseId, "WebSearch", input, thread.anchorId);
        }
        // Same protocol-suppression caveat as `handleItemStarted` above:
        // when Codex hides the actual result, the historical "Search
        // completed" filler just adds a redundant card per search. Skip
        // the tool_result emission entirely in that case — the tool_use
        // card alone marks that the search happened.
        const output = item.output as string | undefined;
        if (typeof output === "string" && output.length > 0) {
          this.emitToolResult(toolUseId, output, false, thread.anchorId);
        }
        break;
      }

      case "mcpToolCall": {
        const toolUseId = item.id;
        if (!thread.emittedToolUseIds.has(toolUseId)) {
          thread.emittedToolUseIds.add(toolUseId);
          // v0.114+: `server`/`tool`; legacy: `serverName`/`toolName`
          const serverName = (item.server ?? item.serverName) as string || "";
          const toolName = (item.tool ?? item.toolName) as string || "";
          this.emitToolUse(toolUseId, `mcp:${serverName}:${toolName}`, {}, thread.anchorId);
        }
        const isError = item.status === "failed";
        // v0.114+: error is { message: string }; result is { content: [...] }
        const errorObj = item.error as { message?: string } | string | undefined;
        const errorStr = typeof errorObj === "string" ? errorObj : errorObj?.message;
        const resultObj = item.result as { content?: unknown[] } | undefined;
        const output = item.output as string || errorStr || (resultObj?.content ? JSON.stringify(resultObj.content) : undefined) || "MCP call completed";
        this.emitToolResult(toolUseId, typeof output === "string" ? output : JSON.stringify(output), isError, thread.anchorId);
        break;
      }

      case "reasoning":
        this.flushReasoningText(thread);
        break;

      case "collabAgentToolCall":
        this.handleCollabAgentToolCall(item, thread, true);
        break;

      case "subAgentActivity":
        this.handleSubAgentActivity(item, thread);
        break;

      case "contextCompaction":
        if (thread.anchorId !== null) break;
        this.emitCompactBoundary();
        this.emit({ type: "status_change", status: "running" });
        break;

      case "userMessage":
        // Echo of user message completed — no action needed
        break;

      default:
        // Silently ignore
        break;
    }
  }

  /**
   * `collabAgentToolCall` — the spawner's own tool call, so it renders as a
   * tool card in the *sender's* conversation and doubles as the roster's
   * source of truth for the agents it names.
   *
   * A `spawnAgent` card is emitted with the new agent's anchor as its block
   * id, so the click target in the chat and the attribution key on the wire
   * are one value (§2.3). The dedupe key is the Codex **item** id, which is
   * not the same string when the child registered itself first and kept a
   * `thread:<id>` fallback anchor — `thread.collabCardIds` holds the mapping
   * so the `tool_result` names the id the `tool_use` was actually emitted
   * with.
   *
   * Two consequences of "one card is one agent":
   *
   * - A spawn that has not named its receiver yet (`item/started` can arrive
   *   before the child exists) has no identity to put on a card, so the card
   *   waits for `item/completed`, which does name it. Emitting early is what
   *   gave one agent two ids: a card under the item id and a roster entry
   *   under the anchor the child had meanwhile registered.
   * - A spawn that names several receivers creates several agents from one
   *   call. None of them can own the card, so it keeps the item id (its
   *   `input.agents` lists the team) and every receiver keeps its own
   *   fallback anchor; the frontend derives a card per agent (§3.4).
   */
  private handleCollabAgentToolCall(item: CodexItem, thread: ThreadState, completed: boolean): void {
    const tool = typeof item.tool === "string" ? item.tool : "";
    const isSpawn = tool === "spawnAgent";
    const senderThreadId = typeof item.senderThreadId === "string" && item.senderThreadId
      ? item.senderThreadId
      : thread.threadId;
    const receivers = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    // `agentsStates` is the call's outcome per agent — the roster update and
    // the tool_result summary come from the same reading.
    const agentsStates = item.agentsStates && typeof item.agentsStates === "object"
      ? item.agentsStates as Record<string, { status?: unknown; message?: unknown } | undefined>
      : {};
    // The agents this one call is about, from whichever field carries them.
    const named = receivers.length > 0 ? receivers : Object.keys(agentsStates);

    // Register every receiver. Only a spawn that names exactly one agent may
    // propose its item id as that agent's anchor; a fan-out spawn's agents
    // each keep their own fallback, and the other collab tools refer to
    // agents that already exist.
    const proposeAnchor = isSpawn && named.length === 1;
    const records = new Map<string, SubagentRecord>();
    for (const receiver of receivers) {
      const record = this.updateSubagent(receiver, {
        anchorId: proposeAnchor ? item.id : undefined,
        parentThreadId: senderThreadId,
      });
      if (record) records.set(receiver, record);
    }

    // The card's id is decided once per Codex item and reused for its result.
    let cardId = thread.collabCardIds.get(item.id);
    if (cardId === undefined) {
      if (isSpawn && named.length === 0 && !completed) return; // no agent to name yet
      const anchor = proposeAnchor ? this.subagents.get(named[0])?.anchorId : undefined;
      cardId = anchor ?? item.id;
      thread.collabCardIds.set(item.id, cardId);
      thread.emittedToolUseIds.add(item.id);
      this.emitToolUse(
        cardId,
        collabToolName(tool),
        this.buildCollabInput(item, receivers, records),
        thread.anchorId,
      );
    }

    if (!completed) return;

    const lines: string[] = [];
    for (const [agentThreadId, state] of Object.entries(agentsStates)) {
      const wireStatus = typeof state?.status === "string" ? state.status : "unknown";
      const message = typeof state?.message === "string" && state.message ? state.message : undefined;
      const record = this.updateSubagent(
        agentThreadId,
        {
          anchorId: proposeAnchor ? item.id : undefined,
          parentThreadId: senderThreadId,
          detail: message,
        },
        mapAgentStateStatus(state?.status),
      );
      const label = record?.label || agentThreadId;
      lines.push(`${label}: ${wireStatus}${message ? ` — ${message}` : ""}`);
    }

    const isError = item.status === "failed";
    const summary = lines.length > 0
      ? lines.join("\n")
      : `${collabToolName(tool)} ${isError ? "failed" : "completed"}`;
    this.emitToolResult(cardId, summary, isError, thread.anchorId);
  }

  /**
   * The card's `input`. Labels are omitted while unknown — a spawn call's
   * `item/started` usually precedes every source of a name, and rendering
   * `{"agent":""}` is noise (same reasoning as the `webSearch` query).
   */
  private buildCollabInput(
    item: CodexItem,
    receivers: string[],
    records: Map<string, SubagentRecord>,
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    const labels = receivers
      .map((id) => records.get(id)?.label ?? "")
      .filter((label) => label.length > 0);
    if (receivers.length === 1 && labels.length === 1) {
      input.agent = labels[0];
    } else if (labels.length > 0) {
      input.agents = labels;
    }
    if (typeof item.prompt === "string" && item.prompt) {
      input.prompt = item.prompt.slice(0, COLLAB_PROMPT_PREVIEW_CHARS);
    }
    if (typeof item.model === "string" && item.model) input.model = item.model;
    if (typeof item.reasoningEffort === "string" && item.reasoningEffort) {
      input.reasoning_effort = item.reasoningEffort;
    }
    return input;
  }

  /**
   * `subAgentActivity` — the parent's view of what one of its agents is doing.
   * Roster only: the agent's own messages already arrive on its own thread, so
   * a chat bubble here would say the same thing twice in the wrong voice.
   */
  private handleSubAgentActivity(item: CodexItem, thread: ThreadState): void {
    const agentThreadId = typeof item.agentThreadId === "string" ? item.agentThreadId : "";
    if (!agentThreadId) return;
    this.updateSubagent(
      agentThreadId,
      {
        parentThreadId: thread.threadId,
        agentPath: typeof item.agentPath === "string" && item.agentPath ? item.agentPath : undefined,
      },
      mapActivityKind(item.kind),
    );
  }

  /**
   * A child thread's `thread/tokenUsage/updated`. Same two-number rule as the
   * root gauge (`last` occupies the window, `total` is cumulative), but the
   * reading lands on that agent's roster card — never on the session's gauge.
   */
  private handleChildTokenUsage(params: Record<string, unknown>, thread: ThreadState): void {
    const tokenUsage = params.tokenUsage as {
      total?: CodexTokenCounts;
      last?: CodexTokenCounts;
      modelContextWindow?: number | null;
    } | undefined;

    let contextTokens: number;
    let modelContextWindow: number;
    if (tokenUsage?.total || tokenUsage?.last) {
      modelContextWindow = tokenUsage.modelContextWindow ?? DEFAULT_CONTEXT_WINDOW;
      contextTokens = occupiedTokens(tokenUsage.last ?? tokenUsage.total ?? {});
    } else {
      modelContextWindow = (params.modelContextWindow as number) || DEFAULT_CONTEXT_WINDOW;
      contextTokens = ((params.inputTokens as number) || 0) + ((params.outputTokens as number) || 0);
    }

    const record = this.ensureSubagent(thread.threadId, {
      model: typeof params.model === "string" && params.model ? params.model : undefined,
    });
    record.contextPercent = contextPercent(contextTokens, modelContextWindow);
    this.emitSubagentUpdate(record);
  }

  private handleItemUpdated(params: Record<string, unknown>, thread: ThreadState): void {
    const item = params.item as CodexItem | undefined;
    if (!item) return;

    // Update status for long-running tool executions
    if (item.type === "commandExecution" && item.status === "inProgress") {
      const startTime = thread.commandStartTimes.get(item.id);
      if (startTime) {
        const elapsed = Date.now() - startTime;
        this.emit({
          type: "tool_progress",
          tool_use_id: item.id,
          tool_name: "Bash",
          elapsed_time_seconds: Math.round(elapsed / 1000),
          parent_tool_use_id: thread.anchorId,
        });
      }
    }
  }

  private handleAgentMessageDelta(params: Record<string, unknown>, thread: ThreadState): void {
    const delta = params.delta as string;
    if (!delta) return;

    thread.streamingText += delta;

    // Emit streaming event for real-time updates
    this.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: delta },
      },
      parent_tool_use_id: thread.anchorId,
    });
  }

  private handleCommandOutputDelta(_params: Record<string, unknown>): void {
    // Earlier we forwarded codex's per-line stdout deltas as
    // `content_block_delta` text deltas — intending them to render as live
    // tool output. The frontend's stream handler (`src/ws.ts:444`) does NOT
    // honor `parent_tool_use_id` on text deltas, though: every delta gets
    // appended to the assistant's streaming-text buffer and Markdown-rendered.
    // Shell output (alignment whitespace, underscored tokens, sed columns)
    // then collapsed into garbled italic fragments leaking into the prose
    // bubble. The final, complete output already appears in the tool_result
    // block (a real `<pre>` with `whitespace-pre-wrap`); the in-flight
    // progress indicator comes from `handleItemUpdated`'s `tool_progress`
    // emission. Dropping the per-delta forward removes the corruption with
    // no loss of useful feedback.
    return;
  }

  private handleReasoningDelta(params: Record<string, unknown>, thread: ThreadState): void {
    const delta = (params.delta as string) || (params.text as string) || "";
    if (!delta) return;

    thread.reasoningText += delta;

    // Emit as thinking/reasoning stream event
    this.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: delta },
      },
      parent_tool_use_id: thread.anchorId,
    });
  }

  /**
   * `thread/tokenUsage/updated` carries two quantities that must not be
   * confused. `tokenUsage.total` is the session's *cumulative* spend — every
   * request re-counts the whole prompt it resent, so a long session runs to
   * millions of tokens. `tokenUsage.last` is the most recent request alone,
   * which is what actually occupies the model's context window right now.
   *
   * Measuring the window against `total` is what produced readouts like
   * "ctx 5851%": a real session showed 23.3M cumulative tokens against a
   * 258,400-token window, where `last` was 127,291 — 49%. Cumulative counters
   * still read `total`; the context gauge reads `last`.
   */
  private handleTokenUsageUpdated(params: Record<string, unknown>): void {
    // v0.114+: params.tokenUsage = { total, last, modelContextWindow }
    // Legacy: flat params.inputTokens, params.outputTokens, etc.
    const tokenUsage = params.tokenUsage as {
      total?: CodexTokenCounts;
      last?: CodexTokenCounts;
      modelContextWindow?: number | null;
    } | undefined;

    const costUsd = (params.costUsd as number) || 0;
    const model = params.model as string | undefined;

    let contextTokens: number;
    let modelContextWindow: number;

    if (tokenUsage?.total) {
      // v0.114+ format. `total` is already cumulative, so it replaces the
      // running counters rather than adding to them.
      this.cumulativeInputTokens = tokenUsage.total.inputTokens ?? 0;
      this.cumulativeOutputTokens = tokenUsage.total.outputTokens ?? 0;
      modelContextWindow = tokenUsage.modelContextWindow ?? DEFAULT_CONTEXT_WINDOW;
      // `last` is absent until the first request completes; until then `total`
      // *is* the last request, so it is the honest fallback.
      contextTokens = occupiedTokens(tokenUsage.last ?? tokenUsage.total);
    } else {
      // Legacy flat format: one request's counts, so they are the occupancy.
      // Cumulative totals are maintained by `turn/completed` on this path and
      // are deliberately left alone here.
      modelContextWindow = (params.modelContextWindow as number) || DEFAULT_CONTEXT_WINDOW;
      contextTokens = ((params.inputTokens as number) || 0) + ((params.outputTokens as number) || 0);
    }

    this.lastContextTokens = contextTokens;

    // Update cumulative cost if provided
    if (costUsd > 0) {
      this.cumulativeCostUsd = costUsd;
    }

    // Update active model if reported
    if (model && model !== this.activeModel) {
      this.activeModel = model;
    }

    this.emitSessionUpdate({
      model: this.activeModel,
      context_used_percent: contextPercent(contextTokens, modelContextWindow),
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

  private flushStreamingText(thread: ThreadState): void {
    if (!thread.streamingText || !thread.streamingItemId) return;

    const content: ContentBlock[] = [{ type: "text", text: thread.streamingText }];
    const assistantMsg: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: thread.streamingItemId,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: thread.anchorId,
      timestamp: Date.now(),
    };

    this.emit(assistantMsg);
    thread.streamingText = "";
    thread.streamingItemId = null;
  }

  private flushReasoningText(thread: ThreadState): void {
    if (!thread.reasoningText || !thread.reasoningItemId) return;

    // Emit reasoning as a thinking content block in an assistant message
    const content: ContentBlock[] = [
      { type: "thinking", thinking: thread.reasoningText } as ContentBlock,
    ];
    this.emit({
      type: "assistant",
      message: {
        id: `reasoning-${thread.reasoningItemId}`,
        type: "message",
        role: "assistant",
        model: this.activeModel,
        content,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: thread.anchorId,
      timestamp: Date.now(),
    });

    thread.reasoningText = "";
    thread.reasoningItemId = null;
  }

  private emitToolUse(
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
    parentToolUseId: string | null,
  ): void {
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
      parent_tool_use_id: parentToolUseId,
      timestamp: Date.now(),
    });
  }

  private emitToolResult(
    toolUseId: string,
    resultText: string,
    isError: boolean,
    parentToolUseId: string | null,
  ): void {
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
      parent_tool_use_id: parentToolUseId,
      timestamp: Date.now(),
    });
  }

  // ── Policy mapping ──────────────────────────────────────────────────────

  private mapApprovalPolicy(mode: string): string {
    switch (mode) {
      case "bypassPermissions":
        return "never";
      default:
        // codex-cli 0.128+ removed "unless-allow-listed"; use "on-request"
        // (ask before each exec unless approved) as the closest equivalent.
        // Accepted variants: untrusted, on-failure, on-request, granular, never.
        return "on-request";
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
