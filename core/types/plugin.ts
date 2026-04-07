/**
 * PluginManifest — Plugin Capability Declaration
 *
 * Declarative description of a Plugin's capabilities.
 * Read by PluginRegistry to drive discovery, loading, and activation.
 */

// ── Hook Names ──────────────────────────────────────────────────────────────

export type HookName =
  | "deploy:providers"
  | "deploy:before"
  | "deploy:after"
  | "session:start"
  | "session:end"
  | "export:before"
  | "export:after"
  | "preferences:build";

// ── Slot Names ──────────────────────────────────────────────────────────────

export type SlotName =
  | "deploy:provider"
  | "deploy:pre-publish"
  | "deploy:post-result"
  | "settings:section";

// ── Form Fields ─────────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  label: string;
  type: "text" | "password" | "select" | "checkbox" | "textarea";
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  description?: string;
}

export interface FormSlotDeclaration {
  type: "form";
  fields: FormField[];
}

export type SlotDeclaration = string | FormSlotDeclaration;

// ── Setting Fields ──────────────────────────────────────────────────────────

export interface SettingField {
  type: "string" | "password" | "number" | "boolean" | "select" | "textarea";
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
}

// ── Plugin Manifest ─────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique plugin identifier, e.g. "vercel-deploy" */
  name: string;
  version: string;
  displayName: string;
  description: string;
  /** True for pre-installed plugins shipped with Pneuma */
  builtin?: boolean;
  /** Default enabled state for builtin plugins (default: true). Set false to ship disabled. */
  defaultEnabled?: boolean;

  /** "global" = all sessions; "mode" = only matching modes */
  scope: "global" | "mode";
  /** When scope is "mode", which modes this plugin supports. Omit = all modes. */
  compatibleModes?: string[];

  /** Data layer: hookName → relative path to handler module */
  hooks?: Partial<Record<HookName, string>>;

  /** UI layer: slotName → custom component path or declarative form */
  slots?: Partial<Record<SlotName, SlotDeclaration>>;

  /** Service layer: relative path to module exporting Hono sub-app factory */
  routes?: string;
  /** Route mount prefix. Default: /api/plugins/{name} */
  routePrefix?: string;

  /** Config layer: settings schema for auto-rendered settings UI */
  settings?: Record<string, SettingField>;

  /**
   * Plugin skill — relative path to a skill directory containing SKILL.md.
   * Installed to .claude/skills/{name}/ alongside mode skills.
   * This is the plugin's independent capability description for the agent.
   */
  skill?: string;

  /**
   * Register as a memory source in the preference system.
   * When true, the plugin's route prefix + MemorySource API endpoints
   * are listed in the preference skill's external sources section.
   */
  memorySource?: boolean;

  /** Lifecycle: relative path to activate(context) function */
  activate?: string;
  /** Lifecycle: relative path to deactivate() function */
  deactivate?: string;
}

// ── Hook Context ────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  mode: string;
  workspace: string;
  backendType: string;
}

export interface HookContext<T = unknown> {
  payload: T;
  plugin: { name: string };
  session: SessionInfo;
  settings: Record<string, unknown>;
}

export type HookHandler<T = unknown> = (
  context: HookContext<T>,
) => Promise<T | void> | T | void;

// ── Plugin Route Context ────────────────────────────────────────────────────

export interface DeployBinding {
  vercel?: Record<string, unknown>;
  cfPages?: Record<string, unknown>;
  [key: string]: Record<string, unknown> | undefined;
}

export interface PluginRouteContext {
  workspace: string;
  session: SessionInfo;
  settings: Record<string, unknown>;
  getDeployBinding(): DeployBinding;
  saveDeployBinding(binding: DeployBinding): void;
}

// ── Loaded Plugin ───────────────────────────────────────────────────────────

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory */
  basePath: string;
  hooks: Partial<Record<HookName, HookHandler>>;
  slots: Partial<Record<SlotName, SlotDeclaration>>;
  routes: ((ctx: PluginRouteContext) => unknown) | null;
}

// ── Settings Storage ────────────────────────────────────────────────────────

export interface PluginSettingsEntry {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginSettings {
  plugins: Record<string, PluginSettingsEntry>;
}

// ── Memory Source Protocol ──────────────────────────────────────────────────

/** A single memory entry returned by search or read */
export interface MemoryEntry {
  /** Unique path/identifier within the memory source (e.g. "projects/pneuma.md") */
  path: string;
  /** Human-readable title */
  title: string;
  /** Full content (markdown) — populated by read(), may be truncated in search results */
  content: string;
  /** When this entry was last modified */
  lastModified?: string;
  /** Tags/categories */
  tags?: string[];
}

/** Search result with relevance score */
export interface MemorySearchResult {
  entry: MemoryEntry;
  /** Relevance score 0-1 (higher = more relevant) */
  score?: number;
  /** Matched text snippet for context */
  snippet?: string;
}

/**
 * MemorySource — Standard protocol for external memory integrations.
 *
 * Plugins implement this interface to connect external knowledge stores
 * (Obsidian, Notion, local files, company wikis) to the Pneuma preference system.
 *
 * Used by:
 * - preferences:build hook → search + read to inject relevant context
 * - session:end hook → write to sync learnings back
 */
export interface MemorySource {
  /** Human-readable name of this memory source (e.g. "Obsidian Vault") */
  name: string;

  /** Check if the source is available (API reachable, vault accessible, etc.) */
  available(): Promise<boolean>;

  /**
   * Search for memory entries matching the given query.
   * @param query — Search keywords or natural language query
   * @param options.limit — Max results (default: 10)
   * @param options.tags — Filter by tags
   */
  search(query: string, options?: { limit?: number; tags?: string[] }): Promise<MemorySearchResult[]>;

  /**
   * Read the full content of a specific memory entry.
   * @param path — Entry path/identifier
   */
  read(path: string): Promise<MemoryEntry | null>;

  /**
   * Write (create or update) a memory entry.
   * @param path — Entry path/identifier
   * @param content — Markdown content
   * @param options.title — Optional title (derived from path if omitted)
   * @param options.tags — Optional tags
   */
  write(path: string, content: string, options?: { title?: string; tags?: string[] }): Promise<void>;
}
