/**
 * Project Evolve Mode Manifest — project-level evolution agent.
 *
 * Pure data declaration, no React dependency.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 *
 * Forked from `evolve` for the Pneuma 3.0 project layer:
 * - personal `evolve` operates on a single mode's skill, scoped to the
 *   current workspace's session history.
 * - `project-evolve` operates on the *project* — mining cross-mode
 *   sibling sessions to author/refresh `<root>/.pneuma/project-atlas.md`
 *   (a high-density project introduction + quick-reference index that
 *   auto-injects into every project session's CLAUDE.md) and to
 *   maintain `<root>/.pneuma/preferences/{profile,mode-*}.md`
 *   (cross-mode and per-mode project preferences).
 *
 * The two modes coexist deliberately: personal evolve hasn't gone away;
 * project-evolve is the new project-scoped surface launched from the
 * Project chip.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const projectEvolveManifest: ModeManifest = {
  name: "project-evolve",
  version: "1.0.0",
  displayName: "Project Atlas",
  description:
    "Mine the project for high-density context and maintain shared preferences — the briefing every mode reads on startup.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a2 2 0 0 0-2 2v3"/><path d="M15 4h4a2 2 0 0 1 2 2v3"/><path d="M3 15v3a2 2 0 0 0 2 2h4"/><path d="M21 15v3a2 2 0 0 1-2 2h-4"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-project-evolve",
    mdScene: `You and the user are reflecting on this project's accumulated work to refresh the project atlas — the high-density briefing every mode session reads at startup — and the project preferences. This isn't co-creation: you're synthesizing what already exists across sibling sessions and user content into a denser introduction, not generating new artifacts. The user reviews every proposal in the dashboard before anything lands on disk.`,
  },

  viewer: {
    watchPatterns: [],
    ignorePatterns: [],
  },

  sources: {},

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
  },

  agent: {
    permissionMode: "bypassPermissions",
  },

  // Mining cross-session conversation history relies on Claude Code's
  // structured JSONL artifacts. Codex support can come later if/when
  // its history format stabilises.
  supportedBackends: ["claude-code"],
};

export default projectEvolveManifest;
