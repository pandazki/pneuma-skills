/**
 * Cosmos Mode Manifest — pure data, no React deps.
 *
 * Cosmos lets the agent perform a structured projection on any content
 * the user brings, rendering its inner shape as an interactive graph.
 * Schema and dashboard tech-stack choice borrow from
 * Lum1104/Understand-Anything (MIT) — see NOTICE.md.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import type { Cosmos } from "./types.js";

const cosmosManifest: ModeManifest = {
  name: "cosmos",
  version: "0.1.0",

  displayName: {
    en: "Cosmos",
    "zh-CN": "星图",
    "zh-TW": "星圖",
    ja: "コスモス",
    ko: "코스모스",
  },

  description: {
    en: "Project any content — code, prose, research, business — as a structured cosmos: an interactive graph that lays its inner shape bare.",
    "zh-CN": "把任何内容——代码、小说、研究、商业流程——投影成一张结构化的星图：让它内在的脉络显形。",
    "zh-TW": "把任何內容——程式碼、小說、研究、商業流程——投影成一張結構化的星圖：讓它內在的脈絡顯形。",
    ja: "コード、文章、研究、業務フロー——あらゆるコンテンツを構造的に投影し、内なる輪郭を浮かび上がらせる対話型の宇宙図。",
    ko: "코드, 글, 연구, 비즈니스 프로세스 등 어떤 콘텐츠든 구조화된 우주도로 투영하여 그 내적 구조를 드러내는 인터랙티브 그래프.",
  },

  // Constellation — five dots loosely connected, single-stroke
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="1"/><circle cx="13" cy="4" r="1"/><circle cx="20" cy="9" r="1"/><circle cx="9" cy="13" r="1"/><circle cx="17" cy="18" r="1"/><circle cx="7" cy="20" r="1"/><path d="M5.5 6.5 12.5 4.5M13.5 4.5 19.5 8.5M5.5 7 9 12.5M13 5 9.5 12.5M9.5 13.5 16.5 17.5M9 13.5 7.5 19M17 18.5 8 20" opacity="0.6"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-cosmos",
    mdScene: `You and the user are doing a structured projection together. The user brings content — a codebase, a short story, a research paper, a business workflow — and you turn it into a *cosmos*: a graph of typed nodes and labeled edges that lays the work's inner shape bare. You read the content, choose a vocabulary fit for its domain (functions and modules for code; characters and clues for fiction; claims and evidence for research), and write a single \`cosmos.json\`. The user explores the cosmos in a live viewer, selects nodes, asks you to dive deeper, redirects your attention, or asks for a guided tour.`,
  },

  viewer: {
    watchPatterns: ["cosmos.json"],
    ignorePatterns: ["node_modules/**", "dist/**", ".pneuma/**"],
  },

  agent: {
    permissionMode: "bypassPermissions",
  },

  init: {
    contentCheckPattern: "cosmos.json",
    seedFiles: {
      "modes/cosmos/seed/": "",
    },
    params: [],
  },

  viewerApi: {
    workspace: {
      // The cosmos is one indivisible graph — viewer renders it as a whole;
      // the framework does not switch between files.
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Navigate to node",
        category: "navigate",
        agentInvocable: true,
        description:
          "Move the viewer to a specific node by address. Use after writing or refining a region of the cosmos so the user can see what changed.",
        params: {
          address: {
            type: "object",
            description:
              "ViewerAddress with `nodeId`, e.g. `{ nodeId: \"c-eliot\" }`.",
            required: true,
          },
        },
      },
      {
        id: "focus-layer",
        label: "Focus on layer",
        category: "ui",
        agentInvocable: true,
        description:
          "Dim everything outside the named layer so the user can study one slice (e.g. only the `clues` layer of a mystery, only the `service` layer of a codebase).",
        params: {
          address: {
            type: "object",
            description:
              "ViewerAddress with `layerId`, e.g. `{ layerId: \"clues\" }`.",
            required: true,
          },
        },
      },
      {
        id: "fit-view",
        label: "Fit to view",
        category: "navigate",
        agentInvocable: true,
        description:
          "Zoom out to fit the whole cosmos. Use when you want the user to see the big picture before diving in.",
        params: {},
      },
      {
        id: "switch-persona",
        label: "Switch persona",
        category: "ui",
        agentInvocable: true,
        description:
          "Change UI density: `overview` (labels only), `learn` (labels + brief summaries), `deep-dive` (everything, including edge descriptions and tags).",
        params: {
          persona: {
            type: "string",
            description: "One of `overview` | `learn` | `deep-dive`.",
            required: true,
          },
        },
      },
    ],
    commands: [
      {
        id: "regenerate",
        label: "Re-project",
        description:
          "User indicates the input has changed substantively (replaced input.md, added files) and wants a fresh projection. Re-read the inputs and rewrite cosmos.json.",
      },
      {
        id: "onboard",
        label: "Guided tour",
        description:
          "User wants a curated walkthrough — generate or refresh the `tour[]` in cosmos.json and step through it via `navigate-to`.",
      },
    ],
  },

  sources: {
    cosmos: {
      kind: "json-file",
      config: {
        path: "cosmos.json",
        parse: (raw: string): Cosmos => JSON.parse(raw) as Cosmos,
        serialize: (c: Cosmos): string => JSON.stringify(c, null, 2),
      },
    },
  },

  evolution: {
    directive: `Learn the user's structured-projection preferences over time: the content domains they bring (code / fiction / research / business / mixed), preferred node-type vocabularies per domain, default persona view, default layer slicing, degree of detail they like in summaries. Augment the skill so future cosmos sessions default to these preferences while respecting explicit overrides.`,
  },

  inspiredBy: {
    name: "Lum1104/Understand-Anything",
    url: "https://github.com/Lum1104/Understand-Anything",
  },
};

export default cosmosManifest;
