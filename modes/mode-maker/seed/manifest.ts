/**
 * {{displayName}} Mode Manifest — pure data declaration.
 *
 * Defines the mode's identity, skill injection, viewer config, and initialization.
 * Safely imported by both backend and frontend.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const manifest: ModeManifest = {
  name: "{{modeName}}",
  version: "1.0.0",
  displayName: "{{displayName}}",
  description: "TODO: describe what this mode does",
  // icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">...</svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-{{modeName}}",
    claudeMdSection: `## Pneuma {{displayName}} Mode

You are a {{displayName}} assistant running inside Pneuma {{displayName}} Mode.
The user sees your edits live in a browser preview panel.

### Skill Reference
**Before your first action in a new conversation**, consult the \`pneuma-{{modeName}}\` skill.
It contains file conventions, editing workflow, and domain-specific guidance for this mode.

### Core Rules
- Edit files directly using Edit or Write tools — the user sees updates in real-time
- Make focused, incremental edits
- Do not ask for confirmation on simple edits — just do them`,
    // envMapping: { API_KEY: "apiKey" },       // Map init params → .env + agent env vars
    // mcpServers: [{ name: "...", command: "npx", args: [...] }],  // MCP tool servers
    // skillDependencies: [{ name: "...", sourceDir: "deps/..." }], // External skill deps
  },

  viewer: {
    watchPatterns: ["**/*.md"],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
    ],
    serveDir: ".",
  },

  // Data channels the viewer subscribes to via `useSource(sources.<key>)`.
  // This is REQUIRED — pneuma-skills 2.29+ rejects manifests without a
  // `sources` field. The default `files` channel reflects the workspace
  // file list; see references/manifest-reference.md for json-file,
  // aggregate-file, and memory variants.
  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: ["**/*.md"],
        ignore: ["node_modules/**", ".git/**", ".claude/**", ".pneuma/**"],
      },
    },
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting:
      "The user just opened the Pneuma {{displayName}} workspace. Briefly greet them and let them know you're ready to help. Keep it to 1-2 sentences.",
  },

  init: {
    contentCheckPattern: "**/*.md",
    seedFiles: {
      // TODO: add seed file mappings
      // "modes/{{modeName}}/seed/README.md": "README.md",
    },
  },
};

export default manifest;
