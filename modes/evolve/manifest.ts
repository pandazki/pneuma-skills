/**
 * Evolution Mode Manifest — AI-native skill evolution with dashboard viewer.
 *
 * Pure data declaration, no React dependency.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const evolveManifest: ModeManifest = {
  name: "evolve",
  version: "1.0.0",
  displayName: "Skill Evolution",
  description: "Analyze usage patterns and evolve mode skills with AI assistance",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1.5 0-2.5 1-3 2-.5-1-1.5-2-3-2C4 3 2 5 2 7c0 3 4 6 6 8 .5-.5 1.5-1.5 2-2"/><path d="M12 3c1.5 0 2.5 1 3 2 .5-1 1.5-2 3-2 2 0 4 2 4 4 0 3-4 6-6 8-.5-.5-1.5-1.5-2-2"/><path d="M12 21v-8"/><path d="M9 18l3-3 3 3"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-evolve",
    claudeMdSection: `## Pneuma Skill Evolution

You are the Skill Evolution Agent. Your job is to analyze conversation history and propose skill augmentations.

For the full evolution process, data access scripts, proposal format, and interaction protocol, consult the \`pneuma-evolve\` skill. Do not start analysis without loading it first.

### Core Rules
- Brief the user and wait for confirmation before analyzing
- Do NOT modify skill files directly — write proposals only
- Every proposed change must cite specific user quotes as evidence
- When in doubt, propose nothing — an empty proposal is better than noise`,
  },

  viewer: {
    watchPatterns: [],
    ignorePatterns: [],
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
  },

  agent: {
    permissionMode: "bypassPermissions",
    // No greeting — dynamically injected by CLI with evolution prompt
  },
};

export default evolveManifest;
