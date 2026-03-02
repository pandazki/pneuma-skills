import type {
  SessionState,
  PermissionRequest,
  ContentBlock,
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
} from "../server/session-types.js";

export type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage, BrowserOutgoingMessage };

export type SelectionType =
  | "heading" | "paragraph" | "list" | "code" | "blockquote" | "image" | "table" | "text-range"
  | "section" | "link" | "container" | "interactive";

export interface SelectionContext {
  file: string;
  type: SelectionType;
  content: string;
  level?: number;
  /** HTML tag name (e.g. "div", "section", "h2") */
  tag?: string;
  /** CSS class list (e.g. "card bg-white rounded-lg") */
  classes?: string;
  /** Unique CSS selector path (e.g. "section.hero > div.card:nth-child(2)") */
  selector?: string;
  /** SVG data URL thumbnail of the selected element */
  thumbnail?: string;
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
  /** If true, system message is shown in a collapsible section (e.g. command output) */
  isCollapsible?: boolean;
  /** Subtype for specialized rendering (e.g. "context" for /context output) */
  subtype?: string;
  /** Attached images (base64 data URLs for display) */
  images?: { media_type: string; data: string }[];
  /** Debug mode: enriched content + images actually sent to CLI */
  debugPayload?: { enrichedContent: string; images?: { media_type: string; data: string }[] };
}

export interface FileContent {
  path: string;
  content: string;
}
