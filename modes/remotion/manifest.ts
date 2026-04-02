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
    claudeMdSection: `## Pneuma Remotion Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build content together — you edit files, the user sees live results in a browser preview panel.

This is **Remotion Mode**: programmatic video creation with React.

**The viewer automatically compiles and previews your compositions in real-time — no need to start any dev server for preview.**

For animation patterns, timing, sequencing, and all Remotion API details, consult the \`pneuma-remotion\` skill.

### Core Rules
- All animation MUST use Remotion's frame-based APIs (\`useCurrentFrame\`, \`interpolate\`, \`spring\`)
- **CSS transitions/animations are FORBIDDEN** — they don't render to video
- Always import from \`"remotion"\` — the viewer provides these APIs at runtime
- Use \`staticFile()\` for assets in \`public/\`
- Follow Impeccable.style design principles for visual quality

### Canvas
- Default composition size: {{compositionWidth}}×{{compositionHeight}}px
- All visual content must fit within this canvas — design to fill the frame, avoid sparse layouts
- When creating new compositions, use width={{{compositionWidth}}} height={{{compositionHeight}}} unless the user specifies otherwise

### Architecture
- \`src/index.ts\` — Entry point (\`registerRoot()\`)
- \`src/Root.tsx\` — Composition registry (declare all compositions here)
- \`src/*.tsx\` — Video components
- \`public/\` — Static assets (reference via \`staticFile()\`)

### Viewer Capabilities
The viewer provides these agent-callable actions:
- \`get-playback-state\` — Query current composition, frame, playing state
- \`seek-to-frame\` — Navigate to a specific frame (\`params: { frame: number }\`)
- \`set-playback-rate\` — Adjust playback speed (\`params: { rate: number }\`)
- \`set-composition\` — Switch active composition (\`params: { compositionId: string }\`)

### Preview Limitations
The live preview compiles your code in-browser with core Remotion APIs. For features requiring additional packages (\`@remotion/google-fonts\`, \`@remotion/three\`, etc.), tell the user to use Remotion Studio: \`npx remotion studio\`.

### Constraints
- Do not modify \`.claude/\`, \`.pneuma/\`, or \`node_modules/\`
- Keep compositions in \`src/\` directory
- Use descriptive composition IDs (they appear in the viewer dropdown)`,
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

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
    },
    locatorDescription: 'After creating or editing compositions, embed locator cards so the user can jump to them. Navigate by composition: `data=\'{"file":"MyComposition"}\'`. Loop a specific section: `data=\'{"file":"MyComposition","inFrame":90,"outFrame":150}\'` — this sets the in/out points and starts loop playback. The "file" field is the composition ID from Root.tsx. Frame numbers are 0-based.',
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
