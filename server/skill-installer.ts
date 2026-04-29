/**
 * Skill installer — copies mode-specific skill to the appropriate skills directory
 * (.claude/skills/ for Claude Code, .agents/skills/ for Codex) and
 * injects Pneuma configuration into CLAUDE.md / AGENTS.md.
 *
 * Parameterized by SkillConfig from ModeManifest — no hardcoded mode knowledge.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { homedir } from "node:os";
import type { SkillConfig, ViewerApiConfig, McpServerConfig, SkillDependency } from "../core/types/mode-manifest.js";
import { isProjectManifest, type ProjectManifest } from "../core/types/project-manifest.js";

/** Return the workspace-relative skills directory for a given backend. */
function skillsDir(backendType?: string): string {
  return backendType === "codex" ? join(".agents", "skills") : join(".claude", "skills");
}

/**
 * Resolve the absolute path where plugin skills should be installed for the
 * current session. Project sessions install under the per-session dir (which
 * is the agent's CWD); quick sessions install under the workspace root
 * (legacy 2.x layout). Mirrors the resolution `installSkill` uses for the
 * mode skill so plugin skills sit alongside it under the same `.claude/`
 * (or `.agents/`) tree.
 *
 * @param workspace — project root or quick-session workspace
 * @param sessionDir — per-session state dir for project sessions; undefined for quick
 * @param backendType — selects `.claude/skills` vs `.agents/skills`
 */
export function resolvePluginSkillsBase(
  workspace: string,
  sessionDir: string | undefined,
  backendType?: string,
): string {
  const root = sessionDir ?? workspace;
  return join(root, skillsDir(backendType));
}

/** Return the instructions filename for a given backend. */
function instructionsFile(backendType?: string): string {
  return backendType === "codex" ? "AGENTS.md" : "CLAUDE.md";
}

const PNEUMA_MARKER_START = "<!-- pneuma:start -->";
const PNEUMA_MARKER_END = "<!-- pneuma:end -->";
const VIEWER_API_MARKER_START = "<!-- pneuma:viewer-api:start -->";
const VIEWER_API_MARKER_END = "<!-- pneuma:viewer-api:end -->";
const SKILLS_MARKER_START = "<!-- pneuma:skills:start -->";
const SKILLS_MARKER_END = "<!-- pneuma:skills:end -->";
const PREFS_MARKER_START = "<!-- pneuma:preferences:start -->";
const PREFS_MARKER_END = "<!-- pneuma:preferences:end -->";
const PROJECT_MARKER_START = "<!-- pneuma:project:start -->";
const PROJECT_MARKER_END = "<!-- pneuma:project:end -->";
const PROJECT_ATLAS_MARKER_START = "<!-- pneuma:project-atlas:start -->";
const PROJECT_ATLAS_MARKER_END = "<!-- pneuma:project-atlas:end -->";
const HANDOFF_MARKER_START = "<!-- pneuma:handoff:start -->";
const HANDOFF_MARKER_END = "<!-- pneuma:handoff:end -->";

/**
 * Extract critical preferences from a preference file.
 * Returns trimmed content between <!-- pneuma-critical:start --> and <!-- pneuma-critical:end -->,
 * or null if file doesn't exist or has no critical section.
 */
export function extractPreferenceCritical(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(
      /<!-- pneuma-critical:start -->\s*([\s\S]*?)\s*<!-- pneuma-critical:end -->/
    );
    const extracted = match?.[1]?.trim();
    return extracted || null;
  } catch {
    return null;
  }
}

/** Escape a literal string for safe inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Synchronously load a project manifest from `<projectRoot>/.pneuma/project.json`.
 * Returns null if the file is missing, unparseable, or fails the type guard.
 *
 * Sync counterpart of `loadProjectManifest` in `core/project-loader.ts` — kept
 * local so `installSkill` can stay synchronous (the existing convention).
 */
function loadProjectManifestSync(projectRoot: string): ProjectManifest | null {
  const path = join(projectRoot, ".pneuma", "project.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return isProjectManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface ProjectSessionRefSync {
  sessionId: string;
  mode: string;
  sessionDir: string;
}

/**
 * Synchronously scan `<projectRoot>/.pneuma/sessions/*` and return entries that
 * have a valid `session.json`. Sync counterpart of `scanProjectSessions` in
 * `core/project-loader.ts`.
 */
function scanProjectSessionsSync(projectRoot: string): ProjectSessionRefSync[] {
  const sessionsDir = join(projectRoot, ".pneuma", "sessions");
  if (!existsSync(sessionsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const out: ProjectSessionRefSync[] = [];
  for (const id of entries) {
    const sessionDir = join(sessionsDir, id);
    const sessionJson = join(sessionDir, "session.json");
    if (!existsSync(sessionJson)) continue;
    try {
      const s = statSync(sessionDir);
      if (!s.isDirectory()) continue;
      const data = JSON.parse(readFileSync(sessionJson, "utf-8")) as {
        sessionId?: string;
        mode?: string;
      };
      if (typeof data.sessionId === "string" && typeof data.mode === "string") {
        out.push({ sessionId: data.sessionId, mode: data.mode, sessionDir });
      }
    } catch {
      // skip corrupt session
    }
  }
  return out;
}

export interface ProjectSectionInput {
  /** Absolute path to the project root (the workspace that owns `.pneuma/project.json`). */
  projectRoot: string;
  /** Current session id — filtered out when listing sibling sessions. */
  currentSessionId?: string;
  /** Current mode name (e.g. "doc"), used to pick `mode-{name}.md` preferences. */
  currentMode: string;
}

/**
 * Build the body of the `pneuma:project` section. Returns `null` when
 * `<projectRoot>/.pneuma/project.json` is missing or invalid — callers should
 * skip injection in that case.
 *
 * The body is a Markdown fragment containing:
 * - Heading with `displayName`
 * - Optional `description`
 * - Optional list of other sessions in the project (mode + sessionId)
 * - Optional "Project Preferences (Critical)" block extracted from
 *   `<projectRoot>/.pneuma/preferences/profile.md` and `mode-{name}.md`
 */
export function buildProjectSection(input: ProjectSectionInput): string | null {
  const manifest = loadProjectManifestSync(input.projectRoot);
  if (!manifest) return null;

  const lines: string[] = [];
  lines.push(`### Project: ${manifest.displayName}`);
  if (manifest.description) {
    lines.push("");
    lines.push(`**Description**: ${manifest.description}`);
  }

  const sessions = scanProjectSessionsSync(input.projectRoot);
  const others = sessions.filter((s) => s.sessionId !== input.currentSessionId);
  if (others.length > 0) {
    lines.push("");
    lines.push("**Other sessions in this project**:");
    for (const s of others) {
      lines.push(`- \`${s.mode}/${s.sessionId}\``);
    }
  }

  const profile = extractPreferenceCritical(
    join(input.projectRoot, ".pneuma", "preferences", "profile.md")
  );
  const modePref = extractPreferenceCritical(
    join(input.projectRoot, ".pneuma", "preferences", `mode-${input.currentMode}.md`)
  );

  if (profile || modePref) {
    lines.push("");
    lines.push("**Project Preferences (Critical)**:");
    if (profile) {
      lines.push("");
      lines.push("Global:");
      lines.push(profile);
    }
    if (modePref) {
      lines.push("");
      lines.push(`${input.currentMode} mode:`);
      lines.push(modePref);
    }
  }

  return lines.join("\n");
}

/**
 * Inject (or strip) the `pneuma:project` block in an instructions file string.
 *
 * - Always strips any existing `pneuma:project` block first, so re-installs are
 *   idempotent and stale blocks (e.g. project deletion) are removed.
 * - When `body` is null/empty, the result has no project block (quick sessions).
 * - When `body` is provided, the block is appended at the tail of the file
 *   wrapped in `<!-- pneuma:project:start -->` / `<!-- pneuma:project:end -->`.
 */
export function injectProjectSection(
  instructionsContent: string,
  body: string | null,
): string {
  // Strip any existing block first (idempotent re-install + stale cleanup).
  const stripped = instructionsContent.replace(
    new RegExp(
      `${escapeRegExp(PROJECT_MARKER_START)}[\\s\\S]*?${escapeRegExp(PROJECT_MARKER_END)}\\n?`,
      "g",
    ),
    "",
  );
  if (!body) return stripped;
  const block = `${PROJECT_MARKER_START}\n${body}\n${PROJECT_MARKER_END}\n`;
  return stripped.trimEnd() + "\n\n" + block;
}

/**
 * Build the pointer-style body for the `pneuma:project-atlas` block —
 * a small notice telling the agent the atlas exists and where to find
 * it, NOT the atlas contents. The agent reads `project-atlas.md` on
 * demand via its file tools.
 *
 * Inlining the full atlas (300-800 words by convention, sometimes more)
 * into every project session's CLAUDE.md would burn that text on every
 * turn whether the agent needs it or not. Pointer-style means the
 * prompt stays lean; the `pneuma-project` skill instructs the agent to
 * Read the atlas at session start when this block is present.
 *
 * Returns null when the atlas file is missing or empty — caller should
 * skip injection in that case so empty projects don't carry an
 * empty-pointer block.
 */
export function buildProjectAtlasPointer(projectRoot: string): string | null {
  const path = join(projectRoot, ".pneuma", "project-atlas.md");
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (stat.size === 0) return null;
  const updated = stat.mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
  const sizeKb = (stat.size / 1024).toFixed(1);
  const lines = [
    `A project briefing exists at \`$PNEUMA_PROJECT_ROOT/.pneuma/project-atlas.md\` — read it before starting work in this project.`,
    ``,
    `- Last updated: \`${updated}\``,
    `- Size: ${sizeKb}KB`,
    `- Maintained by the \`project-evolve\` mode (Project chip's Evolve sparkle).`,
    ``,
    `It encodes scope, audience, conventions, locked decisions, and open threads. Treat it as authoritative; consult it before re-asking the user. See the \`pneuma-project\` skill for the full atlas protocol.`,
  ];
  return lines.join("\n");
}

/**
 * Inject (or strip) the `pneuma:project-atlas` block. Mirrors
 * `injectProjectSection`: idempotent strip-then-append, null/empty body
 * just strips. The block carries a pointer to the atlas, not its
 * contents — see {@link buildProjectAtlasPointer}.
 */
export function injectProjectAtlasSection(
  instructionsContent: string,
  body: string | null,
): string {
  const stripped = instructionsContent.replace(
    new RegExp(
      `${escapeRegExp(PROJECT_ATLAS_MARKER_START)}[\\s\\S]*?${escapeRegExp(PROJECT_ATLAS_MARKER_END)}\\n?`,
      "g",
    ),
    "",
  );
  if (!body) return stripped;
  const block = `${PROJECT_ATLAS_MARKER_START}\n## Project Atlas\n\n${body}\n${PROJECT_ATLAS_MARKER_END}\n`;
  return stripped.trimEnd() + "\n\n" + block;
}

/**
 * Inbound handoff payload as written by the v2 confirm endpoint. Mirrors the
 * structured fields the `pneuma handoff` CLI accepts plus identity info for
 * the source session.
 */
export interface InboundHandoffPayload {
  handoff_id?: string;
  source_session_id?: string;
  source_mode?: string;
  source_display_name?: string;
  target_mode?: string;
  target_session?: string;
  intent?: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
  proposed_at?: number;
}

/**
 * Read the inbound handoff payload, if any, dropped at this session's
 * `.pneuma/inbound-handoff.json` by `/api/handoffs/:id/confirm` *before* the
 * target was spawned. The file's existence at session start is the agent's
 * "you got here via Smart Handoff" signal; the target agent reads + rms the
 * file on its first turn (per the `pneuma-project` skill).
 *
 * Returns null on missing / unreadable / malformed JSON — callers treat that
 * as "no inbound handoff".
 */
export function readInboundHandoff(sessionDir: string): InboundHandoffPayload | null {
  const path = join(sessionDir, ".pneuma", "inbound-handoff.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as InboundHandoffPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the body of the `pneuma:handoff` section from an inbound payload.
 * Mirrors the shape documented in `pneuma-project/SKILL.md`'s "Receiving a
 * handoff" section — the agent's skill expects this exact layout (header,
 * intent, summary, suggested files, decisions, open questions). Returns null
 * when there's no payload — callers should skip injection.
 */
export function buildHandoffSection(payload: InboundHandoffPayload | null): string | null {
  if (!payload) return null;
  const lines: string[] = [];

  const sourceMode = payload.source_mode ?? "unknown";
  const sourceLabel = payload.source_display_name
    ? `${payload.source_display_name} (${payload.source_session_id ?? "unknown"})`
    : payload.source_session_id ?? "unknown";
  lines.push(`**Inbound from ${sourceMode}** (session ${sourceLabel})`);
  lines.push("");

  if (payload.intent) {
    lines.push(`**Intent**: ${payload.intent}`);
    lines.push("");
  }
  if (payload.summary) {
    lines.push(`**Summary**: ${payload.summary}`);
    lines.push("");
  }
  if (payload.suggested_files?.length) {
    lines.push("**Suggested files** (read in order):");
    for (const f of payload.suggested_files) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (payload.key_decisions?.length) {
    lines.push("**Decisions already locked in**:");
    for (const d of payload.key_decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (payload.open_questions?.length) {
    lines.push("**Open questions**:");
    for (const q of payload.open_questions) lines.push(`- ${q}`);
    lines.push("");
  }
  lines.push(
    `Read suggested files in order, acknowledge in your first reply, then \`rm .pneuma/inbound-handoff.json\` and start the work.`,
  );
  return lines.join("\n").trimEnd();
}

/**
 * Inject (or strip) the `pneuma:handoff` block in an instructions file string.
 *
 * Mirrors {@link injectProjectSection}: always strips any existing block first
 * for idempotency, then appends the new block when `body` is provided. Quick /
 * non-project sessions pass `null` to ensure stale blocks are cleaned up.
 */
export function injectHandoffSection(
  instructionsContent: string,
  body: string | null,
): string {
  const stripped = instructionsContent.replace(
    new RegExp(
      `${escapeRegExp(HANDOFF_MARKER_START)}[\\s\\S]*?${escapeRegExp(HANDOFF_MARKER_END)}\\n?`,
      "g",
    ),
    "",
  );
  if (!body) return stripped;
  const block = `${HANDOFF_MARKER_START}\n${body}\n${HANDOFF_MARKER_END}\n`;
  return stripped.trimEnd() + "\n\n" + block;
}

export interface PreferencesBuildPayload {
  /** Global critical preferences — plugins append to this */
  globalCritical: string | null;
  /** Mode-specific critical preferences — plugins append to this */
  modeCritical: string | null;
  /** Mode name (e.g. "slide") */
  modeName: string;
}

/**
 * Build the preference section content and inject it into an instructions file string.
 * Pure string transform — reads preference files, formats the section, returns updated content.
 *
 * This is the single source of truth for preference section formatting.
 */
function injectPreferencesSection(
  content: string,
  installName: string,
  globalCritical?: string | null,
  modeCritical?: string | null,
): string {
  const prefModeName = installName.replace(/^pneuma-/, "");

  // If not provided, extract from preference files
  const gc = globalCritical !== undefined
    ? globalCritical
    : extractPreferenceCritical(join(homedir(), ".pneuma", "preferences", "profile.md"));
  const mc = modeCritical !== undefined
    ? modeCritical
    : extractPreferenceCritical(join(homedir(), ".pneuma", "preferences", `mode-${prefModeName}.md`));

  if (gc || mc) {
    const prefsLines: string[] = ["### User Preferences (Critical)", ""];
    if (gc) {
      prefsLines.push("**Global:**", gc, "");
    }
    if (mc) {
      prefsLines.push(`**${prefModeName} Mode:**`, mc);
    }
    const prefsSection = `${PREFS_MARKER_START}\n${prefsLines.join("\n")}\n${PREFS_MARKER_END}`;
    const pStart = content.indexOf(PREFS_MARKER_START);
    const pEnd = content.indexOf(PREFS_MARKER_END);
    if (pStart !== -1 && pEnd !== -1) {
      content = content.substring(0, pStart) + prefsSection + content.substring(pEnd + PREFS_MARKER_END.length);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) content += "\n";
      content += "\n" + prefsSection + "\n";
    }
  } else {
    // Remove stale preferences section
    const pStart = content.indexOf(PREFS_MARKER_START);
    const pEnd = content.indexOf(PREFS_MARKER_END);
    if (pStart !== -1 && pEnd !== -1) {
      content = content.substring(0, pStart) + content.substring(pEnd + PREFS_MARKER_END.length);
    }
  }

  return content;
}

/**
 * Build and inject preferences into the instructions file, optionally running
 * the preferences:build hook to let plugins enrich the data.
 *
 * This is the public entry point for preference enrichment. It:
 * 1. Reads the instructions file
 * 2. Extracts base preferences from ~/.pneuma/preferences/
 * 3. Runs the preferences:build hook (if hookBus provided) so plugins can enrich
 * 4. Writes back using the same marker format as installSkill
 *
 * Call this after plugin activation to integrate plugin data into the preference
 * lifecycle without duplicating formatting logic.
 */
export async function buildAndInjectPreferences(
  workspace: string,
  installName: string,
  backendType: string,
  hookBus: import("../core/hook-bus.js").HookBus,
  sessionInfo: import("../core/types/plugin.js").SessionInfo,
): Promise<void> {
  const instrFile = backendType === "codex" ? "AGENTS.md" : "CLAUDE.md";
  const instructionsPath = join(workspace, instrFile);

  let content: string;
  try {
    content = readFileSync(instructionsPath, "utf-8");
  } catch {
    return;
  }

  const prefModeName = installName.replace(/^pneuma-/, "");
  const prefsDir = join(homedir(), ".pneuma", "preferences");

  let globalCritical = extractPreferenceCritical(join(prefsDir, "profile.md"));
  let modeCritical = extractPreferenceCritical(join(prefsDir, `mode-${prefModeName}.md`));

  // Run preferences:build hook — plugins can enrich globalCritical / modeCritical
  const enriched = await hookBus.emit("preferences:build", {
    globalCritical,
    modeCritical,
    modeName: prefModeName,
  } satisfies PreferencesBuildPayload, sessionInfo);

  // Only rewrite if plugins actually changed something
  if (enriched.globalCritical === globalCritical && enriched.modeCritical === modeCritical) {
    return;
  }

  content = injectPreferencesSection(content, installName, enriched.globalCritical, enriched.modeCritical);
  writeFileSync(instructionsPath, content, "utf-8");
  console.log(`[skill-installer] Enriched preferences in ${instructionsPath}`);
}

/**
 * Create a preference file with empty scaffold markers if it doesn't exist.
 * If the file already exists, it is left untouched.
 */
function scaffoldPreferenceFile(filePath: string, title: string): void {
  if (existsSync(filePath)) return;
  const content = `# ${title}

<!-- pneuma-critical:start -->
<!-- pneuma-critical:end -->

<!-- changelog:start -->
## Changelog
<!-- changelog:end -->
`;
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Ensure \`.pneuma/\` is listed in the workspace's .gitignore.
 */
function ensureGitignore(workspace: string): void {
  const gitignorePath = join(workspace, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  if (!content.split("\n").some((line) => line.trim() === ".pneuma/" || line.trim() === ".pneuma")) {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += ".pneuma/\n";
    writeFileSync(gitignorePath, content, "utf-8");
    console.log(`[skill-installer] Added .pneuma/ to ${gitignorePath}`);
  }
}

/**
 * Replace template placeholders in content with param values.
 *
 * Supports two syntaxes:
 * - Simple: `{{key}}` → replaced with value
 * - Conditional: `{{#key}}...content...{{/key}}` → kept if value is truthy, removed otherwise
 *
 * Conditional blocks are processed first, then simple replacements run on remaining content.
 */
export function applyTemplateParams(
  content: string,
  params: Record<string, number | string>,
): string {
  let result = content;

  // 1. Process conditional blocks: {{#key}}content{{/key}}
  //    Truthy = defined AND non-empty string (after trim)
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key, inner) => {
    const value = params[key];
    const truthy = value !== undefined && String(value).trim() !== "";
    return truthy ? inner : "";
  });

  // 2. Simple replacements: {{key}} → value
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

/** Recursively apply template params to all text files in a directory. */
const TEMPLATE_EXTENSIONS = new Set([".md", ".txt", ".html", ".css", ".json"]);

function applyTemplateToDir(
  dir: string,
  params: Record<string, number | string>,
): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      applyTemplateToDir(fullPath, params);
    } else if (TEMPLATE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      const content = readFileSync(fullPath, "utf-8");
      const replaced = applyTemplateParams(content, params);
      if (replaced !== content) {
        writeFileSync(fullPath, replaced, "utf-8");
      }
    }
  }
}

/**
 * Generate a CLAUDE.md section describing the Viewer's self-describing API.
 * Pure function — no side effects, no dependency on Skill.
 *
 * Returns empty string if no viewer API is declared.
 */
export function generateViewerApiSection(
  viewerApi: ViewerApiConfig | undefined,
): string {
  if (!viewerApi) return "";
  const lines: string[] = ["## Viewer API", ""];
  let hasContent = false;

  // Workspace model
  if (viewerApi.workspace) {
    const ws = viewerApi.workspace;
    const traits: string[] = [];
    if (ws.ordered) traits.push("ordered");
    if (ws.multiFile) traits.push("multi-file");
    if (ws.hasActiveFile) traits.push("active file tracking");
    lines.push("### Workspace");
    lines.push(`- Type: ${ws.type}${traits.length > 0 ? ` (${traits.join(", ")})` : ""}`);
    if (ws.manifestFile) lines.push(`- Index file: ${ws.manifestFile}`);
    lines.push("");
    hasContent = true;

    if (ws.supportsContentSets) {
      lines.push("### Content Sets");
      lines.push("This workspace may contain multiple content sets as top-level directories (e.g. en-dark/, ja-light/).");
      lines.push("The `<viewer-context>` includes a `content-set` attribute. File paths include the content set prefix.");
      lines.push("Always edit files within the active content set's directory unless asked to work across content sets.");
      lines.push("");
    }
  }

  // Actions
  const actions = viewerApi.actions?.filter((a) => a.agentInvocable) ?? [];
  if (actions.length > 0) {
    lines.push("### Actions");
    lines.push("");
    lines.push("The viewer supports these operations. Invoke via Bash:");
    lines.push("`curl -s -X POST $PNEUMA_API/api/viewer/action -H 'Content-Type: application/json' -d '{\"actionId\":\"<id>\",\"params\":{...}}'`");
    lines.push("");
    lines.push("| Action | Description | Params |");
    lines.push("|--------|-------------|--------|");
    for (const action of actions) {
      const paramDescs: string[] = [];
      if (action.params) {
        for (const [name, p] of Object.entries(action.params)) {
          paramDescs.push(`${name}${p.required ? "" : "?"}: ${p.type}`);
        }
      }
      lines.push(`| \`${action.id}\` | ${action.description || action.label} | ${paramDescs.join(", ") || "—"} |`);
    }
    lines.push("");
    hasContent = true;
  }

  // Scaffold
  if (viewerApi.scaffold) {
    const sc = viewerApi.scaffold;
    lines.push("### Scaffold");
    lines.push("");
    lines.push(`${sc.description} **Requires user confirmation in browser.**`);
    lines.push("");
    lines.push("Invoke via the viewer action API:");
    lines.push("`curl -s -X POST $PNEUMA_API/api/viewer/action -H 'Content-Type: application/json' -d '{\"actionId\":\"scaffold\",\"params\":{...}}'`");
    lines.push("");
    const paramEntries = Object.entries(sc.params);
    if (paramEntries.length > 0) {
      lines.push("| Param | Type | Required | Description |");
      lines.push("|-------|------|----------|-------------|");
      for (const [name, p] of paramEntries) {
        lines.push(`| \`${name}\` | ${p.type} | ${p.required ? "yes" : "no"} | ${p.description} |`);
      }
      lines.push("");
    }
    lines.push(`Clears: ${sc.clearPatterns.map((p) => `\`${p}\``).join(", ")}`);
    lines.push("");
    hasContent = true;
  }

  // Locator cards
  if (viewerApi.locatorDescription) {
    lines.push("### Locator Cards");
    lines.push("");
    lines.push("You may embed clickable navigation cards in your messages using this tag:");
    lines.push("`<viewer-locator label=\"Display Label\" data='{\"key\":\"value\"}' />`");
    lines.push("");
    lines.push(viewerApi.locatorDescription);
    lines.push("");
    lines.push("When the user clicks a locator card, the viewer navigates to that location.");
    lines.push("");
    lines.push("**Always** embed locator cards at the end of your response when you create or edit content. The user may have navigated away while you were working — locators let them jump directly to what changed.");
    lines.push("");
    hasContent = true;
  }

  if (!hasContent) return "";

  // Viewer context format description (prepend after header)
  const contextLines = [
    "### Viewer Context",
    "",
    "Each user message may be prefixed with a `<viewer-context>` block.",
    "It describes what the user is currently seeing — the active file, viewport position, and selected elements.",
    'Use this to resolve references like "this page", "here", "this section" in user messages.',
    "",
    "### User Actions",
    "",
    "Messages may include a `<user-actions>` block listing significant actions",
    "the user performed in the viewer since the last message.",
    "Use this to understand workspace state changes that happened outside of your edits.",
    "",
  ];
  lines.splice(2, 0, ...contextLines);

  return lines.join("\n");
}

/**
 * Generate a CLAUDE.md section describing the proxy mechanism.
 * Only generated when the mode declares proxy config (manifest.proxy).
 * Modes without proxy config don't need this — their viewers don't fetch external APIs.
 *
 * Pure function — no side effects.
 */
export function generateProxySection(
  proxy: Record<string, import("../core/types/mode-manifest.js").ProxyRoute> | undefined,
): string {
  if (!proxy) return "";

  const hasPresets = Object.keys(proxy).length > 0;

  const lines: string[] = [
    "### Proxy",
    "",
    "The runtime provides a reverse proxy at `/proxy/<name>/<path>` to avoid CORS issues when viewer code fetches external APIs.",
    "**Always use the proxy for external API access** — never use absolute URLs directly in viewer code.",
    "",
  ];

  // Preset routes table
  if (hasPresets) {
    lines.push("**Available proxies (from mode defaults):**");
    lines.push("");
    lines.push("| Name | Target | Description |");
    lines.push("|------|--------|-------------|");
    for (const [name, route] of Object.entries(proxy)) {
      lines.push(`| \`${name}\` | \`${route.target}\` | ${route.description ?? "—"} |`);
    }
    lines.push("");
    lines.push("**Usage in viewer code:**");
    lines.push(`- Example: \`fetch("/proxy/${Object.keys(proxy)[0]}/path/to/resource")\``);
  } else {
    lines.push("**Usage in viewer code:**");
    lines.push("- Example: `fetch(\"/proxy/myapi/path/to/resource\")`");
  }
  lines.push("");

  // Adding new proxies — use fenced code block to avoid template resolution
  lines.push("**Adding or overriding proxies at runtime:**");
  lines.push("Write `proxy.json` in workspace root (takes effect immediately, no restart).");
  lines.push("Fields: `target` (required, upstream base URL), `headers` (optional, supports env var templates), `methods` (optional, defaults to GET only).");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate a CLAUDE.md section describing the native bridge API.
 * Always injected — the API gracefully returns "not available" in non-desktop environments.
 */
export function generateNativeBridgeSection(): string {
  return [
    "### Native Desktop APIs",
    "",
    "The runtime provides native desktop capabilities via `/api/native/`. Available when running inside the Pneuma desktop app.",
    "",
    "**Discovery:** `curl -s $PNEUMA_API/api/native` — returns `{ available: true, capabilities: { module: [methods...] } }` or `{ available: false }`.",
    "Always check this first to see what's available — the capability list is dynamic and auto-generated from Electron modules.",
    "",
    "**Invoke:** `curl -s -X POST $PNEUMA_API/api/native/<module>/<method> -H 'Content-Type: application/json' -d '[...args]'`",
    "Returns `{ ok: true, result: ... }` or `{ ok: false, error: \"...\" }`.",
    "",
    "**Common modules:** `clipboard` (readText, writeText, readImage→base64, writeImage←base64, ...), `shell` (openPath, openExternal, ...), `app` (getVersion, getPath, ...), `system` (platform, cpus, totalMemory, hostname, ...), `screen`, `nativeTheme`, `notification` (show, isSupported), `window` (minimize, maximize, setAlwaysOnTop, getBounds, ...)",
    "",
  ].join("\n");
}

/**
 * Install MCP servers declared by a mode into workspace's .mcp.json.
 *
 * Management strategy: uses .pneuma/managed-mcp.json to track which servers
 * Pneuma manages. On re-install, old managed entries are removed before writing new ones.
 * User-added servers are preserved.
 */
export function installMcpServers(
  workspace: string,
  mcpServers: McpServerConfig[],
  params?: Record<string, number | string>,
): void {
  const mcpJsonPath = join(workspace, ".mcp.json");
  const managedListPath = join(workspace, ".pneuma", "managed-mcp.json");

  // Read existing .mcp.json
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch {
      mcpConfig = { mcpServers: {} };
    }
  }

  // Read managed server names and remove old entries
  let managedNames: string[] = [];
  if (existsSync(managedListPath)) {
    try {
      managedNames = JSON.parse(readFileSync(managedListPath, "utf-8"));
    } catch {
      managedNames = [];
    }
  }
  for (const name of managedNames) {
    delete mcpConfig.mcpServers[name];
  }

  // Apply template params helper
  const applyToValue = (value: string): string => {
    return params && Object.keys(params).length > 0
      ? applyTemplateParams(value, params)
      : value;
  };
  const applyToRecord = (record: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) {
      result[k] = applyToValue(v);
    }
    return result;
  };

  // Build and write new entries
  const newManagedNames: string[] = [];
  for (const server of mcpServers) {
    newManagedNames.push(server.name);

    if (server.url) {
      // HTTP server
      const entry: Record<string, unknown> = {
        type: "http",
        url: applyToValue(server.url),
      };
      if (server.headers && Object.keys(server.headers).length > 0) {
        entry.headers = applyToRecord(server.headers);
      }
      mcpConfig.mcpServers[server.name] = entry;
    } else {
      // stdio server
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args.map(applyToValue);
      if (server.env && Object.keys(server.env).length > 0) {
        entry.env = applyToRecord(server.env);
      }
      mcpConfig.mcpServers[server.name] = entry;
    }
  }

  // Write .mcp.json
  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  console.log(`[skill-installer] Updated .mcp.json with ${mcpServers.length} server(s)`);

  // Write managed list
  mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  writeFileSync(managedListPath, JSON.stringify(newManagedNames, null, 2), "utf-8");
}

/**
 * Install skill dependencies declared by a mode.
 *
 * Copies each dependency's source directory into the backend-appropriate skills dir,
 * applies template params, and returns instruction file snippet lines for injection.
 */
export function installSkillDependencies(
  workspace: string,
  dependencies: SkillDependency[],
  modeSourceDir: string,
  params?: Record<string, number | string>,
  backendType?: string,
): string[] {
  const snippets: string[] = [];

  for (const dep of dependencies) {
    if (!dep.sourceDir) {
      console.error(`[skill-installer] Skill dependency "${dep.name}" is missing sourceDir — skipping. The skill files must be bundled in the mode package.`);
      continue;
    }

    const depSource = join(modeSourceDir, dep.sourceDir);
    const depTarget = join(workspace, skillsDir(backendType), dep.name);

    if (existsSync(depSource)) {
      // Purge prior install to drop stale files from older dependency versions.
      if (existsSync(depTarget)) {
        rmSync(depTarget, { recursive: true, force: true });
      }
      mkdirSync(depTarget, { recursive: true });
      cpSync(depSource, depTarget, { recursive: true, force: true });
      if (params && Object.keys(params).length > 0) {
        applyTemplateToDir(depTarget, params);
      }
      console.log(`[skill-installer] Installed skill dependency: ${dep.name}`);
    } else {
      console.error(`[skill-installer] Skill dependency "${dep.name}" source not found: ${depSource} — the mode package is incomplete.`);
    }

    // Collect snippet for CLAUDE.md
    if (dep.claudeMdSnippet) {
      snippets.push(`- ${dep.claudeMdSnippet}`);
    } else {
      // Try extracting summary from installed SKILL.md
      const skillMdPath = join(depTarget, "SKILL.md");
      if (existsSync(skillMdPath)) {
        const content = readFileSync(skillMdPath, "utf-8");
        const headingMatch = content.match(/^#\s+(.+)/m);
        snippets.push(`- **${dep.name}** — ${headingMatch ? headingMatch[1] : "Installed skill"}`);
      } else {
        snippets.push(`- **${dep.name}**`);
      }
    }
  }

  return snippets;
}

/**
 * Copy shared script sources from `modes/_shared/scripts/` into the installed
 * mode skill's `scripts/` directory. Used when multiple modes reach for the
 * same underlying tool (image generation, etc.) but each mode owns its own
 * SKILL.md guidance about when to use it.
 *
 * The script is materialized under `{SKILL_PATH}/scripts/<file>` so the mode's
 * own SKILL.md can reference it with a single relative path. The mode's own
 * `.env` (from `envMapping`) sits next to it, which the shared script's
 * `findEnvFile()` discovers by walking up from cwd.
 */
function installSharedScripts(
  skillTarget: string,
  scriptNames: string[],
): void {
  if (scriptNames.length === 0) return;

  const sharedScriptsDir = join(import.meta.dirname, "..", "modes", "_shared", "scripts");
  const targetScriptsDir = join(skillTarget, "scripts");
  mkdirSync(targetScriptsDir, { recursive: true });

  for (const name of scriptNames) {
    const source = join(sharedScriptsDir, name);
    if (!existsSync(source)) {
      console.error(`[skill-installer] Shared script "${name}" not found at ${source} — skipping.`);
      continue;
    }
    const target = join(targetScriptsDir, name);
    cpSync(source, target, { force: true });
    console.log(`[skill-installer] Installed shared script: ${name} → ${target}`);
  }
}

/**
 * Returns framework-level skill dependencies installed for ALL modes.
 * These provide universal agent capabilities (e.g., user preference analysis).
 *
 * When `inProject` is true, the project-context skill (`pneuma-project`) is
 * appended — it teaches the agent how to live inside a Pneuma project,
 * write/consume handoff files, and follow project-scoped preferences. Quick
 * (non-project) sessions skip it.
 */
function getGlobalSkillDependencies(inProject = false): SkillDependency[] {
  const sharedDir = join(import.meta.dirname, "..", "modes", "_shared");
  const deps: SkillDependency[] = [];

  const prefsDir = join(sharedDir, "skills", "pneuma-preferences");
  if (existsSync(prefsDir)) {
    deps.push({
      name: "pneuma-preferences",
      sourceDir: "skills/pneuma-preferences",
      claudeMdSnippet: "**pneuma-preferences** — Persistent user preference memory. Consult BEFORE making design, style, or aesthetic decisions in any mode. Also use when starting creative work or when the user corrects your choices.",
    });
  }

  if (inProject) {
    const projectDir = join(sharedDir, "skills", "pneuma-project");
    if (existsSync(projectDir)) {
      deps.push({
        name: "pneuma-project",
        sourceDir: "skills/pneuma-project",
        claudeMdSnippet: "**pneuma-project** — Project-context awareness. Read for cross-mode handoff protocol, project-scoped preferences, and boundaries between session-private and project-shared files.",
      });
    }
  }

  return deps;
}

/**
 * Options for {@link installSkill}.
 *
 * Field names mirror the legacy positional parameter names exactly so callers
 * can convert positional → object mechanically (1:1 mapping).
 */
export interface InstallSkillOptions {
  /** User's project directory (canonical user-content root). */
  workspace: string;
  /** Skill configuration from ModeManifest. */
  skillConfig: SkillConfig;
  /** Absolute path to the mode package directory (e.g. /path/to/modes/doc). */
  modeSourceDir: string;
  /** Optional init params for template replacement. */
  params?: Record<string, number | string>;
  /**
   * Optional viewer self-describing API (auto-injected as independent
   * instructions-file section).
   */
  viewerApi?: ViewerApiConfig;
  /**
   * Backend type ("claude-code" | "codex"). When "codex", also writes
   * AGENTS.md alongside CLAUDE.md.
   */
  backendType?: string;
  /** Optional proxy route definitions for the viewer-api section. */
  proxyConfig?: Record<string, import("../core/types/mode-manifest.js").ProxyRoute>;
  /**
   * Where to write `.claude/skills/<installName>/`,
   * `.agents/skills/<installName>/`, and the primary instructions file
   * (`CLAUDE.md` / `AGENTS.md`). Defaults to `workspace` for quick sessions.
   * Project sessions pass `<project>/.pneuma/sessions/{id}/`. User-content
   * paths (.gitignore, .mcp.json, managed-mcp.json) always target `workspace`.
   */
  sessionDir?: string;
  /**
   * Project root for project-scoped sessions. When set, the installer reads
   * `<projectRoot>/.pneuma/project.json` + `<projectRoot>/.pneuma/preferences/`
   * and injects a `pneuma:project` marker into the instructions file.
   * Quick sessions omit this.
   */
  projectRoot?: string;
  /**
   * Session id, used to filter "other sessions" when listing siblings in the
   * project section. Required if `projectRoot` is set.
   */
  sessionId?: string;
}

/**
 * Install a mode's skill and inject CLAUDE.md configuration.
 */
export function installSkill(options: InstallSkillOptions): void {
  const {
    workspace,
    skillConfig,
    modeSourceDir,
    params,
    viewerApi,
    backendType,
    proxyConfig,
    sessionDir,
    projectRoot,
    sessionId,
  } = options;
  // Per-session install target — defaults to workspace for quick sessions.
  // Project sessions pass `<project>/.pneuma/sessions/{id}/` so each session
  // owns an isolated skills directory and instructions file.
  const installTarget = sessionDir ?? workspace;

  // 1. Copy skill to the backend-appropriate skills directory
  const skillSource = join(modeSourceDir, skillConfig.sourceDir);
  const skillTarget = join(installTarget, skillsDir(backendType), skillConfig.installName);

  if (existsSync(skillSource)) {
    // Purge prior install to prevent stale files from older skill versions.
    // Skill content is fully regenerated from source on every install; any .env
    // files from envMapping are rewritten below, so a clean sweep is safe.
    if (existsSync(skillTarget)) {
      rmSync(skillTarget, { recursive: true, force: true });
    }
    mkdirSync(skillTarget, { recursive: true });
    cpSync(skillSource, skillTarget, { recursive: true, force: true });
    // Apply template params to installed skill files
    if (params && Object.keys(params).length > 0) {
      applyTemplateToDir(skillTarget, params);
    }
    // Generate .env file from envMapping (only non-empty values)
    if (skillConfig.envMapping && params) {
      const envLines: string[] = [];
      for (const [envVar, paramName] of Object.entries(skillConfig.envMapping)) {
        const value = params[paramName];
        if (value !== undefined && String(value).trim() !== "") {
          envLines.push(`${envVar}=${value}`);
        }
      }
      if (envLines.length > 0) {
        writeFileSync(join(skillTarget, ".env"), envLines.join("\n") + "\n", "utf-8");
        console.log(`[skill-installer] Generated .env with ${envLines.length} key(s)`);
      }
    }
    console.log(`[skill-installer] Installed skill to ${skillTarget}`);
  } else {
    console.warn(`[skill-installer] Skill source not found: ${skillSource}`);
  }

  // 1b. Install MCP servers
  if (skillConfig.mcpServers && skillConfig.mcpServers.length > 0) {
    installMcpServers(workspace, skillConfig.mcpServers, params);
  }

  // 1c. Install skill dependencies
  let skillSnippets: string[] = [];
  if (skillConfig.skillDependencies && skillConfig.skillDependencies.length > 0) {
    skillSnippets = installSkillDependencies(installTarget, skillConfig.skillDependencies, modeSourceDir, params, backendType);
  }

  // 1c-bis. Materialize shared scripts into the mode's own skill dir
  //         (single source at modes/_shared/scripts/, per-mode copy at install time).
  if (skillConfig.sharedScripts && skillConfig.sharedScripts.length > 0) {
    installSharedScripts(skillTarget, skillConfig.sharedScripts);
  }

  // 1d. Install global skill dependencies (framework-level, all modes).
  //     When the session is project-scoped (`projectRoot` set), the
  //     `pneuma-project` skill is appended so the agent learns the
  //     handoff protocol and project-vs-session boundaries.
  const globalDeps = getGlobalSkillDependencies(Boolean(projectRoot));
  if (globalDeps.length > 0) {
    const globalSnippets = installSkillDependencies(
      installTarget,
      globalDeps,
      join(import.meta.dirname, "..", "modes", "_shared"),
      params,
      backendType,
    );
    skillSnippets.push(...globalSnippets);
  }

  // 1e. Ensure preferences directory and scaffold files exist
  const prefsDir = join(homedir(), ".pneuma", "preferences");
  mkdirSync(prefsDir, { recursive: true });
  scaffoldPreferenceFile(join(prefsDir, "profile.md"), "User Profile");
  const prefModeName = skillConfig.installName.replace(/^pneuma-/, "");
  scaffoldPreferenceFile(join(prefsDir, `mode-${prefModeName}.md`), `${prefModeName} Mode Preferences`);

  // 2. Inject/update instructions file with pneuma configuration
  //    Claude Code uses CLAUDE.md, Codex uses AGENTS.md
  const primaryInstructionsPath = join(installTarget, instructionsFile(backendType));
  let content = "";

  if (existsSync(primaryInstructionsPath)) {
    content = readFileSync(primaryInstructionsPath, "utf-8");
  }

  let sectionContent = skillConfig.claudeMdSection;
  if (params && Object.keys(params).length > 0) {
    sectionContent = applyTemplateParams(sectionContent, params);
  }
  const claudeMdSection = `${PNEUMA_MARKER_START}\n${sectionContent}\n${PNEUMA_MARKER_END}`;

  // Check if pneuma section already exists
  const startIdx = content.indexOf(PNEUMA_MARKER_START);
  const endIdx = content.indexOf(PNEUMA_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    content = content.substring(0, startIdx) +
      claudeMdSection +
      content.substring(endIdx + PNEUMA_MARKER_END.length);
  } else {
    // Append section
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += "\n" + claudeMdSection + "\n";
  }

  // 2b. Inject/update Viewer API section (independent marker, Viewer-owned)
  let viewerApiContent = generateViewerApiSection(viewerApi);
  const proxyContent = generateProxySection(proxyConfig);
  if (proxyContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n" + proxyContent
      : proxyContent;
  }
  const nativeContent = generateNativeBridgeSection();
  if (nativeContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n" + nativeContent
      : nativeContent;
  }
  if (viewerApiContent) {
    const viewerSection = `${VIEWER_API_MARKER_START}\n${viewerApiContent}\n${VIEWER_API_MARKER_END}`;
    const vStart = content.indexOf(VIEWER_API_MARKER_START);
    const vEnd = content.indexOf(VIEWER_API_MARKER_END);
    if (vStart !== -1 && vEnd !== -1) {
      content = content.substring(0, vStart) +
        viewerSection +
        content.substring(vEnd + VIEWER_API_MARKER_END.length);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + viewerSection + "\n";
    }
  }

  // 2c. Inject/update skills dependency section
  if (skillSnippets.length > 0) {
    const skillsContent = [
      "## Available Skills",
      "",
      "The following skills are installed and available for use:",
      "",
      ...skillSnippets,
      "",
      "Use `/<skill-name>` to invoke these skills.",
    ].join("\n");
    const skillsSection = `${SKILLS_MARKER_START}\n${skillsContent}\n${SKILLS_MARKER_END}`;
    const sStart = content.indexOf(SKILLS_MARKER_START);
    const sEnd = content.indexOf(SKILLS_MARKER_END);
    if (sStart !== -1 && sEnd !== -1) {
      content = content.substring(0, sStart) +
        skillsSection +
        content.substring(sEnd + SKILLS_MARKER_END.length);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + skillsSection + "\n";
    }
  } else {
    // Remove stale skills section if no dependencies
    const sStart = content.indexOf(SKILLS_MARKER_START);
    const sEnd = content.indexOf(SKILLS_MARKER_END);
    if (sStart !== -1 && sEnd !== -1) {
      content = content.substring(0, sStart) +
        content.substring(sEnd + SKILLS_MARKER_END.length);
    }
  }

  // 2d. Inject/update preferences critical section
  content = injectPreferencesSection(content, skillConfig.installName);

  // 2e. Inject/update project section (project sessions only).
  //     Quick sessions skip this — `projectRoot` is undefined and the helper
  //     also strips any stale block, keeping the instructions file clean.
  if (projectRoot) {
    const projectBody = buildProjectSection({
      projectRoot,
      currentSessionId: sessionId,
      currentMode: skillConfig.installName.replace(/^pneuma-/, ""),
    });
    content = injectProjectSection(content, projectBody);
  } else {
    // Idempotency: strip any stale block left from a previous install.
    content = injectProjectSection(content, null);
  }

  // 2e2. Inject/update project atlas section (project sessions only).
  //      Pointer-only — the block tells the agent the atlas exists and
  //      where to read it, NOT the atlas contents. Inlining the full
  //      file would bloat every prompt with content the agent might not
  //      need this turn (atlas is 300-800 words by convention; can grow).
  //      The `pneuma-project` skill teaches the agent to Read the atlas
  //      at session start when this block is present.
  if (projectRoot) {
    content = injectProjectAtlasSection(content, buildProjectAtlasPointer(projectRoot));
  } else {
    content = injectProjectAtlasSection(content, null);
  }

  // 2f. Inject/update handoff section (project sessions only).
  //     The v2 tool-call protocol writes a structured payload to
  //     `<sessionDir>/.pneuma/inbound-handoff.json` BEFORE the target spawns;
  //     this block surfaces it to the agent on first run. The agent reads
  //     the file (path quoted in the block) and rms it after consuming.
  //     Quick sessions and project sessions without an inbound payload pass
  //     null to strip any stale block.
  if (projectRoot && sessionId) {
    const inbound = readInboundHandoff(installTarget);
    content = injectHandoffSection(content, buildHandoffSection(inbound));
  } else {
    // Idempotency: strip any stale block left from a previous install.
    content = injectHandoffSection(content, null);
  }

  // Write instructions file
  mkdirSync(dirname(primaryInstructionsPath), { recursive: true });
  writeFileSync(primaryInstructionsPath, content, "utf-8");
  console.log(`[skill-installer] Updated ${primaryInstructionsPath}`);

  // 3. Ensure .pneuma/ is in .gitignore
  //    .gitignore tracks user-content state — always at workspace root regardless of session location.
  ensureGitignore(workspace);

  // 4. Inject resumed context if present
  //    For project sessions the state dir equals `sessionDir` (where session.json
  //    et al. live), so the resumed-context.xml source matches the destination's
  //    session scope. Quick sessions fall back to `<workspace>/.pneuma`.
  injectResumedContext(
    workspace,
    backendType ?? "claude-code",
    installTarget,
    sessionDir,
  );
}

/**
 * After plugin activation, inject external memory source API info
 * into installed preference skill files.
 */
export function injectMemorySourceInfo(
  workspace: string,
  memorySources: Array<{ name: string; displayName: string; routePrefix: string }>,
  backendType?: string,
): void {
  const skillDir = join(workspace, skillsDir(backendType), "pneuma-preferences");
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return;

  let content = readFileSync(skillMdPath, "utf-8");
  if (!content.includes("{{externalMemorySources}}")) return;

  if (memorySources.length === 0) {
    content = content.replace("{{externalMemorySources}}", "_No external memory sources configured for this session._");
  } else {
    const lines = memorySources.map((s) => [
      `### ${s.displayName}`,
      `- **Search:** \`POST ${s.routePrefix}/search\` — body: \`{ "query": "search terms", "limit": 5 }\``,
      `- **Read:** \`GET ${s.routePrefix}/read/{path}\` — read a specific entry`,
      `- **Write:** \`POST ${s.routePrefix}/write\` — body: \`{ "path": "folder/file.md", "content": "...", "tags": ["..."] }\``,
      `- **Status:** \`GET ${s.routePrefix}/status\` — check if source is available`,
    ].join("\n"));
    content = content.replace("{{externalMemorySources}}", lines.join("\n\n"));
  }

  writeFileSync(skillMdPath, content, "utf-8");
}

/**
 * Inject resumed session context from shared history into the instructions file.
 *
 * Reads `resumed-context.xml` from the per-session state directory (or, for
 * legacy quick sessions, `<workspace>/.pneuma/`) and injects it before
 * `<!-- pneuma:end -->` of the instructions file.
 *
 * @param workspace — User's project directory (legacy default state location)
 * @param backendType — Backend identifier ("claude-code" | "codex")
 * @param instructionsDir — Optional override for where the instructions file lives.
 *   Defaults to `workspace` for backward compatibility (quick sessions). Project
 *   sessions pass the per-session directory so the resumed context lands in the
 *   session-scoped instructions file, not the workspace-shared one.
 * @param stateDir — Optional override for where `resumed-context.xml` lives.
 *   Defaults to `<workspace>/.pneuma`. Project sessions pass
 *   `<projectRoot>/.pneuma/sessions/<sessionId>` so the per-session source is
 *   read instead of any project-root file.
 */
export function injectResumedContext(
  workspace: string,
  backendType: string,
  instructionsDir?: string,
  stateDir?: string,
): void {
  const sourceDir = stateDir ?? join(workspace, ".pneuma");
  const contextPath = join(sourceDir, "resumed-context.xml");
  if (!existsSync(contextPath)) return;

  const context = readFileSync(contextPath, "utf-8");
  const markerStart = "<!-- pneuma:resumed:start -->";
  const markerEnd = "<!-- pneuma:resumed:end -->";
  const section = `${markerStart}\n${context}\n${markerEnd}`;

  const instrTarget = instructionsDir ?? workspace;
  const instructionsPath = backendType === "codex"
    ? join(instrTarget, "AGENTS.md")
    : join(instrTarget, "CLAUDE.md");

  if (!existsSync(instructionsPath)) return;

  let content = readFileSync(instructionsPath, "utf-8");

  // Remove existing resumed section if present
  const existingStart = content.indexOf(markerStart);
  const existingEnd = content.indexOf(markerEnd);
  if (existingStart !== -1 && existingEnd !== -1) {
    content = content.slice(0, existingStart) + content.slice(existingEnd + markerEnd.length);
  }

  // Inject before <!-- pneuma:end --> if it exists, otherwise append
  const pneumaEnd = content.indexOf("<!-- pneuma:end -->");
  if (pneumaEnd !== -1) {
    content = content.slice(0, pneumaEnd) + section + "\n" + content.slice(pneumaEnd);
  } else {
    content += "\n" + section;
  }

  writeFileSync(instructionsPath, content);
}
