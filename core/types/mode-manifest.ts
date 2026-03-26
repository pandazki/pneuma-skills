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
  /** Content snippet injected into CLAUDE.md (excluding marker comments) */
  claudeMdSection: string;
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
}

/** Content viewer config — describes the Mode's file watching and serving rules */
export interface ViewerConfig {
  /** Glob patterns for file watching (e.g. ["**\/*.md"]) */
  watchPatterns: string[];
  /** Glob patterns to ignore (e.g. ["node_modules/**"]) */
  ignorePatterns: string[];
  /** Subdirectory to serve via HTTP (relative to workspace, defaults to ".") */
  serveDir?: string;
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
  /** Parameter type */
  type: "number" | "string";
  /** Default value */
  defaultValue: number | string;
  /** Mark as sensitive value (API keys, etc.), cleared during snapshot packaging */
  sensitive?: boolean;
}

/** Workspace initialization config — describes initialization behavior for empty workspaces */
export interface InitConfig {
  /**
   * Glob pattern to check if the workspace has content.
   * If at least one non-empty file matches, seed files are skipped.
   */
  contentCheckPattern?: string;
  /**
   * Seed files for an empty workspace.
   * key: target relative path (relative to workspace)
   * value: source file relative path (relative to project root)
   */
  seedFiles?: Record<string, string>;
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
    params?: Record<string, { type: "string" | "number" | "boolean"; description: string; required?: boolean }>;
    description?: string;
  }>;
  /** User → Agent commands — commands triggerable from the viewer UI, sent to the agent when clicked */
  commands?: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  /** Locator cards — clickable navigation targets in agent messages.
   *  When set, instructions for `<viewer-locator>` tags are injected into CLAUDE.md. */
  locatorDescription?: string;
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
  /** Feature title (e.g. "Responsive Preview") */
  title: string;
  /** Short description (1-2 sentences) */
  description: string;
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
  /** Short tagline shown under the mode name (e.g. "17 AI design commands") */
  tagline?: string;
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
  /** Human-readable display name (e.g. "Document") */
  displayName: string;
  /** Short description */
  description: string;
  /** Mode icon as inline SVG string (e.g. `<svg viewBox="0 0 24 24">...</svg>`) */
  icon?: string;

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
  /** Reverse proxy routes — forwards /proxy/<name>/* to external APIs, avoiding CORS */
  proxy?: Record<string, ProxyRoute>;
}
