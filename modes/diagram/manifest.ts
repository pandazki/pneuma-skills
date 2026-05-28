import type { ModeManifest } from "../../core/types/mode-manifest.js";

const diagramManifest: ModeManifest = {
  name: "diagram",
  version: "1.0.0",
  displayName: {
    en: "Diagram",
    "zh-CN": "图表",
    "zh-TW": "圖表",
    ja: "図表",
    ko: "다이어그램",
    es: "Diagrama",
    de: "Diagramm",
  },
  description: {
    en: "Professional diagrams powered by draw.io — flowcharts, architecture, UML, and more",
    "zh-CN": "由 draw.io 驱动的专业图表 —— 流程图、架构图、UML 等",
    "zh-TW": "由 draw.io 驅動的專業圖表 —— 流程圖、架構圖、UML 等",
    ja: "draw.io によるプロフェッショナル図表 —— フローチャート、アーキテクチャ、UML など",
    ko: "draw.io 기반의 전문 다이어그램 —— 플로우차트, 아키텍처, UML 등",
    es: "Diagramas profesionales con draw.io —— diagramas de flujo, arquitectura, UML y más",
    de: "Professionelle Diagramme mit draw.io —— Flussdiagramme, Architektur, UML und mehr",
  },
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
    seeds: [
      {
        id: "pneuma-overview",
        sourceKey: "modes/diagram/seed/diagram.drawio",
        thumbnail: "pneuma-overview.png",
        displayName: {
          en: "Pneuma architecture overview",
          "zh-CN": "Pneuma 架构总览",
          "zh-TW": "Pneuma 架構總覽",
        },
        description: {
          en: "Multi-page draw.io tour — architecture, lifecycle, communication. A real diagram you can drill into.",
          "zh-CN": "多页 draw.io 图表 —— 架构、生命周期、通信。一个可以钻进去看的真实示例。",
        },
        tags: ["Architecture"],
      },
    ],
  },

  evolution: {
    directive:
      "Learn the user's diagramming preferences: diagram types, layout styles, color choices, shapes, connector styles, labeling conventions, and level of detail.",
  },
};

export default diagramManifest;
