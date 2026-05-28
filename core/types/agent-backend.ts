/**
 * AgentBackend — Agent runtime abstraction
 *
 * The current implementation uses Claude Code as the first reference backend, but the external contract is split into two layers:
 * - AgentBackend: lifecycle and capability declarations
 * - AgentProtocolAdapter: translation from backend-specific protocol to runtime standard messages
 *
 * The frontend and most server-side logic depend on normalized session state, not a specific backend's wire protocol.
 */

// ── Agent Lifecycle ──────────────────────────────────────────────────────────

export type AgentBackendType = "claude-code" | "codex" | "kimi-cli";

export interface AgentBackendDescriptor {
  type: AgentBackendType;
  label: string;
  description: string;
  implemented: boolean;
}

/** Agent session info */
export interface AgentSessionInfo {
  /** Server routing session ID (UUID) */
  sessionId: string;
  /** Agent's internal session ID (for resume, e.g. Claude Code's --resume) */
  agentSessionId?: string;
  /** Process PID (if using child process mode) */
  pid?: number;
  /** Session state */
  state: "starting" | "connected" | "running" | "exited";
  /** Exit code (present when state=exited) */
  exitCode?: number | null;
  /** Working directory */
  cwd: string;
  /** Creation timestamp */
  createdAt: number;
}

/** Agent launch options */
export interface AgentLaunchOptions {
  /** Working directory */
  cwd: string;
  /** Permission mode */
  permissionMode?: string;
  /** Model */
  model?: string;
  /** Reuse an existing server session ID (instead of generating a new one) */
  sessionId?: string;
  /** Agent's internal session ID (for resuming a previous session) */
  resumeSessionId?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

/** Agent backend — manages the Agent process lifecycle */
export interface AgentBackend {
  /** Unique backend identifier */
  readonly name: AgentBackendType;

  /** Capability declarations */
  readonly capabilities: AgentCapabilities;

  /** Launch a new Agent session */
  launch(options: AgentLaunchOptions): AgentSessionInfo;

  /** Get session info */
  getSession(sessionId: string): AgentSessionInfo | undefined;

  /** Check if a session is alive */
  isAlive(sessionId: string): boolean;

  /** Mark session as connected (called when WS is established) */
  markConnected(sessionId: string): void;

  /** Store the Agent's internal session ID (obtained from the Agent's init message) */
  setAgentSessionId(sessionId: string, agentSessionId: string): void;

  /** Kill a session */
  kill(sessionId: string): Promise<boolean>;

  /** Kill all sessions */
  killAll(): Promise<void>;

  /** Register exit callback */
  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void;
}

/** Agent capability declarations — describes which features this Agent supports */
export interface AgentCapabilities {
  /** Supports token-level streaming output */
  streaming: boolean;
  /** Supports session resume (--resume) */
  resume: boolean;
  /** Supports permission approval flow (control_request → permission_request) */
  permissions: boolean;
  /** Supports tool execution progress reporting (tool_progress) */
  toolProgress: boolean;
  /** Supports runtime model switching */
  modelSwitch: boolean;
  /** Scheduled / cron tasks supported (Claude Code currently only). */
  scheduling?: boolean;
  /** Backend reports per-message / cumulative cost via `total_cost_usd`. */
  costTracking?: boolean;
  /** Backend exposes context-window stats (used / total tokens). */
  contextWindow?: boolean;
  /** Open metadata escape hatch — never read by core; backends + frontend may use this for per-backend extras. */
  extras?: Record<string, unknown>;
}

// ── Agent Protocol Adaptation ────────────────────────────────────────────────

/**
 * Standard message types — runtime format between ws-bridge and the frontend.
 *
 * v1 still directly reuses existing session/browser types rather than extracting a separate StandardMessage AST.
 * This keeps the Claude path zero-regression and leaves an adaptation point for the second backend.
 *
 * When the second backend's message mapping clearly exceeds the current type's expressiveness, a more formal standard message subset will be extracted.
 */

/**
 * AgentProtocolAdapter — message protocol adapter.
 *
 * @deprecated RESERVED / UNUSED. No production code implements or consumes this
 * interface. The real per-backend protocol seam is `BridgeBackend`
 * (`server/ws-bridge-backend.ts`), instantiated via
 * `BackendModule.createBridgeBackend()`; the Codex/Kimi `*-adapter.ts` classes
 * implement that, NOT this. Kept only as a documented sketch of a future
 * `parseIncoming`/`encodeOutgoing` AST extraction. Do not wire new backends to
 * it — use `BridgeBackend` instead.
 */
export interface AgentProtocolAdapter {
  /** Parse raw data from the Agent into structured messages (null = skip this message) */
  parseIncoming(raw: string): unknown | null;

  /** Encode standard messages into a format the Agent can accept */
  encodeOutgoing(msg: unknown): string;
}

// ── BackendModule (single source of truth) ───────────────────────────────────

// Type-only imports from `server/` are erased at compile time, so this file
// remains free of runtime dependencies on the server layer. Both `core/` and
// `server/` are listed in `tsconfig.json#include`, so the resolver finds them.
import type { BridgeBackend, BridgeBackendDeps } from "../../server/ws-bridge-backend.js";
import type { ToolFileRef } from "../../backends/tool-file-ref.js";

/** A model exposed by a backend in the launcher / model-switcher UI. */
export interface ModelOption {
  id: string;
  label: string;
  icon: string;
}

/** Result of `BackendModule.checkRequirements()` — binary availability probe. */
export interface BackendRequirementResult {
  ok: boolean;
  reason?: string;
  binaryPath?: string;
}

/**
 * Single source of truth for everything backend-specific. Each backend ships
 * one of these from `backends/<backend>/manifest.ts`. The central registry
 * (`backends/index.ts`) iterates over the modules — no `if (type === ...)`
 * lives outside this file or the manifest.
 */
export interface BackendModule {
  // ── Identity ───────────────────────────────────────────────────────────
  readonly type: AgentBackendType;
  readonly label: string;
  readonly description: string;
  /** Short name for prose generated by the skill installer (NOT brand name). */
  readonly displayLabel: string;

  // ── CLI requirements ──────────────────────────────────────────────────
  readonly binary: string;
  /** Multi-line human-readable install instruction shown when binary missing. */
  readonly installHint: string;

  // ── File-layout conventions ───────────────────────────────────────────
  readonly skillsDir: string;
  readonly instructionsFile: string;

  // ── Capability declarations ───────────────────────────────────────────
  readonly capabilities: AgentCapabilities;
  /** Static fallback when the backend doesn't emit `available_models` over the wire. */
  readonly defaultModels?: ModelOption[];

  // ── Lifecycle factories ───────────────────────────────────────────────
  /** Create a per-process backend instance. */
  createBackend(port: number): AgentBackend;

  /**
   * Build the BridgeBackend that wires this backend's adapter into the
   * central WsBridge. Return `null` for backends that use the legacy
   * NDJSON-over-stdio path (claude-code) — the bridge handles those itself.
   */
  createBridgeBackend(
    deps: BridgeBackendDeps,
    backend: AgentBackend,
    sessionId: string,
  ): BridgeBackend | null;

  // ── Self-describing helpers ───────────────────────────────────────────
  /**
   * Probe the system to verify the backend is runnable. Should be cheap
   * (PATH lookup + maybe `--version`); safe to call at startup. Result
   * drives launcher availability badges + CLI startup checks.
   */
  checkRequirements(): BackendRequirementResult;

  /**
   * Pure helper: given a tool_use block's name + input, return a normalized
   * reference to the file it operates on, or undefined if the tool isn't a
   * file op. Lets the chat UI render inline previews / system-open actions
   * without knowing this backend's tool naming. Optional — backends that
   * don't implement it simply don't get previews/actions on their tool
   * calls (graceful, no special-casing).
   */
  toolFileRef?(toolName: string, input: Record<string, unknown>): ToolFileRef | undefined;
}
