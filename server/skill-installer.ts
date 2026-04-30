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
    const prefsLines: string[] = [
      "## Critical user preferences (excerpt)",
      "",
      "These are the user's hard constraints — extracted from `~/.pneuma/preferences/` so you can't miss them. The full preference profile (taste, working style, history of corrections) lives in those files; the `pneuma-preferences` skill tells you when and how to read them. Don't treat the lines below as the whole picture — they're just the non-negotiable subset.",
      "",
    ];
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
 * Determine which Pneuma runtime shell the agent is running under — "app" for
 * the Electron desktop client, "web" for plain browser. Used by the `pneuma:start`
 * header so the agent's environment label matches reality.
 *
 * Resolution order:
 *  1. Explicit `runtimeShell` argument (passed by callers that already know).
 *  2. `PNEUMA_RUNTIME_SHELL` env var ("app" | "web") — the launcher / Electron
 *     main process can set this when spawning per-session children.
 *  3. Fallback: "web". The agent learns the actual capabilities through
 *     `/api/native` discovery anyway, so "web" is the safe default.
 */
export function resolveRuntimeShell(
  override?: "app" | "web",
): "app" | "web" {
  if (override === "app" || override === "web") return override;
  const envHint = process.env.PNEUMA_RUNTIME_SHELL;
  if (envHint === "app" || envHint === "web") return envHint;
  return "web";
}

/**
 * Build the `pneuma:start` block body — a scene-setting header that names the
 * mode, the runtime shell, and the backend driving the agent, plus a short
 * paragraph describing what the user and the agent are doing together here,
 * plus a pointer to the mode's own SKILL.md for everything else.
 *
 * Replaces the old approach where `claudeMdSection` carried full architecture
 * + core rules inline. Mode-specific guidance now lives in `SKILL.md` and
 * loads via progressive disclosure; this block is just the orientation pass.
 *
 * Pure function — no side effects.
 *
 * @param skillConfig — the mode's skill config (provides `mdScene` + `installName`)
 * @param displayName — human-readable mode name (e.g. "Illustrate"); falls back
 *   to a title-cased `installName` derivation when empty
 * @param backendType — "claude-code" or "codex"; defaults to "claude-code" when
 *   unspecified, matching the rest of the installer
 * @param runtimeShell — "app" | "web", already resolved
 */
export function generatePneumaSection(
  skillConfig: SkillConfig,
  displayName: string | undefined,
  backendType: string | undefined,
  runtimeShell: "app" | "web",
): string {
  const backendLabel = backendType === "codex" ? "codex" : "claude-code";
  const shellLabel = runtimeShell === "app" ? "App" : "Web";
  const fallbackDisplay = skillConfig.installName
    .replace(/^pneuma-/, "")
    .replace(/(?:^|[-_])(\w)/g, (_, c: string) => " " + c.toUpperCase())
    .trim();
  const display = (displayName && displayName.trim()) || fallbackDisplay;

  // Scene paragraph: prefer mdScene; fall back to legacy claudeMdSection's
  // first paragraph during migration; last-resort generic stub.
  const scene =
    pickScene(skillConfig.mdScene) ??
    pickScene(skillConfig.claudeMdSection) ??
    `You and the user are collaborating in Pneuma's ${display} workspace. The user watches your work in a live viewer; you read and edit files; the viewer re-renders as files change.`;

  // Pointer + read-priority hint, fused.
  //
  // Why fused: the prior version emitted a one-line "read this skill first"
  // pointer, leaving the agent to figure out what *else* to read on its own.
  // In practice that meant either over-reading (load atlas + README + sibling
  // dirs on every cold start, burning context) or under-reading (skip the
  // skill until late, then backtrack). The hint below orients on a single
  // pass: the user's actual ask is the work; the mode skill is the procedure
  // for substantive moves; everything else is loaded on demand. It refuses to
  // be a "MUST read all of this before responding" rule — that would just
  // recreate the over-reading failure mode it's trying to prevent.
  const pointer = `The mode's specific conventions, workflows, and reference material live in the \`${skillConfig.installName}\` skill — pull it in when you're about to act on a substantive task. Read on a need-to-know basis: start with the user's actual ask, reach for this skill when you're about to act, and load wider surfaces (project atlas, sibling sessions, README) only when the task calls for them. You don't need to warm up before talking back.`;

  return [
    PNEUMA_INTRO,
    "",
    `_Session runtime: Pneuma ${shellLabel} · driven by ${backendLabel}._`,
    "",
    PNEUMA_THESIS,
    "",
    `# Pneuma ${display} Mode`,
    "",
    scene,
    "",
    pointer,
  ].join("\n");
}

/**
 * Three pieces of always-on context emitted at the top of every per-mode
 * `pneuma:start` block, in this order:
 *
 *   1. INTRO — one sentence naming what Pneuma is. The agent reads this
 *      before anything else mentions "Pneuma's harness", so the later
 *      thesis paragraph isn't grounded in an undefined term.
 *   2. Runtime metadata line — italicized "Session runtime: Pneuma Web ·
 *      driven by claude-code", composed at call time. Used to live in the
 *      mode H1 ("# Pneuma {Mode} Mode · Pneuma Web · driven by claude-code")
 *      but mashing three orthogonal facts into one heading reads weird;
 *      pulled out as metadata so the H1 carries only the mode identity.
 *   3. THESIS — the position-setting paragraph: what the harness does
 *      (turns files into a player), what stays the same (the work), what's
 *      amplified (the user's observability of that work). From that
 *      position the right behavior is inferable — no rule list needed.
 *
 * The "player" framing reuses the project's existing vocabulary (viewers
 * are live players for agent output) rather than introducing a new
 * metaphor. Mode-specific tone lives in `mdScene`; behavior procedures
 * live in the mode SKILL.md.
 */
const PNEUMA_INTRO = `**Pneuma** is a co-creation environment where you do the work and a human user watches it happen — typically through a mode-specific live player they can interact with.`;

const PNEUMA_THESIS = `Pneuma's harness does one specific thing: it turns the files you're editing into that player in real time — a deck, a board, a project — so the user can watch your work, select things on it, hand you context, or step in when they need to. The work itself is the same as anywhere else. What's amplified is the user's ability to see it happen.`;

/**
 * Extract the first non-empty, non-heading paragraph from a markdown blob.
 * Used to derive a scene paragraph from legacy `claudeMdSection` content
 * during migration — when a mode hasn't been ported to `mdScene` yet, we
 * grab its lead paragraph instead of dumping the full mini-SKILL.md.
 *
 * Returns null when nothing usable is found.
 */
function pickScene(raw: string | undefined): string | null {
  if (!raw) return null;
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  for (const block of blocks) {
    if (block.startsWith("#")) continue; // skip headings
    if (block.startsWith("-") || block.startsWith("*")) continue; // skip bullet blocks
    if (block.startsWith("|")) continue; // skip tables
    if (block.startsWith("```")) continue; // skip code fences
    if (block.startsWith("{{")) continue; // skip handlebars-only blocks
    return block;
  }
  return null;
}

/**
 * Generate the pure-router Viewer API block for CLAUDE.md / AGENTS.md.
 *
 * Names the channels available between the viewer, the agent, and the user —
 * nothing more. Concrete shapes (locator card schema, action IDs and param
 * types, scaffold params, content-set conventions, native API modules, proxy
 * presets) all live in each mode's own SKILL.md as a prominent top-level
 * "viewer protocol" section, loaded on demand by the host.
 *
 * Why pure-router: empirically, inlining concrete syntax samples or actions
 * tables in CLAUDE.md created two problems. (1) Abstract placeholders (e.g.
 * `<viewer-locator label="..." data='{...}' />`) lost to training-data priors
 * and the agent invented other card-tag syntaxes. (2) Concrete inline samples
 * created dual-source drift with the SKILL.md reference. Treating CLAUDE.md
 * as a router and the SKILL.md as the single canonical source resolves both.
 *
 * Pure function — no side effects.
 *
 * @param viewerApi — viewerApi config from the mode's manifest. Used only to
 *   detect whether the mode has a viewer surface at all.
 * @param installName — the mode's skill install name (e.g. "pneuma-illustrate"),
 *   used to point the agent at the right skill for the canonical schema.
 * @returns markdown body (no marker comments) or empty string when the mode
 *   declares no viewer API
 */
export function generateViewerApiSection(
  viewerApi: ViewerApiConfig | undefined,
  installName?: string,
): string {
  if (!viewerApi) return "";

  const skillRef = installName ? `the \`${installName}\` skill` : "the mode's skill";

  return [
    "## Viewer API",
    "",
    "Channels between the viewer, you, and the user:",
    "",
    "- `<viewer-context>` — may prefix user messages with the active file, viewport, and selection.",
    "- `<user-actions>` — recent UI interactions the user took since your last turn.",
    "- `<viewer-locator>` cards — embed in your replies to give the user one-click navigation back to results.",
    "- `POST $PNEUMA_API/api/viewer/action` — drive the viewer (navigate, fit, scaffold, …).",
    "- `$PNEUMA_API/api/native/*` — desktop APIs (clipboard, shell, notifications, …) when running inside Pneuma App; discover via `GET /api/native`.",
    "",
    `Concrete shapes — locator card schema with this mode's \`data\` keys, action IDs and params, scaffold params, content-set conventions, native module list — live in ${skillRef} under its viewer-protocol section. Read it before your first call.`,
  ].join("\n");
}

/**
 * Generate the slim Proxy preset summary appended to the viewer-api block.
 *
 * Modes that declare proxy presets need the agent to know the preset names
 * (so it can write `fetch("/proxy/<name>/...")` correctly). Anything beyond
 * that — headers, methods, runtime overrides via `proxy.json` — lives in the
 * mode's SKILL.md.
 *
 * Pure function — no side effects.
 */
export function generateProxySection(
  proxy: Record<string, import("../core/types/mode-manifest.js").ProxyRoute> | undefined,
): string {
  if (!proxy || Object.keys(proxy).length === 0) return "";

  const lines: string[] = [
    "### Proxy presets",
    "",
    "Use `fetch(\"/proxy/<name>/path\")` in viewer code to avoid CORS when calling external APIs. This mode preconfigures:",
    "",
    "| Name | Target |",
    "|------|--------|",
  ];
  for (const [name, route] of Object.entries(proxy)) {
    lines.push(`| \`${name}\` | \`${route.target}\` |`);
  }
  lines.push("");
  lines.push(
    "Headers, allowed methods, and how to register additional presets via `proxy.json` are documented in the mode's skill.",
  );

  return lines.join("\n");
}

/**
 * The native bridge gets a one-line callout in the viewer-api teaser; the
 * channel list there already names `/api/native/*`. This generator returns
 * empty so the existing append site stays a no-op.
 *
 * Kept exported for backward compatibility with callers that still invoke it
 * (notably `installSkill`); will be deleted once the call site is removed.
 */
export function generateNativeBridgeSection(): string {
  return "";
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
  /**
   * Runtime shell label for the `pneuma:start` header — "app" when running
   * inside the Pneuma Electron desktop app, "web" otherwise. Defaults to "web"
   * when undefined. The launcher is the source of truth and forwards this to
   * per-session children; if the launcher itself doesn't know, "web" is the
   * safe default (the agent learns the actual shell capabilities through
   * `/api/native` discovery anyway).
   */
  runtimeShell?: "app" | "web";
  /**
   * Mode display name (e.g. "Illustrate") for the `pneuma:start` header
   * title. Falls back to a title-cased derivation of `skillConfig.installName`
   * when omitted, but callers should pass the manifest's `displayName` so the
   * header reads naturally.
   */
  displayName?: string;
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

  // 2a. Build the `pneuma:start` block — scene-setting header (mode name +
  //     runtime shell + backend), short scene paragraph, and a pointer back
  //     to the mode's SKILL.md for everything else. Mode-specific guidance
  //     (architecture, core rules, workflows) lives in SKILL.md and loads
  //     via progressive disclosure — see docs/reference/controlled-state-surface.md.
  const shellLabel = resolveRuntimeShell(options.runtimeShell);
  let sceneBody = generatePneumaSection(
    skillConfig,
    options.displayName,
    backendType,
    shellLabel,
  );
  if (params && Object.keys(params).length > 0) {
    sceneBody = applyTemplateParams(sceneBody, params);
  }
  const claudeMdSection = `${PNEUMA_MARKER_START}\n${sceneBody}\n${PNEUMA_MARKER_END}`;

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

  // 2b. Inject/update Viewer API section (independent marker, Viewer-owned).
  //     The slim teaser names the channels and lists the agent-callable
  //     actions; deeper reference (locator schema, scaffold params, native
  //     module list, proxy headers) lives in the mode's SKILL.md.
  let viewerApiContent = generateViewerApiSection(viewerApi, skillConfig.installName);
  const proxyContent = generateProxySection(proxyConfig);
  if (proxyContent) {
    viewerApiContent = viewerApiContent
      ? viewerApiContent + "\n\n" + proxyContent
      : proxyContent;
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

  // 2c. Inject/update skills dependency section.
  //     The host already auto-discovers skills under `.claude/skills/` (or
  //     `.agents/skills/`) via their SKILL.md frontmatter — this block exists
  //     so the agent has a quick mental map of what's installed alongside the
  //     mode skill named in the `pneuma:start` block. Trigger logic for each
  //     entry stays in its own SKILL.md description.
  if (skillSnippets.length > 0) {
    const skillsContent = [
      "## Skills available",
      "",
      ...skillSnippets,
      "",
      "Read each skill's SKILL.md when its description matches what you're about to do — the host has already loaded their frontmatter into your available-skills list.",
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
