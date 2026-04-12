/**
 * ClipCraft Mode Manifest (bootstrap).
 * Kept intentionally minimal — the real manifest (MCP servers, actions, commands,
 * locators, scaffold, evolution) will grow back as follow-up plans land.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const clipcraftManifest: ModeManifest = {
  name: "clipcraft",
  version: "0.1.0-bootstrap",
  displayName: "ClipCraft",
  description: "AI-orchestrated video production, rebuilt on @pneuma-craft",

  supportedBackends: ["claude-code"],
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace. This is **ClipCraft Mode** — AI-orchestrated video production rebuilt on the \`@pneuma-craft\` headless runtime.

**Status:** Bootstrap scaffold. The real skill (workflow, domain vocabulary, MCP tools) will be written in follow-up plans. For now, only minimal file editing inside \`project.json\` is supported.`,
  },

  viewer: {
    watchPatterns: ["project.json"],
    ignorePatterns: [],
    serveDir: ".",
    refreshStrategy: "auto",
  },

  agent: {
    permissionMode: "bypassPermissions",
  },

  init: {
    contentCheckPattern: "project.json",
    seedFiles: {
      "modes/clipcraft/seed/project.json": "project.json",
    },
  },
};

export default clipcraftManifest;
