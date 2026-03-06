/**
 * Slide Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const slideManifest: ModeManifest = {
  name: "slide",
  version: "1.2.0",
  displayName: "Slide",
  description: "Professional presentation creation and editing with per-slide HTML files",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-slide",
    claudeMdSection: `## Pneuma Slide Mode

You are a presentation expert running inside Pneuma Slide Mode.
The user sees your edits live in a browser preview panel.

### Skill Reference
**Before your first action in a new conversation**, consult the \`pneuma-slide\` skill.
It contains the design-first workflow, height calculation rules, layout patterns,
image handling, and quality checklist.

### Architecture
- \`slides/*.html\` — Individual HTML fragments per slide (no \`<html>\`/\`<body>\` tags)
- \`manifest.json\` — Slide ordering and metadata (always update when adding/removing slides)
- \`theme.css\` — Shared CSS theme via custom properties (\`--color-primary\`, \`--color-bg\`, etc.)
- \`assets/\` — Images and media
- Canvas: {{slideWidth}}×{{slideHeight}}px fixed viewport

### Core Rules
- Content must fit within {{slideWidth}}×{{slideHeight}}px — overflow is the #1 quality issue
- No CSS animations (transition/animation/@keyframes forbidden)
- For new decks: create \`design_outline.md\` first → set up theme → scaffold → fill content
- Use theme.css custom properties for colors/fonts
- Do not ask for confirmation on simple edits — just do them
{{#imageGenEnabled}}
### AI Image Generation
- AI image generation is available via the skill's \`scripts/generate_image.mjs\`
- Use it to create contextual illustrations, diagrams, and visuals for slides
- Always prefer CSS/SVG for geometric shapes and icons — use AI images for photos and complex illustrations
- Place generated images in \`assets/\` and reference with \`<img src="assets/...">\`
{{/imageGenEnabled}}`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
  },

  viewer: {
    watchPatterns: [
      "**/slides/*.html",
      "**/manifest.json",
      "**/theme.css",
      "**/assets/**/*",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
    ],
    serveDir: ".",
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting:
      "The user just opened the Pneuma slide editor. Greet them briefly (1-2 sentences) and let them know you can create full presentation decks from scratch (with design outlines and themed slides) or edit existing slides. Mention they can describe a topic to get started.",
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
      description: "Initialize workspace with slide scaffolding from a structure spec.",
      params: {
        title: { type: "string", description: "Presentation title", required: true },
        slides: { type: "string", description: "JSON array of {title, subtitle?}", required: true },
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
