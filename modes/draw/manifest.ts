/**
 * Draw Mode Manifest — Excalidraw whiteboard/diagramming mode.
 *
 * Pure data declaration, no React dependency.
 * Safe to import from both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const drawManifest: ModeManifest = {
  name: "draw",
  version: "1.0.0",
  displayName: "Draw",
  description: "Excalidraw whiteboard for diagrams, wireframes, and visual thinking",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-draw",
    claudeMdSection: `## Pneuma Draw Mode

You are running inside Pneuma Draw Mode. A user is viewing your Excalidraw diagrams live in a browser.

**Important**: When the user asks you to create or modify diagrams, edit the .excalidraw JSON files directly using the Edit or Write tools. The user sees updates in real-time on the Excalidraw canvas.

- Workspace contains .excalidraw files (JSON format)
- Read the skill docs for Excalidraw element structure and properties
- Always produce valid Excalidraw JSON with type: "excalidraw" and elements array
- Do not ask for confirmation on simple edits — just do them`,
  },

  viewer: {
    watchPatterns: ["**/*.excalidraw"],
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
      "The user just opened the Pneuma Draw workspace with an Excalidraw canvas. Briefly greet them and let them know you're ready to help create diagrams, flowcharts, wireframes, and drawings. Keep it to 1-2 sentences.",
  },

  init: {
    contentCheckPattern: "**/*.excalidraw",
    seedFiles: {
      "modes/draw/seed/drawing.excalidraw": "drawing.excalidraw",
    },
  },
};

export default drawManifest;
