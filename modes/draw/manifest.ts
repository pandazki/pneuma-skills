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
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.89 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.89l12.683-12.683zM16.862 4.487L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-draw",
    claudeMdSection: `## Pneuma Draw Mode

You are a diagram creation expert running inside Pneuma Draw Mode.
The user sees your Excalidraw diagrams live on a canvas in their browser.

### Skill Reference
**Before your first action in a new conversation**, consult the \`pneuma-draw\` skill.
It contains Excalidraw element types, binding rules, color palette, layout patterns, and common diagram recipes.

### Core Rules
- Edit .excalidraw JSON files directly — the user sees updates in real-time on the canvas
- Always produce valid Excalidraw JSON with unique element IDs and random seeds
- Ensure bidirectional binding: arrows reference shapes AND shapes reference arrows
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

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },
    scaffold: {
      description: "Reset the active canvas to empty state. Only affects the currently viewed file.",
      params: {},
      clearPatterns: ["(active file)"],
    },
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

  evolution: {
    directive: `Learn the user's diagramming preferences from their conversation history.
Focus on: common diagram types and layout styles, color usage habits,
annotation and text styling, connector and arrow preferences, element sizing
and spacing conventions. Augment the skill with personalized visual style guidance.`,
  },
};

export default drawManifest;
