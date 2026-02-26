import type {
  SessionState,
  PermissionRequest,
  ContentBlock,
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
} from "../server/session-types.js";

export type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage, BrowserOutgoingMessage };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: number;
  parentToolUseId?: string | null;
  isStreaming?: boolean;
  model?: string;
  stopReason?: string | null;
}

export interface FileContent {
  path: string;
  content: string;
}
