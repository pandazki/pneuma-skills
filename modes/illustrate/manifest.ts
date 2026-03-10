/**
 * Illustrate Mode Manifest — pure data, no React deps.
 * AI-powered illustration studio with row-based canvas and content sets.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const illustrateManifest: ModeManifest = {
  name: "illustrate",
  version: "0.2.0",
  displayName: "Illustrate",
  description: "AI illustration studio — describe what you see, generate and curate visual assets in a row-based canvas with content sets",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-illustrate",
    claudeMdSection: `## Pneuma Illustrate Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build visual assets together — you generate images, the user sees results in a live row-based canvas.

This is **Illustrate Mode**: AI-powered illustration creation with content sets and row-based organization.

For prompt crafting, style management, generation & editing workflows, consult the \`pneuma-illustrate\` skill.

### Core Rules
- Each top-level directory is a **content set** (project) with \`manifest.json\` + \`images/\`
- Always update \`manifest.json\` after generating — add placeholder items with \`"status": "generating"\` first, then update when done
- When user asks for variations, create a new row below the original
- When user asks to **modify** an existing image, use \`edit_image.mjs\` (not regenerate) to preserve composition
- When user highlights a region with the highlighter tool, pass the crop as \`--annotation\` to the edit script
- **New project → new content set** directory rather than overwriting existing content
- Do not ask for confirmation on simple generations — just do them
{{#imageGenEnabled}}
### Scripts
- \`scripts/generate_image.mjs\` — Generate new images from text prompts
- \`scripts/edit_image.mjs\` — Modify existing images (send original + instructions, optional annotation)
{{/imageGenEnabled}}`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
  },

  viewer: {
    watchPatterns: [
      "**/manifest.json",
      "**/images/**/*",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "CLAUDE.md",
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
      supportsContentSets: true,
    },
    actions: [
      {
        id: "navigate-to",
        label: "View Image",
        category: "navigate",
        agentInvocable: true,
        params: { file: { type: "string", description: "Image file path", required: true } },
        description: "Navigate to and select a specific image on the canvas",
      },
      {
        id: "fit-view",
        label: "Fit All",
        category: "navigate",
        agentInvocable: true,
        params: {},
        description: "Zoom to fit all content on the canvas",
      },
      {
        id: "zoom-to-row",
        label: "Zoom to Row",
        category: "navigate",
        agentInvocable: true,
        params: { rowId: { type: "string", description: "Row ID to zoom to", required: true } },
        description: "Zoom the canvas to focus on a specific row",
      },
    ],
    locatorDescription: 'After generating or editing images, embed locator cards so the user can jump to results. Navigate to a specific image: `data=\'{"file":"images/my-image.png"}\'`. Navigate to an entire row: `data=\'{"rowId":"row-label"}\'`. Switch content set: `data=\'{"contentSet":"project-2"}\'`. Switch content set and image: `data=\'{"contentSet":"project-2","file":"images/hero.png"}\'`.',
    scaffold: {
      description: "Initialize workspace with a content set and row structure from a theme description.",
      params: {
        title: { type: "string", description: "Project/content set title", required: true },
        images: { type: "string", description: "JSON array of {title, prompt, aspectRatio?}", required: true },
      },
      clearPatterns: ["**/images/*", "**/manifest.json"],
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Illustrate Mode" skill="pneuma-illustrate" session="new"></system-info>
The user just opened the illustration workspace. You are ready to assist with AI image generation and curation. Greet the user briefly (1-2 sentences) and mention they can describe what they'd like to create.`,
  },

  init: {
    contentCheckPattern: "**/manifest.json",
    seedFiles: {
      "modes/illustrate/seed/pneuma-brand/": "pneuma-brand/",
      "modes/illustrate/seed/feature-cards/": "feature-cards/",
      "modes/illustrate/seed/blog-heroes/": "blog-heroes/",
    },
    params: [
      { name: "openrouterApiKey", label: "OpenRouter API Key", description: "for AI image generation (recommended)", type: "string", defaultValue: "", sensitive: true },
      { name: "falApiKey", label: "fal.ai API Key", description: "alternative image generation backend", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.openrouterApiKey || params.falApiKey) ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn the user's visual style preferences from their conversation history.
Focus on: preferred aspect ratios, color palettes (warm/cool, saturated/muted),
illustration styles (realistic, cartoon, watercolor, vector, minimalist),
subject matter patterns, prompt engineering habits (level of detail, negative prompts),
and naming/organization conventions. Augment the skill to guide the main agent
toward these preferences as defaults while respecting explicit user instructions.`,
  },
};

export default illustrateManifest;
