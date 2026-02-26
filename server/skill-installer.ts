/**
 * Skill installer — copies mode-specific skill to .claude/skills/ and
 * injects Pneuma configuration into CLAUDE.md.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_SOURCE = join(__dirname, "..", "skill", "doc");

const PNEUMA_MARKER_START = "<!-- pneuma:start -->";
const PNEUMA_MARKER_END = "<!-- pneuma:end -->";

const PNEUMA_CLAUDE_MD_SECTION = `${PNEUMA_MARKER_START}
## Pneuma Doc Mode

You are running inside Pneuma Doc Mode. A user is viewing your markdown edits live in a browser.

**Important**: When the user asks you to make changes, edit the markdown files directly using the Edit or Write tools. The user sees updates in real-time.

- Workspace contains markdown (.md) files
- Make focused, incremental edits
- Use GitHub-Flavored Markdown (GFM)
- Do not ask for confirmation on simple edits — just do them
${PNEUMA_MARKER_END}`;

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
 * Install the doc mode skill and inject CLAUDE.md configuration.
 */
export function installSkill(workspace: string): void {
  // 1. Copy skill to .claude/skills/pneuma-doc/
  const skillTarget = join(workspace, ".claude", "skills", "pneuma-doc");
  mkdirSync(skillTarget, { recursive: true });

  if (existsSync(SKILL_SOURCE)) {
    cpSync(SKILL_SOURCE, skillTarget, { recursive: true, force: true });
    console.log(`[skill-installer] Installed skill to ${skillTarget}`);
  } else {
    console.warn(`[skill-installer] Skill source not found: ${SKILL_SOURCE}`);
  }

  // 2. Inject/update CLAUDE.md with pneuma configuration
  const claudeMdPath = join(workspace, "CLAUDE.md");
  let content = "";

  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, "utf-8");
  }

  // Check if pneuma section already exists
  const startIdx = content.indexOf(PNEUMA_MARKER_START);
  const endIdx = content.indexOf(PNEUMA_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    content = content.substring(0, startIdx) +
      PNEUMA_CLAUDE_MD_SECTION +
      content.substring(endIdx + PNEUMA_MARKER_END.length);
  } else {
    // Append section
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += "\n" + PNEUMA_CLAUDE_MD_SECTION + "\n";
  }

  // Ensure .claude directory exists
  mkdirSync(dirname(claudeMdPath), { recursive: true });
  writeFileSync(claudeMdPath, content, "utf-8");
  console.log(`[skill-installer] Updated ${claudeMdPath}`);

  // 3. Ensure .pneuma/ is in .gitignore
  ensureGitignore(workspace);
}
