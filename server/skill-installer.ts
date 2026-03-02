/**
 * Skill installer — copies mode-specific skill to .claude/skills/ and
 * injects Pneuma configuration into CLAUDE.md.
 *
 * Parameterized by SkillConfig from ModeManifest — no hardcoded mode knowledge.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import type { SkillConfig, ViewerApiConfig } from "../core/types/mode-manifest.js";

const PNEUMA_MARKER_START = "<!-- pneuma:start -->";
const PNEUMA_MARKER_END = "<!-- pneuma:end -->";
const VIEWER_API_MARKER_START = "<!-- pneuma:viewer-api:start -->";
const VIEWER_API_MARKER_END = "<!-- pneuma:viewer-api:end -->";

/**
 * Ensure `.pneuma/` is listed in the workspace's .gitignore.
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
  port: number = 17007,
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
  }

  // Actions
  const actions = viewerApi.actions?.filter((a) => a.agentInvocable) ?? [];
  if (actions.length > 0) {
    lines.push("### Actions");
    lines.push("");
    lines.push("The viewer supports these operations. Invoke via Bash:");
    lines.push(`\`curl -s -X POST http://localhost:${port}/api/viewer/action -H 'Content-Type: application/json' -d '{\"actionId\":\"<id>\",\"params\":{...}}'\``);
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

  if (!hasContent) return "";

  // Viewer context format description (prepend after header)
  const contextLines = [
    "### Viewer Context",
    "",
    "Each user message may be prefixed with a `<viewer-context>` block.",
    "It describes what the user is currently seeing — the active file, viewport position, and selected elements.",
    'Use this to resolve references like "this page", "here", "this section" in user messages.',
    "",
  ];
  lines.splice(2, 0, ...contextLines);

  return lines.join("\n");
}

/**
 * Install a mode's skill and inject CLAUDE.md configuration.
 *
 * @param workspace  — User's project directory
 * @param skillConfig — Skill configuration from ModeManifest
 * @param modeSourceDir — Absolute path to the mode package directory (e.g. /path/to/modes/doc)
 * @param params — Optional init params for template replacement
 * @param viewerApi — Optional viewer self-describing API (auto-injected as independent CLAUDE.md section)
 * @param port — Server port for viewer action curl commands
 */
export function installSkill(
  workspace: string,
  skillConfig: SkillConfig,
  modeSourceDir: string,
  params?: Record<string, number | string>,
  viewerApi?: ViewerApiConfig,
  port?: number,
): void {
  // 1. Copy skill to .claude/skills/{installName}/
  const skillSource = join(modeSourceDir, skillConfig.sourceDir);
  const skillTarget = join(workspace, ".claude", "skills", skillConfig.installName);
  mkdirSync(skillTarget, { recursive: true });

  if (existsSync(skillSource)) {
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

  // 2. Inject/update CLAUDE.md with pneuma configuration
  const claudeMdPath = join(workspace, "CLAUDE.md");
  let content = "";

  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, "utf-8");
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
  const viewerApiContent = generateViewerApiSection(viewerApi, port);
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

  // Ensure .claude directory exists
  mkdirSync(dirname(claudeMdPath), { recursive: true });
  writeFileSync(claudeMdPath, content, "utf-8");
  console.log(`[skill-installer] Updated ${claudeMdPath}`);

  // 3. Ensure .pneuma/ is in .gitignore
  ensureGitignore(workspace);
}
