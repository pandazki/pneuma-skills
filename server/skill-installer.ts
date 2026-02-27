/**
 * Skill installer — copies mode-specific skill to .claude/skills/ and
 * injects Pneuma configuration into CLAUDE.md.
 *
 * Parameterized by SkillConfig from ModeManifest — no hardcoded mode knowledge.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import type { SkillConfig } from "../core/types/mode-manifest.js";

const PNEUMA_MARKER_START = "<!-- pneuma:start -->";
const PNEUMA_MARKER_END = "<!-- pneuma:end -->";

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

/** Replace all {{key}} placeholders in content with param values. */
export function applyTemplateParams(
  content: string,
  params: Record<string, number | string>,
): string {
  let result = content;
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
 * Install a mode's skill and inject CLAUDE.md configuration.
 *
 * @param workspace  — User's project directory
 * @param skillConfig — Skill configuration from ModeManifest
 * @param modeSourceDir — Absolute path to the mode package directory (e.g. /path/to/modes/doc)
 * @param params — Optional init params for template replacement
 */
export function installSkill(
  workspace: string,
  skillConfig: SkillConfig,
  modeSourceDir: string,
  params?: Record<string, number | string>,
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

  // Ensure .claude directory exists
  mkdirSync(dirname(claudeMdPath), { recursive: true });
  writeFileSync(claudeMdPath, content, "utf-8");
  console.log(`[skill-installer] Updated ${claudeMdPath}`);

  // 3. Ensure .pneuma/ is in .gitignore
  ensureGitignore(workspace);
}
