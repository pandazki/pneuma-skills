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
    mdScene: `You and the user are diagramming together inside Pneuma. The user watches a live draw.io canvas as you author \`.drawio\` XML — every Edit or Write streams into the preview, and they can click elements on the canvas to chat about them. You shape the diagram by writing files; the canvas re-renders as the XML changes.`,
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
