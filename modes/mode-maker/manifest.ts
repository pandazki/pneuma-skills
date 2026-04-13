/**
 * Mode Maker Manifest — create and develop new Pneuma modes with AI assistance.
 *
 * Pure data declaration, no React dependency.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const modeMakerManifest: ModeManifest = {
  name: "mode-maker",
  version: "1.1.0",
  displayName: "Mode Maker",
  description: "Create, develop, test, and publish new Pneuma mode packages",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-mode-maker",
    claudeMdSection: `## Pneuma Mode Maker

You are a mode development assistant running inside Pneuma Mode Maker.
The workspace IS the mode package — the user sees structure updates live.

For ModeManifest reference, ViewerContract patterns, publishing workflow, and mode examples, consult the \`pneuma-mode-maker\` skill. Mode development has specific constraints you need to know.

### Mode Package Structure
- \`manifest.ts\` — ModeManifest (pure data — no React imports, no side effects)
- \`pneuma-mode.ts\` — ModeDefinition (binds manifest + viewer)
- \`viewer/*.tsx\` — React preview component
- \`skill/SKILL.md\` — Agent skill prompt
- \`seed/\` — Template files for new workspaces

### Core Rules
- Follow existing mode patterns (doc, slide, draw) for consistency
- Do not ask for confirmation on simple edits — just do them`,
  },

  viewer: {
    watchPatterns: [
      "manifest.ts",
      "manifest.js",
      "pneuma-mode.ts",
      "pneuma-mode.js",
      "viewer/**/*.tsx",
      "viewer/**/*.ts",
      "viewer/**/*.js",
      "skill/**/*.md",
      "skill/**/*",
      "seed/**/*",
    ],
    ignorePatterns: [
      ".build/**",
    ],
  },

  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "manifest.ts", "manifest.js",
          "pneuma-mode.ts", "pneuma-mode.js",
          "viewer/**/*.tsx", "viewer/**/*.ts", "viewer/**/*.js",
          "skill/**/*.md", "skill/**/*",
          "seed/**/*",
        ],
        ignore: [".build/**"],
      },
    },
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Mode Maker" skill="pneuma-mode-maker" session="new"></system-info>
The user just opened the workspace. You are ready to assist with mode package development. Greet the user briefly (1-2 sentences).`,
  },

  init: {
    contentCheckPattern: "manifest.ts",
    params: [
      { name: "modeName", label: "Mode name", description: "lowercase identifier (e.g. quiz, kanban)", type: "string", defaultValue: "my-mode" },
      { name: "displayName", label: "Display name", description: "human-readable name (e.g. Quiz, Kanban Board)", type: "string", defaultValue: "My Mode" },
    ],
    seedFiles: {
      "modes/mode-maker/seed/manifest.ts": "manifest.ts",
      "modes/mode-maker/seed/pneuma-mode.ts": "pneuma-mode.ts",
      "modes/mode-maker/seed/viewer/Preview.tsx": "viewer/Preview.tsx",
      "modes/mode-maker/seed/skill/SKILL.md": "skill/SKILL.md",
      "modes/mode-maker/seed/package.json": "package.json",
    },
  },
};

export default modeMakerManifest;
