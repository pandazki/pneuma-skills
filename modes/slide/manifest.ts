/**
 * Slide Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadDeck, saveDeck } from "./domain.js";

const slideManifest: ModeManifest = {
  name: "slide",
  version: "1.2.0",
  displayName: "Slide",
  description: "HTML presentations with content sets, drag-reorder, presenter mode, and PDF/image export",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-slide",
    mdScene: `You and the user are building an HTML presentation together inside Pneuma. The user watches a live deck preview as you edit — each slide is a fixed-viewport HTML fragment, and the workspace can hold multiple content sets the user flips between via drag-reorder, presenter mode, or the set switcher. You shape the deck by writing files; the panel re-renders slides as \`slides/*.html\`, \`manifest.json\`, and \`theme.css\` change.`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    sharedScripts: ["generate_image.mjs"],
  },

  viewer: {
    watchPatterns: [
      "**/slides/*.html",
      "**/manifest.json",
      "**/theme.css",
      "**/assets/**/*",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    deck: {
      kind: "aggregate-file",
      config: {
        patterns: [
          "**/slides/*.html",
          "**/manifest.json",
          "**/theme.css",
        ],
        load: loadDeck,
        save: saveDeck,
      },
    },
    assets: {
      kind: "file-glob",
      config: { patterns: ["**/assets/**/*"] },
    },
    // Companion file-glob for raw content reads. The `deck` aggregate-file
    // source exposes structural metadata (titles, ordering); this source
    // exposes the raw file contents used by the iframe srcdoc path,
    // theme.css lookup, and slide HTML rendering.
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/slides/*.html",
          "**/manifest.json",
          "**/theme.css",
          "**/assets/**/*",
        ],
      },
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Slide Mode" skill="pneuma-slide" session="new"></system-info>
The user just opened the workspace. You are ready to assist with presentation creation and editing. Greet the user briefly (1-2 sentences) and mention they can describe a topic to get started.`,
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      supportsContentSets: true,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Go to Slide",
        category: "navigate",
        agentInvocable: true,
        params: { file: { type: "string", description: "Slide file path", required: true } },
        description: "Navigate to a specific slide",
      },
    ],
    scaffold: {
      description: "Initialize workspace with slide scaffolding from a structure spec. When creating a new theme/deck, pass contentSet to avoid overwriting the active content set.",
      params: {
        title: { type: "string", description: "Presentation title", required: true },
        slides: { type: "string", description: "JSON array of {title, subtitle?}", required: true },
        contentSet: { type: "string", description: "Target content set name (e.g. 'my-theme'). If omitted, overwrites the active content set.", required: false },
      },
      clearPatterns: ["slides/*.html", "manifest.json"],
    },
  },

  init: {
    contentCheckPattern: "**/slides/*.html",
    seedFiles: {
      "modes/slide/seed/en-dark/": "en-dark/",
      "modes/slide/seed/en-light/": "en-light/",
      "modes/slide/seed/zh-dark/": "zh-dark/",
      "modes/slide/seed/zh-light/": "zh-light/",
    },
    params: [
      { name: "slideWidth", label: "Slide width", description: "pixels", type: "number", defaultValue: 1280 },
      { name: "slideHeight", label: "Slide height", description: "pixels", type: "number", defaultValue: 720 },
      { name: "openrouterApiKey", label: "OpenRouter API Key", description: "for AI image generation, leave blank to skip", type: "string", defaultValue: "", sensitive: true },
      { name: "falApiKey", label: "fal.ai API Key", description: "for AI image generation, leave blank to skip", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.openrouterApiKey || params.falApiKey) ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn the user's presentation style preferences from their conversation history.
Focus on: typography choices (fonts, sizes, weights), color palette tendencies (dark/light,
warm/cool, specific colors), layout density (text per slide, whitespace preferences),
content structure patterns (heading levels, list vs paragraph, code block usage),
and visual element preferences (image frequency, emoji/icon usage, gradient vs flat).
Augment the skill to guide the main agent toward these preferences as defaults
while always respecting the user's explicit instructions.`,
  },
};

export default slideManifest;
