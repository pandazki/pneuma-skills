/**
 * ModeManifest — Capability Declaration Protocol
 *
 * Declarative description of a Mode, defining its complete configuration.
 * Provided by the Mode package; read by the Runtime Shell to drive the startup flow.
 *
 * @example
 * ```typescript
 * const manifest: ModeManifest = {
 *   name: "doc",
 *   version: "0.5.0",
 *   displayName: "Document",
 *   description: "Markdown document editing with live preview",
 *   skill: { ... },
 *   viewer: { ... },
 * };
 * ```
 */

import type { SourceDescriptor } from "./source.js";

/**
 * Localized string — either a plain English string (backwards compatible)
 * or an object keyed by locale. Unknown locales fall back to `en`, then to
 * the first available value. Use `resolveLocalized()` to convert at read
 * time; never compare LocalizedString values directly.
 */
export type LocalizedString = string | LocalizedStringMap;

export interface LocalizedStringMap {
  en: string;
  "zh-CN"?: string;
  "zh-TW"?: string;
  ja?: string;
  ko?: string;
  es?: string;
  de?: string;
  /** Allow forward-compatible additional locales without a type-check failure. */
  [locale: string]: string | undefined;
}

/**
 * Pick a value from a LocalizedString by locale, with fallback order:
 * exact match → "en" → first available string. Returns empty string only
 * when the input is completely empty.
 */
export function resolveLocalized(value: LocalizedString | undefined, locale: string = "en"): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value[locale]) return value[locale]!;
  if (value.en) return value.en;
  for (const v of Object.values(value)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

/** MCP server declaration — automatically registered to the workspace's .mcp.json during skill installation */
export interface McpServerConfig {
  /** Server name (key under mcpServers in .mcp.json) */
  name: string;
  /** stdio: command to execute */
  command?: string;
  /** stdio: command arguments (supports {{param}} templates) */
  args?: string[];
  /**
   * Environment variables. Values support:
   * - {{param}} — replaced with init param value
   * - ${VAR} — written as-is, resolved from process env at Claude Code runtime
   */
  env?: Record<string, string>;
  /** HTTP server URL */
  url?: string;
  /** HTTP headers (supports {{param}} templates) */
  headers?: Record<string, string>;
}

/** External skill dependency declaration — automatically copied to .claude/skills/ during skill installation */
export interface SkillDependency {
  /** Skill name (installed to .claude/skills/<name>/) */
  name: string;
  /** Skill source: path relative to mode package root (directory containing SKILL.md) */
  sourceDir: string;
  /**
   * Description snippet injected into CLAUDE.md (optional).
   * Placed inside <!-- pneuma:skills:start --> / <!-- pneuma:skills:end --> markers.
   * If not provided, a summary is automatically extracted from the first heading of SKILL.md.
   */
  claudeMdSnippet?: string;
}

/** Skill injection config — describes how to install a Mode's domain knowledge into the workspace */
export interface SkillConfig {
  /** Skill source directory (relative to mode package root) */
  sourceDir: string;
  /** Directory name under .claude/skills/ (e.g. "pneuma-doc") */
  installName: string;
  /**
   * Short scene-setting paragraph (1–3 sentences) for the `pneuma:start` block
   * in CLAUDE.md / AGENTS.md. Describes what the user and the agent are doing
   * together in this mode — not a system prompt or rule list. The installer
   * wraps it in a templated header that already names the mode, runtime shell,
   * and backend; the scene paragraph adds the human-shaped context.
   *
   * Mode-specific architecture, file conventions, and workflows do NOT belong
   * here — they live in the mode's SKILL.md and load via progressive disclosure.
   *
   * If omitted, the installer falls back to a generic scene built from
   * displayName + description.
   */
  mdScene?: string;
  /**
   * @deprecated Use `mdScene` for the scene paragraph and put the rest in
   * the mode's `SKILL.md`. Retained as optional during migration; treated as
   * an additional source of scene text if `mdScene` is missing.
   */
  claudeMdSection?: string;
  /**
   * Environment variable file mapping — automatically generates .env during skill installation.
   * key: environment variable name (e.g. "OPENROUTER_API_KEY")
   * value: corresponding init param name (e.g. "openrouterApiKey")
   * Only params with non-empty values are written to .env.
   */
  envMapping?: Record<string, string>;
  /** MCP server declarations — automatically written to workspace's .mcp.json during installation */
  mcpServers?: McpServerConfig[];
  /** External skill dependencies — automatically copied to .claude/skills/ during installation */
  skillDependencies?: SkillDependency[];
  /**
   * Shared script filenames from `modes/_shared/scripts/` to copy into this
   * mode's installed skill `scripts/` directory at install time.
   *
   * Use this when multiple modes reach for the same underlying tool (image
   * generation, etc.) but each mode owns its own SKILL.md guidance about
   * when and how to use it. The script source lives in exactly one place;
   * each mode sees it as a local script at `{SKILL_PATH}/scripts/<file>`.
   *
   * Example: ["generate_image.mjs", "edit_image.mjs"].
   */
  sharedScripts?: string[];
}

/** Content viewer config — describes the Mode's file watching and serving rules */
export interface ViewerConfig {
  /** Glob patterns for file watching (e.g. ["**\/*.md"]) */
  watchPatterns: string[];
  /** Glob patterns to ignore (e.g. ["node_modules/**"]) */
  ignorePatterns: string[];
  /** Subdirectory to serve via HTTP (relative to workspace, defaults to ".") */
  serveDir?: string;
  /**
   * Refresh strategy for the viewer:
   * - "auto" (default): file changes trigger immediate browser re-render
   * - "manual": file changes are queued; viewer re-renders only on explicit refresh
   *   (useful for video/media editing where auto-refresh causes flicker)
   */
  refreshStrategy?: "auto" | "manual";
}

/** Agent preferences — describes the Mode's expectations for Agent behavior */
export interface AgentPreferences {
  /** Permission mode (defaults to "bypassPermissions") */
  permissionMode?: string;
  /** Greeting template for new sessions (Agent generates a response) */
  greeting?: string;
}

/** Mode init parameter declaration — interactively prompted on first launch */
export interface InitParam {
  /** Parameter name, also used as template placeholder key (e.g. "slideWidth") */
  name: string;
  /** Display label for interactive prompt (e.g. "Slide width") */
  label: string;
  /** Additional description (e.g. "pixels") */
  description?: string;
  /** Parameter type. "select" requires `options` to be set. */
  type: "number" | "string" | "select";
  /** Required when type === "select". List of string choices shown to the user. */
  options?: string[];
  /** Default value. For "select", must be one of `options`. */
  defaultValue: number | string;
  /** Mark as sensitive value (API keys, etc.), cleared during snapshot packaging */
  sensitive?: boolean;
}

/**
 * Seed gallery card — rich metadata for a single user-selectable seed,
 * displayed in the empty-state gallery shown when a session opens with
 * no agent-authored content.
 *
 * Each descriptor's `sourceKey` must match a key in
 * `InitConfig.seedFiles`. Selecting a card triggers the same locale
 * resolution + template substitution + copy that the legacy auto-seed
 * path performed, but limited to that one entry.
 */
export interface SeedDescriptor {
  /** Stable id; used for routing, telemetry, and persisting "last picked" preferences. */
  id: string;
  /**
   * Key (or keys) into `InitConfig.seedFiles`. A single string matches
   * one `seedFiles` entry. An array applies every listed entry in
   * order — use this for "compound" seeds whose contents are stored as
   * multiple sibling entries (e.g. a project.json plus an assets/
   * dump that mustn't pull in the surrounding seed/ scratch dirs).
   * The runtime drops a descriptor on load if any of its referenced
   * keys is missing from `seedFiles`.
   */
  sourceKey: string | string[];
  /** Card title. */
  displayName: LocalizedString;
  /** Short blurb shown under the title (1–2 sentences). */
  description?: LocalizedString;
  /**
   * Thumbnail file path relative to `<modeRoot>/seed-gallery/` —
   * just the filename in the common case (e.g. `en-dark.png`).
   * Subdirectories under `seed-gallery/` are allowed
   * (`<theme>/cover.png`) for modes that want to organise variants.
   * When omitted the gallery falls back to a typographic card.
   */
  thumbnail?: string;
  /** Optional category chips ("dark", "EN", etc.) shown on the card. */
  tags?: string[];
}

/** Workspace initialization config — describes initialization behavior for empty workspaces */
export interface InitConfig {
  /**
   * Glob pattern to check if the workspace has content. Used by both
   * the legacy auto-seed path (pre-gallery) and the empty-state gallery
   * trigger: when no file matching this pattern carries non-empty text,
   * the workspace is considered "empty" and the gallery is shown.
   */
  contentCheckPattern?: string;
  /**
   * Seed file mapping.
   * key: source path relative to the mode package root (or project root for builtins).
   * value: target path relative to the workspace.
   *
   * Since 3.14.0 the auto-copy at session boot was removed; the gallery
   * triggers individual entries here by name. This field stays the
   * canonical list of "what files belong to which seed"; `init.seeds`
   * supplies the user-facing card metadata.
   */
  seedFiles?: Record<string, string>;
  /**
   * Seed gallery cards — one per user-selectable seed. Each card's
   * `sourceKey` points at an entry in `seedFiles`.
   *
   * When omitted but `seedFiles` is non-empty, the runtime auto-derives
   * a minimal descriptor per entry (id = seedFiles key, displayName =
   * path-derived). Authoring this field explicitly is the way to
   * surface multiple variants (e.g. slide's en-dark / en-light /
   * zh-dark / zh-light) as four distinct cards.
   */
  seeds?: SeedDescriptor[];
  /**
   * Mode init parameters. Interactively prompted on first launch; results persisted to .pneuma/config.json.
   * Parameter values are injected into skill and seed files via {{name}} template substitution.
   */
  params?: InitParam[];
  /**
   * Derive additional parameters from user-provided ones.
   * Called after interactive parameter collection but before template substitution.
   * Used to compute conditional variables (e.g. imageGenEnabled) and other derived values.
   */
  deriveParams?: (params: Record<string, number | string>) => Record<string, number | string>;
}

/** Viewer self-describing API — pure data declaration, readable by backend (pneuma.ts / skill-installer) */
export interface ViewerApiConfig {
  workspace?: {
    type: "all" | "manifest" | "single";
    multiFile: boolean;
    ordered: boolean;
    hasActiveFile: boolean;
    manifestFile?: string;
    /** If true, the workspace supports multiple content sets (e.g. locale/theme directories) */
    supportsContentSets?: boolean;
  };
  /** Agent → Viewer actions — operations the agent can request the viewer to perform (navigation, zoom, etc.) */
  actions?: Array<{
    id: string;
    label: string;
    category: "file" | "navigate" | "ui" | "custom";
    agentInvocable: boolean;
    params?: Record<string, { type: "string" | "number" | "boolean" | "object"; description: string; required?: boolean }>;
    description?: string;
  }>;
  /** User → Agent commands — commands triggerable from the viewer UI, sent to the agent when clicked */
  commands?: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  /** Scaffold — workspace initialization/reset capability. Requires user confirmation in browser. */
  scaffold?: {
    description: string;
    params: Record<string, { type: "string" | "number" | "boolean"; description: string; required?: boolean }>;
    clearPatterns: string[];
  };
}

/**
 * Skill evolution config — defines the Evolution Agent's target direction and available tools.
 *
 * The Evolution Agent is a separate agent process that analyzes user history and augments skill files.
 * It outputs a proposal (with evidence and citations) that the user can review, then apply or discard.
 */
export interface EvolutionConfig {
  /**
   * Evolution directive — target description for the Evolution Agent.
   * Tells the agent what direction this Mode's skill should be personalized toward.
   *
   * @example
   * "Learn the user's presentation style preferences: typography choices,
   *  color palette tendencies, layout density, slide structure patterns.
   *  Augment the skill to guide the main agent toward these preferences
   *  as defaults while respecting explicit user instructions."
   */
  directive: string;

  /**
   * Additional data-fetching tools (reserved, not implemented in v1).
   * The framework provides built-in tools (e.g. reading CC history); declare Mode-specific ones here.
   */
  tools?: EvolutionTool[];
}

/**
 * External data-fetching tools available to the Evolution Agent (reserved).
 * Not implemented in v1; built-in framework tools are sufficient.
 */
export interface EvolutionTool {
  /** Tool name */
  name: string;
  /** Tool description (shown to the Agent) */
  description: string;
  /** Implementation type */
  type: "command" | "http" | "mcp";
  /** Specific configuration */
  config: Record<string, unknown>;
}

/** Showcase highlight — a single feature to display in the carousel */
export interface ShowcaseHighlight {
  /** Feature title (e.g. "Responsive Preview"). Accepts a plain string or a per-locale map. */
  title: LocalizedString;
  /** Short description (1-2 sentences). Accepts a plain string or a per-locale map. */
  description: LocalizedString;
  /** Media file path relative to showcase/ directory */
  media: string;
  /** Media type — determines rendering (default: "image") */
  mediaType?: "image" | "gif" | "video";
}

/**
 * Mode showcase configuration — rich marketing content for the launcher gallery.
 * Assets are stored in the mode's `showcase/` directory and served via
 * `GET /api/modes/:name/showcase/*`.
 */
export interface ModeShowcase {
  /** Short tagline shown under the mode name (e.g. "17 AI design commands"). Accepts a plain string or a per-locale map. */
  tagline?: LocalizedString;
  /** Hero image path relative to showcase/ directory (16:9 recommended) */
  hero?: string;
  /** Feature highlights — displayed as a carousel with hover-to-switch */
  highlights?: ShowcaseHighlight[];
}

/** Reverse proxy route — forwards /proxy/<name>/* to target, avoiding CORS in viewer code */
export interface ProxyRoute {
  /** Target base URL (e.g. "https://api.github.com") */
  target: string;
  /** Additional request headers. Values support {{ENV_VAR}} template syntax resolved from process.env at request time. */
  headers?: Record<string, string>;
  /** Allowed HTTP methods (default: ["GET"]) */
  methods?: string[];
  /** Human-readable description (injected into CLAUDE.md for agent awareness) */
  description?: string;
}

/** Complete declarative description of a Mode */
export interface ModeManifest {
  /** Unique Mode identifier (e.g. "doc", "slide") */
  name: string;
  /** Semantic version number */
  version: string;
  /**
   * Per-version highlights surfaced in the skill-update prompt. Keys are
   * semver strings, values are short bullet points (one line each, no
   * markdown). When a workspace's installed skill version differs from
   * the current one, the launcher concatenates bullets for each version
   * strictly greater than installed and ≤ current, newest first.
   *
   * Long history belongs in the project CHANGELOG; keep entries here to
   * user-visible improvements since the last skill release.
   */
  changelog?: Record<string, string[]>;
  /** Human-readable display name (e.g. "Document"). Accepts a plain string or a per-locale map. */
  displayName: LocalizedString;
  /** Short description. Accepts a plain string or a per-locale map. */
  description: LocalizedString;
  /** Mode icon as inline SVG string (e.g. `<svg viewBox="0 0 24 24">...</svg>`) */
  icon?: string;

  /**
   * Internal mode — never offered as a user-pickable option.
   *
   * Hidden from every UI surface that lists modes for human selection
   * (launcher's Built-in/Local/Published mode grids, ProjectPanel's mode
   * picker, anywhere else a "what mode would you like to start?" choice
   * is rendered). Such modes can still be launched programmatically —
   * via specific UI affordances (the project chip's Evolve sparkle, the
   * project-onboard auto-trigger), via Smart Handoff target resolution,
   * or via direct CLI invocation. Triggers are explicit and named; the
   * mode's identity is preserved (it shows up in registry-of-record APIs
   * like `/api/registry`), only the discoverability surface is gated.
   *
   * Used by `evolve`, `project-evolve`, and `project-onboard`. Treat as
   * an opt-in declaration — the default (omitted / false) lists the mode
   * everywhere as before.
   */
  hidden?: boolean;

  /** Skill injection config */
  skill: SkillConfig;
  /** Content viewer config */
  viewer: ViewerConfig;
  /** Agent preferences (optional) */
  agent?: AgentPreferences;
  /** Workspace initialization config (optional) */
  init?: InitConfig;
  /** Viewer self-describing API — pure data declaration, readable by backend, auto-injected into CLAUDE.md */
  viewerApi?: ViewerApiConfig;
  /** Skill evolution config — defines the Evolution Agent's direction (optional) */
  evolution?: EvolutionConfig;
  /** Showcase — rich marketing content for launcher gallery (optional) */
  showcase?: ModeShowcase;
  /** Supported agent backends. When omitted, all implemented backends are allowed. */
  supportedBackends?: string[];

  /**
   * Pneuma runtime version range this mode supports (semver range, e.g.
   * `"^3.8.0"`, `">=3.7.0 <4.0.0"`). The launcher compares against the
   * running pneuma-skills version to mark incompatible modes in the
   * gallery. Omit when authoring against a single in-tree runtime; declare
   * it for any external/library-distributed mode so consumers can see
   * compatibility status without launching.
   */
  pneumaVersion?: string;

  /** Attribution — credit the project or person that inspired this mode (optional) */
  inspiredBy?: {
    /** Display name (e.g. "troyhua/claude-code-remotion") */
    name: string;
    /** URL to the source (GitHub, X/Twitter, website, etc.) */
    url: string;
  };

  /** Layout: "editor" = dual panel (default), "app" = fullscreen Viewer + floating Agent bubble */
  layout?: "editor" | "app";
  /** Window size preference (app layout + Electron) */
  window?: { width: number; height: number };
  /** Opt-in to editing state switching. When declared, the mode supports toggling
   *  between editing (creating) and viewing (consuming) states. */
  editing?: { supported: true };
  /** Reverse proxy routes — forwards /proxy/<name>/* to external APIs, avoiding CORS */
  proxy?: Record<string, ProxyRoute>;

  /**
   * Declarative data-channel configuration. Each entry instantiates a
   * Source<T> via the SourceRegistry at mode startup and exposes it to
   * the viewer as props.sources[id].
   *
   * REQUIRED since pneuma-skills 2.29.0 — `SourceRegistry.effectiveSources`
   * throws a migration error when this field is absent. Modes with no
   * viewer (headless agent-only, like evolve) should declare `sources: {}`
   * to opt out explicitly.
   *
   * Typical minimal declaration for a file-list viewer:
   *
   *   sources: {
   *     files: {
   *       kind: "file-glob",
   *       config: { patterns: ["**\/*.md"] },
   *     },
   *   }
   *
   * See core/types/source.ts for the SourceDescriptor shape and the
   * built-in provider kinds (file-glob, json-file, aggregate-file, memory).
   *
   * The field is typed as optional at the type level for pre-2.29
   * compatibility at the TypeScript boundary, but the runtime rejects
   * omissions — treat it as required when authoring a new manifest.
   */
  sources?: Record<string, SourceDescriptor>;
}
