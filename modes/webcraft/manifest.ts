/**
 * WebCraft Mode Manifest — pure data declaration, no React dependency.
 * Can be safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadSite, saveSite } from "./domain.js";

const webcraftManifest: ModeManifest = {
  name: "webcraft",
  version: "1.3.0",
  displayName: "WebCraft",
  description: "Web design powered by Impeccable.style — 22 AI design commands, responsive preview, and export",
  changelog: {
    "1.3.0": [
      "Synced Impeccable.style guidance to upstream v3.0.1",
      "Added Document and Onboard commands (22 total)",
      "New Pneuma Console seed showcases the product register vs the brand register",
      "Pneuma stays the default seed regardless of alphabetical order",
      "Internal page links inside seeds no longer 404 in the preview iframe",
      "Skill update prompt now lists the highlights and links to the full changelog",
    ],
    "1.2.0": [
      "Added Gazette seed (editorial long-form template)",
      "Image generation scripts for hero illustrations and asset edits",
    ],
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-webcraft",
    mdScene: `You and the user are designing a web page together inside Pneuma. The user watches a live responsive preview as you edit HTML, CSS, and JS files — every change appears immediately, and the toolbar exposes 22 Impeccable.style design commands for deeper guidance. When the page is ready they can export it as a static site or deploy it to Vercel or Cloudflare Pages.`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    sharedScripts: ["generate_image.mjs", "edit_image.mjs"],
  },

  viewer: {
    watchPatterns: [
      "**/*.html",
      "**/*.css",
      "**/*.js",
      "**/*.jsx",
      "**/*.ts",
      "**/*.tsx",
      "**/*.json",
      "**/*.svg",
      "**/*.png",
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.gif",
      "**/*.webp",
      "**/*.woff",
      "**/*.woff2",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    // Structural site metadata: manifest.json files + html page list.
    // Aggregate-file so the viewer can consume a typed `Site` via useSource.
    site: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/*.html", "**/manifest.json"],
        load: loadSite,
        save: saveSite,
      },
    },
    // Static assets + source files still flow through a file-glob; they
    // back the high-frequency iframe srcdoc construction path that keeps
    // reading from the legacy `files` prop through P5.11.
    assets: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/*.css",
          "**/*.js",
          "**/*.jsx",
          "**/*.ts",
          "**/*.tsx",
          "**/*.svg",
          "**/*.png",
          "**/*.jpg",
          "**/*.jpeg",
          "**/*.gif",
          "**/*.webp",
          "**/*.woff",
          "**/*.woff2",
        ],
      },
    },
    // Companion file-glob for raw HTML content reads. The iframe srcdoc
    // path and handleTextEdit need the full original document content to
    // splice <body> edits back in, which is beyond what the structural
    // `site` aggregate-file exposes.
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/*.html",
          "**/*.css",
          "**/*.js",
          "**/*.jsx",
          "**/*.ts",
          "**/*.tsx",
          "**/*.json",
          "**/*.svg",
          "**/*.png",
          "**/*.jpg",
          "**/*.jpeg",
          "**/*.gif",
          "**/*.webp",
          "**/*.woff",
          "**/*.woff2",
        ],
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      manifestFile: "manifest.json",
    },
    scaffold: {
      description: "Initialize workspace with HTML pages from a site structure spec.",
      params: {
        title: { type: "string", description: "Site or project title", required: true },
        pages: { type: "string", description: "JSON array of {name, title?} for each HTML page", required: true },
      },
      clearPatterns: ["**/*.html", "**/manifest.json"],
    },
    commands: [
      { id: "teach", label: "Teach", description: "Gather design context for the project and save persistent guidelines to .impeccable.md" },
      { id: "document", label: "Document", description: "Generate a DESIGN.md at the project root capturing the current visual design system in Google Stitch format" },
      { id: "shape", label: "Shape", description: "Run a discovery interview and produce a design brief before any code is written" },
      { id: "craft", label: "Craft", description: "Shape-then-build: run the discovery flow, then implement the feature in one pass" },
      { id: "audit", label: "Audit", description: "Comprehensive quality audit across accessibility, performance, theming, and responsive design" },
      { id: "critique", label: "Critique", description: "Holistic UX design critique evaluating hierarchy, architecture, and emotional resonance" },
      { id: "polish", label: "Polish", description: "Final quality pass aligning the feature to the design system — fixes spacing, consistency, and drift" },
      { id: "distill", label: "Distill", description: "Strip design to its essence by removing unnecessary complexity" },
      { id: "clarify", label: "Clarify", description: "Improve unclear UX copy, error messages, labels, and instructions" },
      { id: "typeset", label: "Typeset", description: "Improve typography: font selection, modular scale, weight, rhythm, and readability" },
      { id: "layout", label: "Layout", description: "Improve layout, spacing, and visual rhythm — fix monotonous grids and weak hierarchy" },
      { id: "optimize", label: "Optimize", description: "Improve performance across loading speed, rendering, animations, and bundle size" },
      { id: "harden", label: "Harden", description: "Make interfaces production-ready: error handling, empty states, onboarding flows, i18n, and edge cases" },
      { id: "onboard", label: "Onboard", description: "Design first-run flows, empty states, and activation moments that get users to value quickly" },
      { id: "animate", label: "Animate", description: "Add purposeful animations, micro-interactions, and motion effects" },
      { id: "colorize", label: "Colorize", description: "Add strategic color to monochromatic or visually flat interfaces" },
      { id: "bolder", label: "Bolder", description: "Amplify safe or boring designs to be more visually impactful" },
      { id: "quieter", label: "Quieter", description: "Tone down overly bold or aggressive designs to be more refined" },
      { id: "delight", label: "Delight", description: "Add moments of joy, personality, and unexpected polish" },
      { id: "overdrive", label: "Overdrive", description: "Push interfaces past conventional limits with technically ambitious implementations" },
      { id: "extract", label: "Extract", description: "Extract reusable components, design tokens, and patterns into a design system" },
      { id: "adapt", label: "Adapt", description: "Adapt designs for different screen sizes, devices, contexts, or platforms" },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma WebCraft Mode" skill="pneuma-webcraft" session="new"></system-info>
The user just opened the workspace. You are ready to assist with web design and development, powered by Impeccable.style design intelligence. Greet the user briefly (1-2 sentences). Mention the Impeccable design commands are available via the toolbar.`,
  },

  init: {
    contentCheckPattern: "**/manifest.json",
    seedFiles: {
      // Order matters — the resolver preserves filesystem discovery order
      // (which mirrors install order), so the first seed becomes the
      // default content set on first launch. pneuma is the brand-register
      // primary; console is the product-register companion.
      "modes/webcraft/seed/pneuma/":         "pneuma/",
      "modes/webcraft/seed/gazette/":        "gazette/",
      "modes/webcraft/seed/pneuma-console/": "pneuma-console/",
    },
    params: [
      { name: "falApiKey", label: "fal.ai API Key", description: "for AI image generation (default model: gpt-image-2)", type: "string", defaultValue: "", sensitive: true },
      { name: "openrouterApiKey", label: "OpenRouter API Key", description: "optional fallback for Gemini 3 Pro; leave blank to skip", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.falApiKey || params.openrouterApiKey) ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn the user's web design preferences from their conversation history.
Focus on: aesthetic direction (minimal/bold/organic/etc.), color palette tendencies,
typography choices (font families, scale preferences), layout patterns (grid vs flexbox,
spacing density), animation preferences (subtle vs dramatic), component architecture
patterns, and framework/library preferences.
Augment the skill with personalized design guidance that reflects the user's style.`,
  },
};

export default webcraftManifest;
