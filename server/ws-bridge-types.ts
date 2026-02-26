import type { ServerWebSocket } from "bun";
import type {
  BrowserIncomingMessage,
  PermissionRequest,
  SessionState,
  BufferedBrowserEvent,
} from "./session-types.js";

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

export type SocketData = CLISocketData | BrowserSocketData;

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
  messageHistory: BrowserIncomingMessage[];
  pendingMessages: string[];
  nextEventSeq: number;
  eventBuffer: BufferedBrowserEvent[];
  lastAckSeq: number;
  processedClientMessageIds: string[];
  processedClientMessageIdSet: Set<string>;
}

export function makeDefaultState(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    model: "",
    cwd: "",
    tools: [],
    permissionMode: "default",
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
