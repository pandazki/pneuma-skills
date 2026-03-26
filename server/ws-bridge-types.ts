import type { ServerWebSocket } from "bun";
import type {
  BrowserIncomingMessage,
  PermissionRequest,
  SessionState,
  BufferedBrowserEvent,
} from "./session-types.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { ViewerActionResult } from "../core/types/viewer-contract.js";
import { getBackendCapabilities } from "../backends/index.js";

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

/** Tracks a pending control_request sent to CLI that expects a control_response. */
export interface PendingControlRequest {
  subtype: string;
  resolve: (response: unknown) => void;
}

export interface Session {
  id: string;
  cliSocket: ServerWebSocket<SocketData> | null;
  browserSockets: Set<ServerWebSocket<SocketData>>;
  state: SessionState;
  pendingPermissions: Map<string, PermissionRequest>;
  pendingControlRequests: Map<string, PendingControlRequest>;
  pendingViewerActions: Map<string, { resolve: (result: ViewerActionResult) => void }>;
  /** Whether CLI is idle (not processing a turn). Used to gate viewer notifications. */
  cliIdle: boolean;
  /** Queued viewer notifications to send when CLI becomes idle. */
  pendingNotifications: Array<{ type: string; message: string; severity: "info" | "warning"; images?: { media_type: string; data: string }[] }>;
  messageHistory: BrowserIncomingMessage[];
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
  };
}
