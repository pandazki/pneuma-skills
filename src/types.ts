import type {
  SessionState,
  PermissionRequest,
  ContentBlock,
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
} from "../server/session-types.js";

export type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage, BrowserOutgoingMessage };

export type SelectionType = "heading" | "paragraph" | "list" | "code" | "blockquote" | "image" | "table" | "text-range";

export interface SelectionContext {
  file: string;
  type: SelectionType;
  content: string;
  level?: number;
}

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
  selectionContext?: SelectionContext;
}

export interface FileContent {
  path: string;
  content: string;
}
