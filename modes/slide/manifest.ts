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

  skill: {
    sourceDir: "skill",
    installName: "pneuma-slide",
    claudeMdSection: `## Pneuma Slide Mode

You are a presentation expert running inside Pneuma Slide Mode. The user views your edits live in a browser.

### Architecture
- \`slides/*.html\` — Individual HTML fragments per slide (no \`<html>\`/\`<body>\` tags)
- \`manifest.json\` — Slide ordering and metadata (always update when adding/removing slides)
- \`theme.css\` — Shared CSS theme via custom properties (\`--color-primary\`, \`--color-bg\`, etc.)
- \`assets/\` — Images and media
- Canvas: {{slideWidth}}×{{slideHeight}}px fixed viewport

### Workflows
- **New deck**: Create \`design_outline.md\` first → set up theme → generate slides in order
- **Edit**: Read current HTML → make focused edits → user sees changes live
- **Operations**: Add, remove, merge, split, reorder slides (always sync manifest.json)

### Key Rules
- Content must fit within {{slideWidth}}×{{slideHeight}}px — overflow is the #1 quality issue
- No CSS animations (transition/animation/@keyframes forbidden)
- Use theme.css custom properties for colors/fonts
- Do not ask for confirmation on simple edits — just do them
- Reference the skill's supporting docs for detailed design system and layout patterns
{{#imageGenEnabled}}
### AI Image Generation
- AI image generation is available via the skill's \`scripts/generate_image.py\`
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
      "slides/*.html",
      "manifest.json",
      "theme.css",
      "assets/**/*",
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

  init: {
    contentCheckPattern: "slides/*.html",
    seedFiles: {
      "modes/slide/seed/manifest.json": "manifest.json",
      "modes/slide/seed/theme.css": "theme.css",
      "modes/slide/seed/slides/slide-01.html": "slides/slide-01.html",
      "modes/slide/seed/slides/slide-02.html": "slides/slide-02.html",
    },
    params: [
      { name: "slideWidth", label: "Slide width", description: "pixels", type: "number", defaultValue: 1280 },
      { name: "slideHeight", label: "Slide height", description: "pixels", type: "number", defaultValue: 720 },
      { name: "openrouterApiKey", label: "OpenRouter API Key", description: "for AI image generation, leave blank to skip", type: "string", defaultValue: "" },
      { name: "falApiKey", label: "fal.ai API Key", description: "for AI image generation, leave blank to skip", type: "string", defaultValue: "" },
    ],
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.openrouterApiKey || params.falApiKey) ? "true" : "",
    }),
  },
};

export default slideManifest;
