/**
 * Evolution Proposal — data model, storage, apply/rollback for skill evolution.
 *
 * The Evolution Agent outputs a structured JSON proposal. Users review it,
 * then apply (with optional edits) or discard. Applied proposals create
 * backups for rollback.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Proposal Data Model ─────────────────────────────────────────────────────

export interface EvolutionProposal {
  id: string;
  createdAt: string;
  mode: string;
  workspace: string;
  status: "pending" | "applied" | "rolled_back" | "discarded" | "forked";

  /** Summary of what the agent proposes to change */
  summary: string;

  /** Individual file changes with evidence */
  changes: ProposedChange[];

  /** When was this proposal applied (if applied) */
  appliedAt?: string;

  /** When was this proposal forked into a custom mode (if forked) */
  forkedAt?: string;

  /** Path to the forked mode (if forked) */
  forkPath?: string;
}

export interface ProposedChange {
  /** Target file path relative to workspace (e.g. ".claude/skills/pneuma-slide/SKILL.md") */
  file: string;

  /** What kind of change */
  action: "modify" | "create";

  /** Human-readable description of the change */
  description: string;

  /** Evidence from user history that supports this change */
  evidence: Evidence[];

  /** The content to write (for "create") or append (for "modify") */
  content: string;

  /**
   * For "modify": where to insert the content.
   * - "append" — add to end of file
   * - "section:<name>" — add after the section with this heading
   */
  insertAt?: string;
}

export interface Evidence {
  /** Which session this evidence came from */
  sessionFile: string;

  /** The relevant user message or interaction */
  quote: string;

  /** Why this is evidence for the proposed change */
  reasoning: string;
}

// ── Storage ─────────────────────────────────────────────────────────────────

const PROPOSALS_DIR = "proposals";
const BACKUPS_DIR = "backups";

function getEvolutionDir(workspace: string): string {
  return join(workspace, ".pneuma", "evolution");
}

export function getProposalsDir(workspace: string): string {
  return join(getEvolutionDir(workspace), PROPOSALS_DIR);
}

function getBackupsDir(workspace: string): string {
  return join(getEvolutionDir(workspace), BACKUPS_DIR);
}

export function saveProposal(workspace: string, proposal: EvolutionProposal): void {
  const dir = getProposalsDir(workspace);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${proposal.id}.json`);
  writeFileSync(filePath, JSON.stringify(proposal, null, 2), "utf-8");
}

export function loadProposal(workspace: string, proposalId: string): EvolutionProposal | null {
  const filePath = join(getProposalsDir(workspace), `${proposalId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    // Malformed JSON — agent may have written invalid JSON
    return null;
  }
}

export function loadLatestProposal(workspace: string): EvolutionProposal | null {
  const dir = getProposalsDir(workspace);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  for (const f of files) {
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf-8"));
    } catch {
      // Skip malformed JSON, try next
    }
  }
  return null;
}

export function listProposals(workspace: string): EvolutionProposal[] {
  const dir = getProposalsDir(workspace);
  if (!existsSync(dir)) return [];

  const results: EvolutionProposal[] = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse()) {
    try {
      results.push(JSON.parse(readFileSync(join(dir, f), "utf-8")));
    } catch {
      // Skip malformed proposal JSON (agent may have written invalid JSON)
    }
  }
  return results;
}

// ── Apply ───────────────────────────────────────────────────────────────────

export function applyProposal(workspace: string, proposalId: string): {
  success: boolean;
  error?: string;
  appliedFiles: string[];
} {
  const proposal = loadProposal(workspace, proposalId);
  if (!proposal) return { success: false, error: "Proposal not found", appliedFiles: [] };
  if (proposal.status === "applied") return { success: false, error: "Proposal already applied", appliedFiles: [] };

  // Create backup of affected files before applying
  const backupDir = join(getBackupsDir(workspace), proposalId);
  mkdirSync(backupDir, { recursive: true });

  // Backup CLAUDE.md before applying (for rollback of evolved section)
  const claudeMdPath = join(workspace, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const claudeBackup = join(backupDir, "CLAUDE.md");
    cpSync(claudeMdPath, claudeBackup);
  }

  const appliedFiles: string[] = [];

  for (const change of proposal.changes) {
    const targetPath = join(workspace, change.file);

    // Backup existing file if it exists
    if (existsSync(targetPath)) {
      const backupPath = join(backupDir, change.file);
      mkdirSync(join(backupPath, ".."), { recursive: true });
      cpSync(targetPath, backupPath);
    }

    // Apply the change
    if (change.action === "create") {
      mkdirSync(join(targetPath, ".."), { recursive: true });
      writeFileSync(targetPath, change.content, "utf-8");
    } else if (change.action === "modify") {
      let existing = "";
      if (existsSync(targetPath)) {
        existing = readFileSync(targetPath, "utf-8");
      }

      if (change.insertAt === "append" || !change.insertAt) {
        // Append to end
        if (existing && !existing.endsWith("\n")) existing += "\n";
        writeFileSync(targetPath, existing + "\n" + change.content + "\n", "utf-8");
      } else if (change.insertAt.startsWith("section:")) {
        // Insert after a specific section heading
        const sectionName = change.insertAt.slice("section:".length);
        const inserted = insertAfterSection(existing, sectionName, change.content);
        writeFileSync(targetPath, inserted, "utf-8");
      }
    }

    appliedFiles.push(change.file);
  }

  // Sync CLAUDE.md with evolved summary
  updateClaudeMdEvolutionSummary(workspace, proposal);

  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  saveProposal(workspace, proposal);

  return { success: true, appliedFiles };
}

// ── Rollback ────────────────────────────────────────────────────────────────

export function rollbackProposal(workspace: string, proposalId: string): {
  success: boolean;
  error?: string;
  restoredFiles: string[];
} {
  const proposal = loadProposal(workspace, proposalId);
  if (!proposal) return { success: false, error: "Proposal not found", restoredFiles: [] };
  if (proposal.status !== "applied") return { success: false, error: "Proposal not applied — nothing to rollback", restoredFiles: [] };

  const backupDir = join(getBackupsDir(workspace), proposalId);
  const restoredFiles: string[] = [];

  // Restore CLAUDE.md from backup (removes evolved section)
  const claudeMdBackup = join(backupDir, "CLAUDE.md");
  const claudeMdPath = join(workspace, "CLAUDE.md");
  if (existsSync(claudeMdBackup)) {
    cpSync(claudeMdBackup, claudeMdPath);
  }

  for (const change of proposal.changes) {
    const targetPath = join(workspace, change.file);
    const backupPath = join(backupDir, change.file);

    if (existsSync(backupPath)) {
      // Restore from backup
      cpSync(backupPath, targetPath);
      restoredFiles.push(change.file);
    } else if (change.action === "create" && existsSync(targetPath)) {
      // File was created by the proposal — delete it
      rmSync(targetPath);
      restoredFiles.push(change.file);
    }
  }

  // Clean up backup directory
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true });
  }

  proposal.status = "rolled_back";
  saveProposal(workspace, proposal);

  return { success: true, restoredFiles };
}

// ── Discard ─────────────────────────────────────────────────────────────────

export function discardProposal(workspace: string, proposalId: string): boolean {
  const proposal = loadProposal(workspace, proposalId);
  if (!proposal) return false;
  if (proposal.status === "applied") return false; // Must rollback first

  proposal.status = "discarded";
  saveProposal(workspace, proposal);
  return true;
}

// ── CLAUDE.md Evolution Sync ────────────────────────────────────────────────

const EVOLVED_START = "<!-- pneuma:evolved:start -->";
const EVOLVED_END = "<!-- pneuma:evolved:end -->";
const PNEUMA_END = "<!-- pneuma:end -->";

/**
 * Insert or replace a "Learned Preferences" subsection inside the pneuma block of CLAUDE.md.
 * Uses nested markers: <!-- pneuma:evolved:start --> / <!-- pneuma:evolved:end -->
 * Graceful no-op if CLAUDE.md has no pneuma markers.
 */
export function updateClaudeMdEvolutionSummary(workspace: string, proposal: EvolutionProposal): void {
  const claudeMdPath = join(workspace, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return;

  let content = readFileSync(claudeMdPath, "utf-8");

  // Only operate if pneuma markers exist
  const endIdx = content.indexOf(PNEUMA_END);
  if (endIdx === -1) return;

  const today = new Date().toISOString().slice(0, 10);
  const bullets = proposal.changes
    .map(c => `- ${c.description}`)
    .join("\n");

  const evolvedBlock = `${EVOLVED_START}
### Learned Preferences
<!-- evolved: ${today} -->

The skill has been augmented with user-learned preferences:
${bullets}

These preferences are documented in the full skill file. They represent defaults — always defer to explicit user instructions.
${EVOLVED_END}`;

  // Check if evolved section already exists — replace it
  const existingStart = content.indexOf(EVOLVED_START);
  const existingEnd = content.indexOf(EVOLVED_END);

  if (existingStart !== -1 && existingEnd !== -1) {
    // Replace existing evolved section
    content = content.slice(0, existingStart) + evolvedBlock + content.slice(existingEnd + EVOLVED_END.length);
  } else {
    // Insert before <!-- pneuma:end -->
    content = content.slice(0, endIdx) + "\n" + evolvedBlock + "\n" + content.slice(endIdx);
  }

  writeFileSync(claudeMdPath, content, "utf-8");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function insertAfterSection(content: string, sectionHeading: string, newContent: string): string {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^#{1,6}\\s+${escapeRegex(sectionHeading)}\\s*$`, "i");

  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingPattern.test(lines[i])) {
      // Find end of this section (next heading of same or higher level, or EOF)
      const currentLevel = (lines[i].match(/^(#+)/) || ["", "#"])[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const nextHeading = lines[j].match(/^(#+)\s/);
        if (nextHeading && nextHeading[1].length <= currentLevel) break;
        j++;
      }
      insertIdx = j;
      break;
    }
  }

  if (insertIdx === -1) {
    // Section not found — append to end
    if (content && !content.endsWith("\n")) content += "\n";
    return content + "\n" + newContent + "\n";
  }

  lines.splice(insertIdx, 0, "", newContent, "");
  return lines.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Proposal Display (for CLI) ──────────────────────────────────────────────

export function formatProposalForDisplay(proposal: EvolutionProposal): string {
  const lines: string[] = [];

  lines.push(`╔══════════════════════════════════════════════════════════════╗`);
  lines.push(`║  Evolution Proposal: ${proposal.id.slice(0, 8)}                              ║`);
  lines.push(`╚══════════════════════════════════════════════════════════════╝`);
  lines.push("");
  lines.push(`  Mode:     ${proposal.mode}`);
  lines.push(`  Created:  ${proposal.createdAt}`);
  lines.push(`  Status:   ${proposal.status}`);
  lines.push("");
  lines.push(`  Summary:`);
  lines.push(`  ${proposal.summary}`);
  lines.push("");

  for (let i = 0; i < proposal.changes.length; i++) {
    const change = proposal.changes[i];
    lines.push(`  ── Change ${i + 1}: ${change.action.toUpperCase()} ${change.file} ──`);
    lines.push(`  ${change.description}`);
    lines.push("");

    if (change.evidence.length > 0) {
      lines.push(`  Evidence:`);
      for (const ev of change.evidence) {
        lines.push(`    • "${ev.quote}"`);
        lines.push(`      → ${ev.reasoning}`);
        lines.push(`      (from: ${ev.sessionFile})`);
        lines.push("");
      }
    }

    lines.push(`  Content to ${change.action === "create" ? "write" : "add"}:`);
    lines.push(`  ┌─────────────────────────────────────────────────────────`);
    for (const contentLine of change.content.split("\n")) {
      lines.push(`  │ ${contentLine}`);
    }
    lines.push(`  └─────────────────────────────────────────────────────────`);
    lines.push("");
  }

  return lines.join("\n");
}
