/**
 * WebCraft Mode Manifest — pure data declaration, no React dependency.
 * Can be safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadSite, saveSite } from "./domain.js";

const webcraftManifest: ModeManifest = {
  name: "webcraft",
  version: "1.2.0",
  displayName: "WebCraft",
  description: "Web design powered by Impeccable.style — 20 AI design commands, responsive preview, and export",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-webcraft",
    claudeMdSection: `## Pneuma WebCraft Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build web interfaces together — you edit files, the user sees live results in a browser preview panel.

This is **WebCraft Mode**: web design and development with Impeccable.style AI design intelligence.

For design principles, anti-patterns, editing conventions, and workspace constraints, consult the \`pneuma-webcraft\` skill.

### Core Rules
- Edit HTML, CSS, and JS files directly using Edit or Write tools — the user sees updates in real-time via iframe preview
- Follow Impeccable.style design principles: avoid AI slop aesthetics, commit to bold design directions
- Make focused, incremental edits; preserve existing structure unless asked to reorganize
- Do not modify \`.claude/\` directory — managed by runtime, edits get overwritten
- Do not ask for confirmation on simple edits — just do them
- When the user invokes an Impeccable command (audit, critique, polish, etc.), follow the corresponding command reference

### Importing External Content
When the user provides original content (uploaded files, pasted HTML, or a URL to convert), **always create a new content set** for it before making any edits:
1. Choose a short descriptive name for the content set (e.g. \`portfolio/\`, \`landing-page/\`)
2. Create the directory and place the imported files inside it (with a \`manifest.json\`)
3. Then begin editing within that content set

**Why**: Pneuma's workspace is organized around content sets — each is a self-contained, switchable project. Importing into a content set (rather than dumping files at the root) preserves the seed templates, enables side-by-side comparison between sets, and ensures all built-in features (set switching, per-set theming, export) work correctly.`,
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
    locatorDescription: 'After creating or editing pages, embed locator cards so the user can jump to them. Navigate to page: `data=\'{"page":"about.html"}\'`. Switch content set: `data=\'{"contentSet":"site-2"}\'`. Switch content set and page: `data=\'{"contentSet":"site-2","page":"about.html"}\'`.',
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
      "modes/webcraft/seed/pneuma/": "pneuma/",
      "modes/webcraft/seed/gazette/": "gazette/",
    },
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
