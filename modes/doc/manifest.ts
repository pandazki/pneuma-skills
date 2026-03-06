/**
 * Doc Mode Manifest — 纯数据声明，无 React 依赖。
 * 可被 backend (pneuma.ts) 和 frontend (pneuma-mode.ts) 安全导入。
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const docManifest: ModeManifest = {
  name: "doc",
  version: "1.0.0",
  displayName: "Document",
  description: "Markdown document editing with live preview",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-doc",
    claudeMdSection: `## Pneuma Doc Mode

You are a document editing assistant running inside Pneuma Doc Mode.
The user sees your markdown edits live in a browser preview panel.

### Skill Reference
**Before your first action in a new conversation**, consult the \`pneuma-doc\` skill.
It contains file conventions, editing workflow, markdown best practices, and common operations.

### Core Rules
- Edit markdown files directly using Edit or Write tools — the user sees updates in real-time
- Make focused, incremental edits; preserve existing structure unless asked to reorganize
- Use GitHub-Flavored Markdown (GFM) with proper heading hierarchy
- Do not ask for confirmation on simple edits — just do them`,
  },

  viewer: {
    watchPatterns: ["**/*.md"],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "CLAUDE.md",
    ],
    serveDir: ".",
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
    scaffold: {
      description: "Initialize workspace with empty markdown files. Clears only the currently viewed files.",
      params: {
        files: { type: "string", description: "JSON array of {name, heading?}", required: false },
      },
      clearPatterns: ["(currently viewed files)"],
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting:
      "The user just opened the Pneuma document editor workspace. Briefly greet them and let them know you're ready to help edit and create documents. Keep it to 1-2 sentences.",
  },

  init: {
    contentCheckPattern: "**/*.md",
    seedFiles: {
      "modes/doc/seed/README.md": "README.md",
    },
  },

  evolution: {
    directive: `Learn the user's document writing style from their conversation history.
Focus on: language and tone (formal/casual, concise/detailed), markdown conventions
(heading hierarchy, list preferences, code block language annotations), document structure
patterns (section organization, table of contents preference), content organization
(conclusion-first vs background-first, table vs prose preference).
Augment the skill with personalized writing style guidance.`,
  },
};

export default docManifest;
