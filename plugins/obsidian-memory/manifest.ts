import type { PluginManifest } from "../../core/types/plugin.js";

const manifest: PluginManifest = {
  name: "obsidian-memory",
  version: "1.0.0",
  displayName: "Obsidian Memory",
  description:
    "External memory source — search and sync with an Obsidian vault via Local REST API",
  builtin: true,
  defaultEnabled: false,
  scope: "global",

  hooks: {
    "session:end": "./hooks/session-end.ts",
  },

  routes: "./routes.ts",

  // Injection point 1: independent skill for the agent
  skill: "./skill",

  // Injection point 2: register as preference memory source
  memorySource: true,

  settings: {
    apiUrl: {
      type: "string",
      label: "API URL",
      description:
        "Obsidian Local REST API URL (default: https://localhost:27124)",
      defaultValue: "https://localhost:27124",
    },
    apiKey: {
      type: "password",
      label: "API Key",
      description: "API key from Obsidian Local REST API plugin settings",
    },
    sessionLogFolder: {
      type: "string",
      label: "Session Log Folder",
      description:
        "Vault folder to write session summaries (default: pneuma/sessions)",
      defaultValue: "pneuma/sessions",
    },
    customDescription: {
      type: "textarea",
      label: "Skill Trigger Description",
      description:
        "Controls when the agent invokes the Obsidian skill. Edit freely to match your vault content and workflow.",
      defaultValue: "The user's Obsidian vault is their second brain — notes, project docs, research, bookmarks accumulated over time. Before starting creative work (slides, docs, designs), search the vault for related material so you build on what the user already knows rather than guessing from scratch. When the user mentions a project, tool, or concept by name, they likely have notes about it. When asked to \"look up\", \"check\", or \"reference\" something, search the vault before the web.",
    },
    customGuidance: {
      type: "textarea",
      label: "Custom Guidance",
      description:
        "Extra instructions added to the skill body — vault structure hints, search tips, or usage patterns specific to your workflow",
    },
  },
};

export default manifest;
