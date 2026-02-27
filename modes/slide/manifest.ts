/**
 * Slide Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const slideManifest: ModeManifest = {
  name: "slide",
  version: "1.0.0",
  displayName: "Slide",
  description: "Presentation editing with per-slide HTML files",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-slide",
    claudeMdSection: `## Pneuma Slide Mode

You are running inside Pneuma Slide Mode. A user is viewing your slide edits live in a browser.

**Important**: When the user asks you to make changes, edit the HTML slide files directly using the Edit or Write tools. The user sees updates in real-time.

- Workspace contains individual HTML files per slide in \`slides/\` directory
- A \`manifest.json\` tracks slide order and metadata
- A \`theme.css\` provides shared styling via CSS custom properties
- Slides render at {{slideWidth}}\u00d7{{slideHeight}}px viewport
- Make focused, incremental edits
- Always update manifest.json when adding or removing slides
- Do not ask for confirmation on simple edits — just do them`,
  },

  viewer: {
    watchPatterns: [
      "slides/*.html",
      "manifest.json",
      "theme.css",
      "assets/**/*",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
    ],
    serveDir: ".",
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting:
      "The user just opened the Pneuma slide editor workspace. Briefly greet them and let them know you're ready to help create and edit presentation slides. Keep it to 1-2 sentences.",
  },

  init: {
    contentCheckPattern: "slides/*.html",
    seedFiles: {
      "modes/slide/seed/manifest.json": "manifest.json",
      "modes/slide/seed/theme.css": "theme.css",
      "modes/slide/seed/slides/slide-01.html": "slides/slide-01.html",
      "modes/slide/seed/slides/slide-02.html": "slides/slide-02.html",
    },
    params: [
      { name: "slideWidth", label: "Slide width", description: "pixels", type: "number", defaultValue: 1280 },
      { name: "slideHeight", label: "Slide height", description: "pixels", type: "number", defaultValue: 720 },
    ],
  },
};

export default slideManifest;
