/**
 * Remotion Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const remotionManifest: ModeManifest = {
  name: "remotion",
  version: "0.1.0",
  displayName: "Remotion",
  description: "Programmatic video creation with React — live preview with custom Player",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/><line x1="12" y1="3" x2="12" y2="21" opacity="0.3"/></svg>`,
  supportedBackends: ["claude-code"],
  inspiredBy: {
    name: "troyhua/claude-code-remotion",
    url: "https://github.com/troyhua/claude-code-remotion",
  },
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-remotion",
    mdScene: `You and the user are creating programmatic video together inside Pneuma. The user watches a live Player panel as you write Remotion compositions — every Edit or Write you do recompiles in-browser within a second, with frame-accurate scrubbing, so they can react to motion the moment it appears. You shape the video by writing React files in \`src/\`; the panel renders the active composition as files change.`,
  },

  viewer: {
    watchPatterns: [
      // Single project (workspace root)
      "src/**/*.tsx",
      "src/**/*.ts",
      "src/**/*.css",
      "public/**",
      // Content set projects (subdirectory per project)
      "*/src/**/*.tsx",
      "*/src/**/*.ts",
      "*/src/**/*.css",
      "*/public/**",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "src/**/*.tsx", "src/**/*.ts", "src/**/*.css", "public/**",
          "*/src/**/*.tsx", "*/src/**/*.ts", "*/src/**/*.css", "*/public/**",
        ],
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
    },
    actions: [
      {
        id: "get-playback-state",
        label: "Get Playback State",
        category: "custom",
        agentInvocable: true,
        description:
          "Query the current playback state: composition, frame, duration, playing, speed, all compositions list",
      },
      {
        id: "seek-to-frame",
        label: "Seek to Frame",
        category: "navigate",
        agentInvocable: true,
        params: {
          frame: {
            type: "number",
            description: "Target frame number (0-based)",
            required: true,
          },
        },
        description: "Navigate to a specific frame",
      },
      {
        id: "set-playback-rate",
        label: "Set Playback Rate",
        category: "ui",
        agentInvocable: true,
        params: {
          rate: {
            type: "number",
            description: "Playback speed (0.25 to 4)",
            required: true,
          },
        },
        description: "Change playback speed",
      },
      {
        id: "set-composition",
        label: "Switch Composition",
        category: "navigate",
        agentInvocable: true,
        params: {
          compositionId: {
            type: "string",
            description: "Composition ID to switch to",
            required: true,
          },
        },
        description: "Switch the active composition in the viewer",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Remotion" backend="claude-code">New Remotion session started. The viewer is ready — your compositions will preview live as you write them.</system-info>`,
  },

  init: {
    contentCheckPattern: "src/Root.tsx",
    seedFiles: {
      "modes/remotion/seed/default/": "./",
    },
    params: [
      { name: "compositionWidth", label: "Composition width", description: "pixels", type: "number", defaultValue: 1280 },
      { name: "compositionHeight", label: "Composition height", description: "pixels", type: "number", defaultValue: 720 },
    ],
  },

  evolution: {
    directive:
      "Extract the user's video style preferences: motion design (easing curves, timing, transitions), typography (fonts, sizes, weights), color palettes, composition layout patterns, pacing/rhythm, and visual effects.",
  },
};

export default remotionManifest;
