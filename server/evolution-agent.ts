/**
 * Evolution Agent — prompt assembly + metadata for AI-native skill evolution.
 *
 * The Evolution Agent analyzes Claude Code conversation history to discover
 * user preferences and proposes augmentations to skill files. It runs as a
 * standard pneuma session (startServer + ClaudeCodeBackend + wsBridge) so
 * the user can observe and interact via the browser chat UI.
 *
 * The agent uses its built-in tools (Read, Bash, Write) to analyze CC history
 * and writes proposal files to disk in `.pneuma/evolution/proposals/`.
 */

import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import type { ModeManifest } from "../core/types/mode-manifest.js";
import { getProposalsDir } from "./evolution-proposal.js";

export interface EvolutionPromptOptions {
  workspace: string;
  manifest: ModeManifest;
}

/**
 * Metadata for the evolution session — saved as initParams so the viewer can display it.
 */
export interface EvolutionMetadata {
  targetMode: string;
  targetDisplayName: string;
  directive: string;
  workspace: string;
  /** Primary data source — specified workspace */
  primaryHistoryDir: string;
  primarySessionCount: number;
  primarySizeMB: string;
  /** Global data source — all CC projects */
  globalProjectCount: number;
  globalSizeMB: string;
  /** Skill directory path */
  skillDir: string;
}

/**
 * Build the full evolution prompt to inject as a greeting into the agent session.
 * The agent will use its tools to analyze CC history and write a proposal to disk.
 */
export function buildEvolutionPrompt(options: EvolutionPromptOptions): string {
  const { workspace, manifest } = options;
  const parts: string[] = [];

  parts.push(SYSTEM_CONTEXT);

  const directive = manifest.evolution?.directive ?? DEFAULT_DIRECTIVE;
  parts.push(`## Evolution Directive\n\n${directive}`);

  parts.push(buildWorkspaceInfoSection(workspace, manifest));
  parts.push(buildDataSourceSection(workspace, manifest));
  parts.push(buildCurrentSkillSection(workspace, manifest));
  parts.push(buildOutputInstructions(workspace, manifest));

  return parts.join("\n\n---\n\n");
}

/**
 * Build metadata for the evolution session.
 * Saved to .pneuma/config.json as initParams so the viewer dashboard can display it.
 */
export function buildEvolutionMetadata(options: EvolutionPromptOptions): EvolutionMetadata {
  const { workspace, manifest } = options;
  const directive = manifest.evolution?.directive ?? DEFAULT_DIRECTIVE;
  const primary = getPrimaryHistoryStats(workspace);
  const global = getGlobalHistoryStats();
  const skillDir = join(workspace, ".claude", "skills", manifest.skill.installName);

  return {
    targetMode: manifest.name,
    targetDisplayName: manifest.displayName,
    directive,
    workspace,
    primaryHistoryDir: primary.dir,
    primarySessionCount: primary.sessionCount,
    primarySizeMB: primary.sizeMB,
    globalProjectCount: global.projectCount,
    globalSizeMB: global.sizeMB,
    skillDir,
  };
}

// ── Section Builders ────────────────────────────────────────────────────────

function buildWorkspaceInfoSection(workspace: string, manifest: ModeManifest): string {
  const lines: string[] = ["## Workspace Info", ""];
  lines.push(`Workspace path: ${workspace}`);
  lines.push(`Mode: ${manifest.name} (${manifest.displayName})`);
  lines.push(`Skill install name: ${manifest.skill.installName}`);
  lines.push(`Proposals directory: ${getProposalsDir(workspace)}`);
  return lines.join("\n");
}

export function buildDataSourceSection(workspace: string, _manifest: ModeManifest): string {
  const primary = getPrimaryHistoryStats(workspace);
  const global = getGlobalHistoryStats();
  // Scripts are always installed under the evolve skill, not the target mode's skill
  const scriptsDir = join(workspace, ".claude", "skills", "pneuma-evolve", "scripts");

  const lines: string[] = ["## Available Data Sources", ""];

  // ── Primary: workspace-specific history ────────────────────────────────
  lines.push("### Primary: Workspace Conversation History");
  lines.push("");

  if (primary.sessionCount > 0) {
    lines.push(`Path: ${primary.dir}/`);
    lines.push(`Session files: ${primary.sessionCount}`);
    lines.push(`Total size: ~${primary.sizeMB}MB`);
    lines.push("");

    if (primary.recentSessions.length > 0) {
      lines.push("Recent sessions (newest first):");
      for (const f of primary.recentSessions) {
        lines.push(`- ${f.name} (${f.date}, ${f.sizeKB}KB)`);
      }
      lines.push("");
    }

    lines.push("This is your **primary data source** — most relevant for this workspace.");
    lines.push("Focus the majority of your analysis here.");
  } else {
    lines.push(`No history found for this workspace at: ${primary.dir}/`);
    lines.push("If this is a new workspace, the primary source is empty — rely on global history and current skill files.");
  }

  lines.push("");

  // ── Global: all CC project histories ───────────────────────────────────
  lines.push("### Secondary: Global CC History");
  lines.push("");

  if (global.projectCount > 0) {
    lines.push(`Path: ${global.dir}/`);
    lines.push(`Projects: ${global.projectCount}`);
    lines.push(`Total size: ~${global.sizeMB}MB`);
    lines.push("");
    lines.push("This is a **secondary data source** — contains conversation history across ALL of the user's projects.");
    lines.push("Use this to discover cross-project patterns and preferences that may apply to this mode.");
    lines.push("");
    lines.push("Strategy:");
    lines.push("- Use the data access scripts (see below) to efficiently search across projects");
    lines.push("- Look for mode-specific keywords, correction patterns, and style preferences");
    lines.push("- Cross-project evidence reinforces workspace-specific findings");
  } else {
    lines.push("No global CC history found. Skip global analysis.");
  }

  lines.push("");

  // ── Data Access Scripts ────────────────────────────────────────────────
  lines.push("### Data Access Scripts (IMPORTANT)");
  lines.push("");
  lines.push(`Scripts directory: ${scriptsDir}/`);
  lines.push("");
  lines.push("**ALWAYS use these scripts instead of raw grep/cat/head on JSONL files.**");
  lines.push("CC history files are very large (100MB+) and 99% of their content is tool_result noise.");
  lines.push("These scripts use streaming JSONL processing to extract only the meaningful conversation text.");
  lines.push("");
  lines.push("#### 1. `list-sessions.ts` — Discover sessions");
  lines.push("```bash");
  lines.push(`bun ${scriptsDir}/list-sessions.ts --project <pattern> --since 2026-01-01 --limit 20`);
  lines.push("```");
  lines.push("Output: NDJSON with session_id, project, path, size_kb, user_msg_count, time_start/end");
  lines.push("");
  lines.push("#### 2. `session-digest.ts` — Extract pure conversation (KEY tool)");
  lines.push("```bash");
  lines.push(`bun ${scriptsDir}/session-digest.ts --file <path.jsonl>`);
  lines.push("```");
  lines.push("Strips tool_results, thinking blocks, progress messages. Reduces 224MB → ~500KB.");
  lines.push("Output: NDJSON with {role, timestamp, text} — just the human-readable conversation.");
  lines.push("**Use this as your primary analysis method for each session.**");
  lines.push("");
  lines.push("#### 3. `search-messages.ts` — Cross-session keyword search");
  lines.push("```bash");
  lines.push(`bun ${scriptsDir}/search-messages.ts --query "prefer|always|never" --role user --limit 30`);
  lines.push("```");
  lines.push("Searches across ALL sessions for regex matches in conversation text (not tool noise).");
  lines.push("Flags: --project, --since, --role (user|assistant|all), --context N, --limit N");
  lines.push("");
  lines.push("#### 4. `extract-tool-flow.ts` — Tool usage patterns");
  lines.push("```bash");
  lines.push(`bun ${scriptsDir}/extract-tool-flow.ts --file <path.jsonl> --compact`);
  lines.push("```");
  lines.push("Shows tool call sequences with error detection. Use --compact for a one-line summary.");
  lines.push("");
  lines.push("#### 5. `session-stats.ts` — Quick session overview");
  lines.push("```bash");
  lines.push(`bun ${scriptsDir}/session-stats.ts --file <path.jsonl>`);
  lines.push("```");
  lines.push("Quick stats: message counts, tool calls, duration, errors. Use this to triage which sessions are worth deep-diving.");
  lines.push("");

  // ── Recommended workflow ───────────────────────────────────────────────
  lines.push("### Recommended Analysis Workflow");
  lines.push("");
  lines.push("1. **Discover**: `list-sessions.ts --project <workspace-pattern>` to find relevant sessions");
  lines.push("2. **Triage**: `session-stats.ts --file <path>` on each to find sessions with many user messages");
  lines.push("3. **Digest**: `session-digest.ts --file <path>` to read the actual conversation (not tool noise)");
  lines.push("4. **Search**: `search-messages.ts --query <pattern>` for cross-project preference signals");
  lines.push("5. **Synthesize**: Combine findings into a proposal with evidence-backed changes");

  return lines.join("\n");
}

function buildCurrentSkillSection(workspace: string, manifest: ModeManifest): string {
  const skillDir = join(workspace, ".claude", "skills", manifest.skill.installName);
  const lines: string[] = ["## Target Skill — What You Are Evolving", ""];

  lines.push(`Mode: **${manifest.displayName}** (\`${manifest.name}\`)`);
  lines.push(`Skill directory: \`${skillDir}/\``);
  lines.push("");

  // Embed the actual SKILL.md content so the agent knows what it's evolving
  const skillMdPath = join(skillDir, "SKILL.md");
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, "utf-8");
    lines.push("### Current SKILL.md Content");
    lines.push("");
    lines.push("Below is the full skill that the main agent uses in this mode. Your proposals will augment this content.");
    lines.push("");
    lines.push("````markdown");
    lines.push(content.trimEnd());
    lines.push("````");
  } else {
    lines.push("No SKILL.md found yet — the skill may not have been installed for this workspace.");
    lines.push("You can still analyze history and propose new skill content.");
  }

  lines.push("");

  // Embed the claudeMdSection (the hook injected into CLAUDE.md)
  if (manifest.skill.claudeMdSection) {
    lines.push("### claudeMdSection (injected into CLAUDE.md)");
    lines.push("");
    lines.push("This is the short prompt injected into the workspace's CLAUDE.md. It directs the main agent to consult the skill.");
    lines.push("");
    lines.push("```markdown");
    lines.push(manifest.skill.claudeMdSection.trimEnd());
    lines.push("```");
  }

  return lines.join("\n");
}

function buildOutputInstructions(workspace: string, manifest: ModeManifest): string {
  const proposalsDir = getProposalsDir(workspace);
  const installName = manifest.skill.installName;

  return `## Output Instructions

After your analysis, write a proposal JSON file to disk. Follow these steps exactly:

1. Create the proposals directory if it doesn't exist:
   \`mkdir -p ${proposalsDir}\`

2. Generate a proposal ID using this format: \`evo-<timestamp>-<random8>\`
   Example: \`evo-1709740800000-a1b2c3d4\`

3. Write the proposal JSON file to:
   \`${proposalsDir}/<proposalId>.json\`

The proposal MUST follow this exact JSON schema:

\`\`\`json
{
  "id": "<proposalId>",
  "createdAt": "<ISO 8601 timestamp>",
  "mode": "${manifest.name}",
  "workspace": "${workspace}",
  "status": "pending",
  "summary": "A 1-3 sentence summary of what you propose to change and why",
  "changes": [
    {
      "file": ".claude/skills/${installName}/SKILL.md",
      "action": "modify",
      "description": "What this change does",
      "confidence": "high",
      "evidence": [
        {
          "sessionFile": "<uuid>.jsonl",
          "quote": "Direct quote from user message that supports this change",
          "reasoning": "Why this quote indicates the proposed preference"
        }
      ],
      "content": "The markdown content to add",
      "insertAt": "append"
    }
  ]
}
\`\`\`

### Rules for the proposal:

- \`file\`: Relative path from workspace root. Only files under \`.claude/skills/\` are allowed.
  - **Do NOT include CLAUDE.md in your proposal changes.** The system automatically syncs CLAUDE.md when proposals are applied.
- \`action\`: "modify" (add content to existing file), "create" (new file), or "remove" (prune stale content).
- \`confidence\`: Required. "high" (multi-session explicit evidence), "medium" (clear pattern), or "low" (single implicit signal).
- \`evidence\`: At least one evidence item per change. Quote the user's actual words.
- \`content\`: For "modify"/"create" — the content to add. For "remove" — the text to match and remove from the file.
  - Mark evolved content with \`<!-- evolved: YYYY-MM-DD -->\` so users can identify and remove it.
- \`insertAt\`: For "modify" — "append" (end of file) or "section:<heading>" (after a specific section).

### If you find insufficient evidence

Write a proposal with an empty changes array:

\`\`\`json
{
  "id": "<proposalId>",
  "createdAt": "<ISO timestamp>",
  "mode": "${manifest.name}",
  "workspace": "${workspace}",
  "status": "pending",
  "summary": "Insufficient evidence for skill augmentation. [Explain what you looked for and why it wasn't conclusive.]",
  "changes": []
}
\`\`\`

This is a perfectly valid outcome — proposing nothing is better than proposing noise.

### After writing the proposal

After writing the proposal file, summarize what you found and proposed in a brief message to the user. Include:
- How many sessions you analyzed
- Key patterns or preferences discovered
- The proposal ID
- The user can review and take action directly from the Evolution Dashboard on the left`;
}

// ── History Stats Helpers ────────────────────────────────────────────────────

interface SessionInfo {
  name: string;
  date: string;
  sizeKB: string;
}

interface PrimaryHistoryStats {
  dir: string;
  sessionCount: number;
  sizeMB: string;
  recentSessions: SessionInfo[];
}

function getPrimaryHistoryStats(workspace: string): PrimaryHistoryStats {
  const ccProjectsDir = join(homedir(), ".claude", "projects");
  let resolvedWorkspace: string;
  try { resolvedWorkspace = realpathSync(workspace); } catch { resolvedWorkspace = workspace; }
  const encodedPath = resolvedWorkspace.replaceAll("/", "-");
  const dir = join(ccProjectsDir, encodedPath);

  if (!existsSync(dir)) {
    return { dir, sessionCount: 0, sizeMB: "0", recentSessions: [] };
  }

  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
  const totalSize = files.reduce((sum, f) => {
    try { return sum + statSync(join(dir, f)).size; } catch { return sum; }
  }, 0);

  const sorted = files
    .map(f => {
      const stat = statSync(join(dir, f));
      return { name: f, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const recentSessions = sorted.slice(0, 10).map(f => ({
    name: f.name,
    date: new Date(f.mtime).toISOString().slice(0, 10),
    sizeKB: (f.size / 1024).toFixed(0),
  }));

  return {
    dir,
    sessionCount: files.length,
    sizeMB: (totalSize / 1024 / 1024).toFixed(1),
    recentSessions,
  };
}

interface GlobalHistoryStats {
  dir: string;
  projectCount: number;
  sizeMB: string;
}

function getGlobalHistoryStats(): GlobalHistoryStats {
  const dir = join(homedir(), ".claude", "projects");

  if (!existsSync(dir)) {
    return { dir, projectCount: 0, sizeMB: "0" };
  }

  try {
    const projects = readdirSync(dir).filter(d => {
      try { return statSync(join(dir, d)).isDirectory(); } catch { return false; }
    });

    let totalSize = 0;
    for (const proj of projects) {
      const projDir = join(dir, proj);
      try {
        const files = readdirSync(projDir).filter(f => f.endsWith(".jsonl"));
        for (const f of files) {
          try { totalSize += statSync(join(projDir, f)).size; } catch {}
        }
      } catch {}
    }

    return {
      dir,
      projectCount: projects.length,
      sizeMB: (totalSize / 1024 / 1024).toFixed(1),
    };
  } catch {
    return { dir, projectCount: 0, sizeMB: "0" };
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const SYSTEM_CONTEXT = `# Pneuma Skill Evolution Agent

You are the Skill Evolution Agent for Pneuma, an infrastructure for humans and code agents to co-create content.

## Your Mission

Analyze this user's interaction history and write a **structured proposal file to disk** for augmenting the workspace's skill files. Your proposal will be reviewed by the user before being applied — do NOT modify any skill files directly.

You have full access to Read, Bash, and Write tools. Use them to:
1. Read the current skill files to understand the existing domain knowledge
2. Analyze Claude Code conversation history using the provided data access scripts (see Data Access Scripts section)
3. Write the proposal JSON file to the proposals directory

**CRITICAL: Use the data access scripts instead of raw grep/cat on JSONL files.**
CC history files are 100MB+ and 99% tool_result noise. The scripts use streaming JSONL processing to extract only meaningful conversation text.

## Interaction Protocol

**Step 0 — Load Skill (ALWAYS do this first)**

Before anything else, consult the \`pneuma-evolve\` skill to load the full evolution reference (data access scripts, proposal format, dashboard context, key rules).

**Step 1 — Briefing (before any analysis)**

After loading the skill, present the user with a concise overview:

1. Briefly explain what you'll do (2-3 sentences):
   - Scan their conversation history for this mode's workspace
   - Extract style preferences, recurring patterns, and correction signals
   - Generate a proposal with evidence they can review before applying

2. Summarize the context from the sections below:
   - Target mode name and its evolution directive
   - Data sources available (N sessions, ~X MB in primary source; N projects in global source)
   - The skill files that will be augmented

3. Ask the user how they'd like to proceed. Offer these options:
   - **Start directly** — proceed with the default directive as-is
   - **Provide preferences** — the user shares specific areas to focus on, or preferences they already know about themselves
   - **Provide reference material** — the user shares reference content, style examples, or desired output samples
   - **Adjust direction** — the user modifies the evolution directive before you start

**Wait for the user's response before proceeding.** If the user provides additional context, incorporate it into your analysis. If they say "start" or similar, proceed with the defaults.

**Step 2 — Analysis (after user confirmation)**

Once confirmed, follow the recommended analysis workflow: discover sessions → triage → digest → search → synthesize.

**Step 3 — Proposal**

Write the proposal JSON file and summarize findings in chat.

## What is Pneuma

Pneuma provides "Modes" (doc, slide, draw, etc.) that inject domain-specific knowledge ("Skills") into an AI agent. Skills are installed at \`.claude/skills/\` and project-level instructions live in \`CLAUDE.md\`. Together they shape how the agent behaves in a given domain.

## Why Evolution Matters

Skills ship as static presets — identical for every user. But each user has distinct style preferences, work habits, and aesthetic sensibilities. By mining conversation history, you can discover these personal traits and propose augmentations that make the agent's output match what this specific user considers "good."

## Dual Analysis: Augment AND Prune

Every skill instruction encodes an assumption about what the model can't do on its own. As models improve, some assumptions become stale. Your analysis should cover both directions:

**Augmentation:** Find what's missing — corrections the user repeats, preferences they declare, patterns they follow.

**Pruning:** Find what's stale — instructions the agent already follows without being told, instructions the user actively overrides, constraints from older model limitations. Use \`"remove"\` as the action for these.

## Your Constraints

1. You write a proposal file to disk — you do NOT modify skill files directly
2. Every proposed change MUST cite specific evidence from the user's history
3. Evidence must include direct quotes from user messages
4. Every change must include a \`confidence\` rating: "high", "medium", or "low"
5. Omit low-confidence findings unless the potential impact is significant
6. Your augmentations should be "defaults, not rules" — the user's explicit instructions always take priority
7. Be incremental — add to existing skill content, never rewrite it
8. Pruning changes require the same evidence standards as additions`;

export const DEFAULT_DIRECTIVE = `Analyze the user's usage patterns and evolve the skill in both directions.

Augment — find what's missing:
- Patterns the user repeatedly corrects the agent on
- Explicit preference declarations by the user
- Recurring request patterns and content style choices

Prune — find what's stale:
- Skill instructions the agent already follows correctly without being told
- Instructions the user actively contradicts or overrides
- Constraints from older model limitations that current models handle natively`;
