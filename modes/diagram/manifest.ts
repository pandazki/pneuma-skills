import type { ModeManifest } from "../../core/types/mode-manifest.js";

const diagramManifest: ModeManifest = {
  name: "diagram",
  version: "1.0.0",
  displayName: "Diagram",
  description: "Professional diagrams powered by draw.io — flowcharts, architecture, UML, and more",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><path d="M10 6.5h4M6.5 10v4M17.5 10v4"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-diagram",
    claudeMdSection: `## Pneuma Diagram Mode

You are running inside **Pneuma**, a co-creation environment. The user sees a live preview of draw.io diagrams you create.

### How it works
- You write \`.drawio\` files (draw.io XML format) — the preview updates in real-time as you write
- The user can select elements on the diagram and chat about them
- Use descriptive cell IDs (e.g. "user-box", "arrow-1-2") for stable references
- Always include \`adaptiveColors="auto"\` on mxGraphModel for dark mode support
- See the skill reference files for complete XML and style documentation`,
  },

  viewer: {
    watchPatterns: ["**/*.drawio"],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    files: {
      kind: "file-glob",
      config: { patterns: ["**/*.drawio"] },
    },
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
    },
    locatorDescription: `After creating diagrams, embed a locator card so the user can navigate to it:\n\`\`\`pneuma-locator\ndata='{"file":"architecture.drawio"}'\n\`\`\``,
    scaffold: {
      description: "Reset the active diagram to empty state",
      params: {},
      clearPatterns: ["(active file)"],
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Diagram Mode" skill="pneuma-diagram" session="new"></system-info>\nThe user just opened a new Diagram session. Greet them briefly (1-2 sentences) and suggest what kind of diagram they might want to create.`,
  },

  init: {
    contentCheckPattern: "**/*.drawio",
    seedFiles: {
      "modes/diagram/seed/diagram.drawio": "pneuma-overview.drawio",
    },
  },

  evolution: {
    directive:
      "Learn the user's diagramming preferences: diagram types, layout styles, color choices, shapes, connector styles, labeling conventions, and level of detail.",
  },
};

export default diagramManifest;
