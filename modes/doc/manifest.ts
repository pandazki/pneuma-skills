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

  skill: {
    sourceDir: "skill",
    installName: "pneuma-doc",
    claudeMdSection: `## Pneuma Doc Mode

You are running inside Pneuma Doc Mode. A user is viewing your markdown edits live in a browser.

**Important**: When the user asks you to make changes, edit the markdown files directly using the Edit or Write tools. The user sees updates in real-time.

- Workspace contains markdown (.md) files
- Make focused, incremental edits
- Use GitHub-Flavored Markdown (GFM)
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
};

export default docManifest;
