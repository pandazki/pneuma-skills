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
  | "section" | "link" | "container" | "interactive" | "region";

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
  /** Human-readable element name (e.g. 'button "Submit"', 'h2 "Our Solution"') */
  label?: string;
  /** Nearby sibling text for context */
  nearbyText?: string;
  /** Accessibility attributes summary */
  accessibility?: string;
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
  /** Annotations attached to this message (annotate mode) */
  annotations?: Annotation[];
  /** If true, system message is shown in a collapsible section (e.g. command output) */
  isCollapsible?: boolean;
  /** Subtype for specialized rendering (e.g. "context" for /context output) */
  subtype?: string;
  /** Attached images (base64 data URLs for display) */
  images?: { media_type: string; data: string }[];
  /** Non-image file attachments (metadata only, no data) */
  files?: { name: string; size: number }[];
  /** Debug mode: enriched content + images + files actually sent to CLI */
  debugPayload?: { enrichedContent: string; images?: { media_type: string; data: string }[]; files?: { name: string; media_type: string; size: number }[] };
  /** Viewer-initiated notification sent to agent (shown as context card in user bubble) */
  viewerNotification?: { type: string; summary: string; files?: string[] };
}

export interface FileContent {
  path: string;
  content: string;
}

/** A single annotation — element + user feedback comment. */
export interface Annotation {
  id: string;
  slideFile: string;          // which slide this annotation is on
  element: SelectionContext;  // reuse existing type
  comment: string;            // user's feedback for this element
}

/** A significant user action performed in the viewer (recorded for CC context injection). */
export interface UserAction {
  timestamp: number;
  actionId: string;       // e.g. "scaffold", "navigate-to", "clear"
  description: string;    // human-readable, e.g. "Initialized workspace with 5 slides"
  params?: Record<string, unknown>;
}
