import type { ServerWebSocket } from "bun";
import type {
  BrowserIncomingMessage,
  PermissionRequest,
  SessionState,
  BufferedBrowserEvent,
} from "./session-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { ViewerActionResult } from "../core/types/viewer-contract.js";
import { getBackendCapabilities, getBackendModule } from "../backends/index.js";

export interface CLISocketData {
  kind: "cli";
  sessionId: string;
}

export interface BrowserSocketData {
  kind: "browser";
  sessionId: string;
  subscribed?: boolean;
  lastAckSeq?: number;
}

export interface TerminalSocketData {
  kind: "terminal";
  terminalId: string;
}

export type SocketData = CLISocketData | BrowserSocketData | TerminalSocketData;

/**
 * Minimal transport surface the bridge needs from the CLI side. The legacy
 * `--sdk-url` path satisfies this with a real WebSocket; the new stdio path
 * (Crystal/Conductor pattern) supplies a thin wrapper around the spawned
 * Claude Code process's stdin pipe. Only `send` and `close` are ever called
 * — keep this surface narrow on purpose so anything that quacks fits.
 */
export interface CLITransport {
  send(line: string): void;
  close(): void;
}

/** Tracks a pending control_request sent to CLI that expects a control_response. */
export interface PendingControlRequest {
  subtype: string;
  resolve: (response: unknown) => void;
}

export interface Session {
  id: string;
  cliSocket: CLITransport | null;
  browserSockets: Set<ServerWebSocket<SocketData>>;
  state: SessionState;
  pendingPermissions: Map<string, PermissionRequest>;
  pendingControlRequests: Map<string, PendingControlRequest>;
  pendingViewerActions: Map<string, { resolve: (result: ViewerActionResult) => void }>;
  /** Whether CLI is idle (not processing a turn). Used to gate viewer notifications. */
  cliIdle: boolean;
  /** Queued viewer notifications to send when CLI becomes idle. */
  pendingNotifications: Array<{ type: string; message: string; severity: "info" | "warning"; images?: { media_type: string; data: string }[] }>;
  /**
   * Queued server-originated system tags (e.g. `<pneuma:borrow-returned>`) to
   * deliver to the agent when the CLI next becomes idle. Sibling to
   * `pendingNotifications` so a non-viewer signal rides the same flush-on-idle
   * gate verbatim without borrowing the viewer-notification shape
   * (`{ type, message, severity }`) or starving the viewer path — both queues
   * drain one item per turn boundary. Each entry is a ready-to-send tag string.
   */
  pendingSystemSignals: string[];
  messageHistory: BrowserIncomingMessage[];
  /**
   * `<pneuma:env>` tags accumulate here until the user actually types
   * something. Then the next outbound `handleUserMessage` prepends them to
   * the CLI-bound content (one-shot context injection) and clears this
   * buffer. The tags are also kept in `messageHistory` for chat-banner
   * rendering, but they never reach the agent as standalone user turns —
   * that's what produced redundant "welcome back" replies before.
   */
  pendingEnvContext: string[];
  /**
   * True while we're waiting for the user to answer an `AskUserQuestion`
   * picker. Claude Code 2.x auto-denies the AskUserQuestion tool inside
   * the CLI's SDK (returns an `is_error` tool_result before the user has
   * any chance to click), and the model would otherwise AUTO-CONTINUE a
   * reactionary turn — executing tools (e.g. Write) on a guess before the
   * user picks. To genuinely pause, handleAssistantMessage fires an
   * `interrupt` the moment it detects the AskUserQuestion tool_use, which
   * aborts that turn (verified ~30ms after the tool_use, before any
   * reactionary tool runs). This flag closes the suppression window for
   * anything that still slips through before the interrupt lands — the
   * aborted-turn assistant envelope, its streaming partials, streamlined
   * text, and the interrupt's `error_during_execution` result. It clears
   * when the user submits an answer (handlePermissionResponse delivers the
   * `<pneuma:askq-answer>` follow-up as a fresh turn) or the picker is
   * cancelled. The model's reply to the real answer flows normally.
   */
  suppressingPostAskq: boolean;
  pendingMessages: string[];
  nextEventSeq: number;
  eventBuffer: BufferedBrowserEvent[];
  lastAckSeq: number;
  processedClientMessageIds: string[];
  processedClientMessageIdSet: Set<string>;
}

export function makeDefaultState(
  sessionId: string,
  backendType: AgentBackendType = "claude-code",
): SessionState {
  const mod = getBackendModule(backendType);
  return {
    session_id: sessionId,
    backend_type: backendType,
    agent_capabilities: getBackendCapabilities(backendType),
    model: "",
    cwd: "",
    tools: [],
    permissionMode: "default",
    agent_version: "",
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
    // Static manifest fallback for the model switcher. Codex/kimi-cli emit
    // their own list via `available_models`; their modules omit defaultModels,
    // so this stays undefined and the switcher falls through to the dynamic
    // list. claude-code ships a static list because it doesn't emit one.
    default_models: mod.defaultModels,
  };
}
