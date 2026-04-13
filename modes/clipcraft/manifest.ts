/**
 * ClipCraft Mode Manifest (bootstrap).
 * Kept intentionally minimal — the real manifest (MCP servers, actions, commands,
 * locators, scaffold, evolution) will grow back as follow-up plans land.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import {
  parseProjectFile,
  formatProjectJson,
  type ProjectFile,
} from "./persistence.js";

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
      "modes/clipcraft/seed/assets/sample.mp4": "assets/sample.mp4",
    },
  },

  sources: {
    project: {
      kind: "json-file",
      config: {
        path: "project.json",
        parse: (raw: string): ProjectFile => {
          const result = parseProjectFile(raw);
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
        serialize: (value: ProjectFile): string => formatProjectJson(value),
      },
    },
  },
};

export default clipcraftManifest;
