/**
 * WebCraft Mode Manifest — pure data declaration, no React dependency.
 * Can be safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const webcraftManifest: ModeManifest = {
  name: "webcraft",
  version: "1.0.0",
  displayName: "WebCraft",
  description: "Web design powered by Impeccable.style — 17 AI design commands, responsive preview, and export",
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
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "CLAUDE.md",
      "dist/**",
      "build/**",
      ".next/**",
      ".nuxt/**",
      ".svelte-kit/**",
      ".output/**",
      "coverage/**",
      ".cache/**",
      ".parcel-cache/**",
      "*.log",
    ],
    serveDir: ".",
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
    actions: [
      // Setup
      {
        id: "teach-impeccable",
        label: "Teach Impeccable",
        category: "custom",
        agentInvocable: false,
        description: "Gather design context for the project and establish persistent design guidelines",
      },
      // Review
      {
        id: "audit",
        label: "Audit",
        category: "custom",
        agentInvocable: false,
        description: "Comprehensive quality audit across accessibility, performance, theming, and responsive design",
      },
      {
        id: "critique",
        label: "Critique",
        category: "custom",
        agentInvocable: false,
        description: "Holistic UX design critique evaluating hierarchy, architecture, and emotional resonance",
      },
      // Refine
      {
        id: "normalize",
        label: "Normalize",
        category: "custom",
        agentInvocable: false,
        description: "Align design to match design system standards and ensure consistency",
      },
      {
        id: "polish",
        label: "Polish",
        category: "custom",
        agentInvocable: false,
        description: "Final quality pass fixing alignment, spacing, consistency, and detail issues",
      },
      {
        id: "distill",
        label: "Distill",
        category: "custom",
        agentInvocable: false,
        description: "Strip design to its essence by removing unnecessary complexity",
      },
      {
        id: "clarify",
        label: "Clarify",
        category: "custom",
        agentInvocable: false,
        description: "Improve unclear UX copy, error messages, labels, and instructions",
      },
      // Performance
      {
        id: "optimize",
        label: "Optimize",
        category: "custom",
        agentInvocable: false,
        description: "Improve performance across loading speed, rendering, animations, and bundle size",
      },
      {
        id: "harden",
        label: "Harden",
        category: "custom",
        agentInvocable: false,
        description: "Improve resilience through error handling, i18n, text overflow, and edge cases",
      },
      // Style
      {
        id: "animate",
        label: "Animate",
        category: "custom",
        agentInvocable: false,
        description: "Add purposeful animations, micro-interactions, and motion effects",
      },
      {
        id: "colorize",
        label: "Colorize",
        category: "custom",
        agentInvocable: false,
        description: "Add strategic color to monochromatic or visually flat interfaces",
      },
      {
        id: "bolder",
        label: "Bolder",
        category: "custom",
        agentInvocable: false,
        description: "Amplify safe or boring designs to be more visually impactful",
      },
      {
        id: "quieter",
        label: "Quieter",
        category: "custom",
        agentInvocable: false,
        description: "Tone down overly bold or aggressive designs to be more refined",
      },
      {
        id: "delight",
        label: "Delight",
        category: "custom",
        agentInvocable: false,
        description: "Add moments of joy, personality, and unexpected polish",
      },
      // Architecture
      {
        id: "extract",
        label: "Extract",
        category: "custom",
        agentInvocable: false,
        description: "Extract reusable components, design tokens, and patterns into a design system",
      },
      {
        id: "adapt",
        label: "Adapt",
        category: "custom",
        agentInvocable: false,
        description: "Adapt designs for different screen sizes, devices, contexts, or platforms",
      },
      {
        id: "onboard",
        label: "Onboard",
        category: "custom",
        agentInvocable: false,
        description: "Design or improve onboarding flows, empty states, and first-time user experiences",
      },
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
