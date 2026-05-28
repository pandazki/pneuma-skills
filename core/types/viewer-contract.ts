/**
 * ViewerContract — Agent-Human Alignment Protocol
 *
 * The core responsibility of ViewerContract is Agent-Human alignment:
 * 1. Perception alignment — Agent can see what the User sees (extractContext, workspace)
 * 2. Capability alignment — Agent can do what the User can do (actions)
 *
 * Each Mode provides an object implementing this interface.
 * The Runtime Shell uses this interface to render previews, handle user interactions, and bridge Agent operations.
 */

import type { ComponentType } from "react";
import type { Source, FileChannel } from "./source.js";

/** File content (kept in sync with FileContent in src/types.ts) */
export interface ViewerFileContent {
  path: string;
  content: string;
}

// ── Viewer Address (the one noun for "which object in the viewer") ──────────

/**
 * ViewerAddress — a mode-defined, serializable referent for an object inside
 * the viewer: a page, a slide, a DOM region, a diagram node, a heading.
 *
 * Opaque to the framework — only the owning mode's viewer interprets it. The
 * protocol fixes that this slot EXISTS and which verbs consume/produce it;
 * each mode owns the keys and the granularity of its address vocabulary.
 *
 * Convention (documented per mode in its SKILL.md, not enforced here): an
 * address pairs a coarse "where" — `page` / `slide` / `file` / `contentSet` —
 * with an optional fine "within" — `anchor` / `selector` / `nodeId` /
 * `lineRange`. A mode that needs only the coarse half simply omits the rest.
 *
 * One noun, every verb: a `ViewerLocator` points the user at an address, the
 * `capture` action screenshots one, navigation moves the viewer to one, and a
 * selection reports the one the user picked — so select → view → point
 * round-trips without per-feature glue. Mirrors the `fileRef` precedent
 * (`BackendModule.toolFileRef`): a cross-cutting, normalized reference type.
 */
export type ViewerAddress = Record<string, unknown>;

/** Selection context (kept in sync with SelectionContext in src/types.ts) */
export interface ViewerSelectionContext {
  type: string;
  content: string;
  file?: string;
  level?: number;
  /** HTML tag name (e.g. "div", "section", "h2") */
  tag?: string;
  /** CSS class list (e.g. "card bg-white rounded-lg") */
  classes?: string;
  /** Unique CSS selector path (e.g. "section.hero > div.card:nth-child(2)") */
  selector?: string;
  /**
   * Mode-defined machine handle for the selected object — the round-trippable
   * referent (see ViewerAddress). The agent can feed this straight into the
   * `capture` action or a `<viewer-locator>` card to re-target the exact same
   * object. The sibling descriptor fields (`selector`, `tag`, `label`,
   * `nearbyText`, `accessibility`, `thumbnail`) stay as human- and
   * agent-readable context; `address` is the part meant for machine routing.
   */
  address?: ViewerAddress;
  /** SVG data URL thumbnail of the selected element (null if capture failed or element too large) */
  thumbnail?: string;
  /** Human-readable element name (e.g. 'button "Submit"', 'h2 "Our Solution"') */
  label?: string;
  /** Nearby sibling text for context (e.g. '[before: "The Challenge"] Our Solution [after: "Key Benefits"]') */
  nearbyText?: string;
  /** Accessibility attributes summary (e.g. 'role="heading", focusable') */
  accessibility?: string;
  /** Visible viewport line range (used only by text-based modes like Doc) */
  viewport?: { startLine: number; endLine: number; heading?: string };
  /** Annotations (annotate mode) — multiple selected elements with user feedback */
  annotations?: {
    slideFile: string;
    element: { type: string; content: string; selector?: string; label?: string; tag?: string; classes?: string; nearbyText?: string; accessibility?: string; thumbnail?: string };
    comment: string;
  }[];
}

// ── File Workspace Model ───────────────────────────────────────────────────

/** Workspace item — a logical unit in the file navigation model */
export interface WorkspaceItem {
  path: string;
  label: string;
  index?: number;
  metadata?: Record<string, unknown>;
}

/** Content set traits — parsed from directory name or explicitly declared */
export interface ContentSetTraits {
  /** BCP-47 locale code, e.g. "en", "ja" */
  locale?: string;
  /** Color scheme preference */
  theme?: "light" | "dark";
  /** Mode-specific custom traits */
  custom?: Record<string, string>;
}

/** Content set — a complete editable content unit in the workspace (corresponds to a top-level directory) */
export interface ContentSet {
  /** Directory prefix (without trailing /), e.g. "en-dark" */
  prefix: string;
  /** Display name, e.g. "EN Dark" */
  label: string;
  /** Parsed traits */
  traits: ContentSetTraits;
}

/**
 * File workspace model — describes how the Viewer organizes files.
 *
 * - "all": all matching files displayed equally (Doc: each .md is independent)
 * - "manifest": structure and order defined by an index file (Slide: manifest.json)
 * - "single": operates on a single main file (Draw: single .excalidraw)
 */
export interface FileWorkspaceModel {
  type: "all" | "manifest" | "single";
  multiFile: boolean;
  ordered: boolean;
  hasActiveFile: boolean;
  /** Index file when type="manifest" */
  manifestFile?: string;
  /** Resolve workspace items from the file list (used at frontend runtime) */
  resolveItems?: (files: ViewerFileContent[]) => WorkspaceItem[];
  /** Discover content sets from the file list (e.g. multi-locale/multi-theme directories) */
  resolveContentSets?: (files: ViewerFileContent[]) => ContentSet[];
  /** Whether workspace items appear in TopBar when no content sets exist.
   *  true → framework renders item selector in TopBar, driving activeFile.
   *  false/undefined → viewer handles file navigation itself (e.g. SlideNavigator). */
  topBarNavigation?: boolean;
  /** Generate an empty new content item (used with scaffold/clear).
   *  Returns files to write to disk; the framework writes them via /api/workspace/scaffold.
   *  Returns null if this mode does not support creation. */
  createEmpty?: (files: ViewerFileContent[]) => { path: string; content: string }[] | null;
}

// ── Viewer Action (Agent → Viewer capability alignment) ──────────────────────

/** Viewer action parameter descriptor */
export interface ViewerActionParam {
  /** `"object"` — a structured value such as a ViewerAddress passed as JSON. */
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required?: boolean;
}

/**
 * Viewer action descriptor — Agent → Viewer direction.
 *
 * The Viewer declares its supported actions; the Agent invokes them via the execution channel.
 * Whether it's "navigate to page 3", "collapse outline", or "capture current viewport",
 * from the framework's perspective they are all actions.
 */
export interface ViewerActionDescriptor {
  id: string;
  label: string;
  category: "file" | "navigate" | "ui" | "custom";
  agentInvocable: boolean;
  params?: Record<string, ViewerActionParam>;
  description?: string;
}

// ── Viewer Command (User → Agent commands) ──────────────────────────────────

/**
 * Viewer command descriptor — User → Agent direction.
 *
 * A Mode declares commands available in the UI; when the user clicks one, it is sent to the Agent via onNotifyAgent.
 * This is the reverse direction of ViewerAction: Actions are Agent requesting Viewer to perform operations,
 * Commands are user triggering Agent tasks through the Viewer UI.
 */
export interface ViewerCommandDescriptor {
  id: string;
  label: string;
  description?: string;
}

/** Action request in the execution channel */
export interface ViewerActionRequest {
  requestId: string;
  actionId: string;
  params?: Record<string, unknown>;
}

/** Action result */
export interface ViewerActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// ── Viewer Notification (Viewer → Agent proactive channel) ────────────────

/** Notification proactively sent from the Viewer to the Agent */
export interface ViewerNotification {
  /** Notification type identifier, e.g. "contentFitCheck" */
  type: string;
  /** Notification content, sent to the Agent as a system message */
  message: string;
  /** Severity level — info is logged only, warning is sent to the agent */
  severity: "info" | "warning";
  /** User-facing short summary (one sentence, for UI display) */
  summary?: string;
  /**
   * Notification types to remove from the pending queue before this one is
   * added. Use this when the underlying condition that prompted an earlier
   * notification has been resolved — e.g. a successful recompile cancels
   * a still-queued "compilation-error". If `severity` is "info" and
   * `replaces` is non-empty, the queue treats this as a pure clear signal
   * — it removes the listed types and does NOT queue this notification.
   */
  replaces?: string[];
}

// ── Viewer Locator (navigable link cards in agent messages) ────────────────

/** Viewer locator — clickable navigation cards embedded in agent messages.
 *  Clicking navigates the viewer to the target address (frontend-only, no server roundtrip). */
export interface ViewerLocator {
  /** Card display text */
  label: string;
  /** Mode-defined target address — the owning viewer resolves it. See ViewerAddress. */
  address: ViewerAddress;
}

// ── Preview Props & Contract ───────────────────────────────────────────────

/** Props for the preview component */
export interface ViewerPreviewProps {
  /**
   * Source map. Keys come from `manifest.sources` (or the synthesized
   * default `{ files: file-glob }` for unmigrated modes). Viewers
   * consume sources via the `useSource` hook from src/hooks/useSource.ts.
   * Each Source<T> delivers typed, origin-tagged events and, for
   * write-capable providers, exposes a write() method.
   */
  sources: Record<string, Source<unknown>>;

  /**
   * Direct file I/O channel for viewers with dynamic write targets
   * (e.g., a text editor where the active file is user-selected).
   * Writes through this channel are origin-tagged server-side
   * identically to Source.write() — viewers do not need to maintain
   * echo-detection state. Viewers with a static, declared write target
   * should use a `json-file` source in their manifest instead.
   */
  fileChannel: FileChannel;
  /**
   * @deprecated Backward-compat snapshot of the current workspace
   * files, kept around for viewers authored against the pre-2.29
   * `ViewerPreviewProps` contract. The current contract reads files
   * through `sources` + `useSource(...)` so viewers get typed,
   * origin-tagged events instead of an opaque array — see
   * docs/migration/2.29-source-abstraction.md for the migration
   * guide. New viewers should NOT use this field. It exists only so
   * existing external modes don't crash; it will be removed in a
   * future major version.
   */
  files?: ViewerFileContent[];
  /** Currently selected element */
  selection: ViewerSelectionContext | null;
  /** Selection callback */
  onSelect: (selection: ViewerSelectionContext | null) => void;
  /** Preview mode: view (read-only) / edit (inline editing) / select (selection capture) / annotate (annotation) */
  mode: "view" | "edit" | "select" | "annotate";
  /** Content version number (incremented on file changes, used for cache invalidation) — optional, some Viewers don't need it */
  contentVersion?: number;
  /** Image version number (incremented on image changes, used for image cache invalidation) */
  imageVersion: number;
  /** Mode init parameters (immutable, fixed for the session lifetime) */
  initParams?: Record<string, number | string>;
  /** Callback when the currently viewed file changes (used to track active file context) */
  onActiveFileChange?: (file: string | null) => void;
  /** Computed by the runtime via workspace.resolveItems and passed in */
  workspaceItems?: WorkspaceItem[];
  /** Action request dispatched by the runtime; Viewer calls onActionResult after execution */
  actionRequest?: ViewerActionRequest | null;
  /** Callback for the Viewer to return action results */
  onActionResult?: (requestId: string, result: ViewerActionResult) => void;
  /** Viewport change callback — Viewer reports its current visible range */
  onViewportChange?: (viewport: { file: string; startLine: number; endLine: number; heading?: string }) => void;
  /** Proactively send notifications from the Viewer to the Agent (e.g. self-check results, state changes) */
  onNotifyAgent?: (notification: ViewerNotification) => void;
  /** Currently active file selected by the framework (store.activeFile) */
  activeFile?: string | null;
  /** Navigation request — triggered by clicking a locator card in chat */
  navigateRequest?: ViewerLocator | null;
  /** Called after the Viewer completes navigation, clears the request */
  onNavigateComplete?: () => void;
  /** Viewer commands declared in the manifest (user → agent) — injected by the runtime from the manifest, used by the viewer to render command menus, etc. */
  commands?: ViewerCommandDescriptor[];
  /** When true, viewer should suppress editing, selection, and annotation modes.
   *  Used during replay mode. Each mode implements its own readonly behavior. */
  readonly?: boolean;
  /** Whether the session is in editing mode.
   *  true (default): all editing interactions enabled — drag, resize, select, etc.
   *  false: editing UI hidden/locked, content-internal interactions preserved.
   *  Distinct from `readonly` which disables ALL interactions (replay). */
  editing?: boolean;
  /**
   * Resolved color-scheme preference for this user's Pneuma surface.
   *
   * `"system"` is collapsed by the runtime — viewers always see a concrete
   * `"light"` | `"dark"`. Reactive: when the user flips the theme toggle
   * in the launcher, this prop changes and the viewer re-renders. Use it
   * to swap viewer-internal chrome (toolbar surfaces, axis labels, paper
   * texture) so the runtime shell and the content viewer agree visually.
   *
   * Distinct from `ContentSetTraits.theme` — that lives in the FILE
   * workspace (e.g. picking `zh-dark/` vs `en-light/` directory), this is
   * the USER's surface preference. Both can coexist: a user reading a
   * `zh-dark` deck may still have the surrounding chrome in light mode.
   */
  theme: "light" | "dark";
  /**
   * Resolved locale code (lowercase, language-only — `"en"`, `"ja"`,
   * `"zh"`). Comes from `~/.pneuma/settings.json` if the user picked one
   * explicitly, else from `navigator.language`. Reactive.
   *
   * Viewers can use this to localize their own UI (tooltip text, axis
   * labels, menu items) when the runtime's i18n catalogs don't cover
   * viewer-internal strings. The full BCP-47 form and the fallback
   * chain live in `useSystemPreferences()` — viewers that need region
   * granularity should reach for that hook directly.
   */
  locale: string;
}

/** UI contract for the content viewer */
export interface ViewerContract {
  /** Preview component — React component that renders the content */
  PreviewComponent: ComponentType<ViewerPreviewProps>;

  /**
   * Extract context text from the user's selection state.
   * The returned text is injected as a prefix into user_message,
   * letting the Agent understand the user's current visual focus.
   *
   * @param selection Currently selected element (null means no selection)
   * @param files Current workspace file list
   * @returns Context text (empty string means no context)
   */
  extractContext(
    selection: ViewerSelectionContext | null,
    files: ViewerFileContent[],
  ): string;

  /** Update strategy on file changes */
  updateStrategy: "full-reload" | "incremental";

  /** File workspace model — describes how the Viewer organizes files */
  workspace?: FileWorkspaceModel;

  /** Viewer-supported actions — Agent can invoke via the execution channel */
  actions?: ViewerActionDescriptor[];

  /** Capture current viewport screenshot (optional, dynamically injected by PreviewComponent after mount) */
  captureViewport?: () => Promise<{ data: string; media_type: string } | null>;
}
