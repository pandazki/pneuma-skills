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

export type AgentBackendType = "claude-code" | "codex";

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
 * AgentProtocolAdapter — message protocol adapter
 *
 * Translates between the Agent's raw message format and the ws-bridge runtime format.
 * Claude Code currently uses near-passthrough NDJSON; other backends adapt through their own adapters.
 */
export interface AgentProtocolAdapter {
  /** Parse raw data from the Agent into structured messages (null = skip this message) */
  parseIncoming(raw: string): unknown | null;

  /** Encode standard messages into a format the Agent can accept */
  encodeOutgoing(msg: unknown): string;
}
