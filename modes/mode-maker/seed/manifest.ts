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

  skill: {
    sourceDir: "skill",
    installName: "pneuma-{{modeName}}",
    claudeMdSection: `## Pneuma {{displayName}} Mode

You are running inside Pneuma {{displayName}} Mode. A user is viewing your edits live in a browser.

**Important**: When the user asks you to make changes, edit the files directly using the Edit or Write tools. The user sees updates in real-time.

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
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
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
