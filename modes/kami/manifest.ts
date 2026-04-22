/**
 * Kami Mode Manifest — paper-canvas web design with warm parchment aesthetic.
 * Design language adapted from tw93/kami (MIT). See NOTICE.md.
 *
 * Pure data declaration, no React dependency. Safe to import from both
 * backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadSite, saveSite } from "./domain.js";

const PAPER_SIZES_MM: Record<string, [number, number]> = {
  A4:     [210, 297],
  A5:     [148, 210],
  A3:     [297, 420],
  Letter: [216, 279],
  Legal:  [216, 356],
};

// Safe-area margin presets per paper size (printable content zone).
// Top/bottom/side in mm. Landscape reuses the same values — margins
// live in the same axes regardless of orientation.
const SAFE_MARGINS_MM: Record<string, { top: number; side: number; bottom: number }> = {
  A4:     { top: 18, side: 16, bottom: 18 },
  A5:     { top: 14, side: 12, bottom: 14 },
  A3:     { top: 22, side: 20, bottom: 22 },
  Letter: { top: 18, side: 18, bottom: 18 },
  Legal:  { top: 18, side: 18, bottom: 18 },
};

const kamiManifest: ModeManifest = {
  name: "kami",
  version: "1.0.0",
  displayName: "Kami",
  description: "Paper-canvas web design with warm parchment aesthetic — design language adapted from tw93/kami (MIT)",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-kami",
    claudeMdSection: `## Pneuma Kami Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build web interfaces together — you edit files, the user sees live results in the iframe preview.

This is **Kami Mode**: paper-canvas web design. The viewer renders your content as a single paper sheet, size locked to **{{paperSize}} {{orientation}}** ({{pageWidthMm}} × {{pageHeightMm}} mm) at workspace creation.

**Design language adapted from [tw93/kami](https://github.com/tw93/kami) (MIT).** See \`NOTICE.md\` for full attribution. For aesthetic rules, file layout, and do/don't specifics, consult the \`pneuma-kami\` skill.

### Core Rules
- Edit HTML/CSS/JS files directly — the user sees updates live
- Keep canvas warm (\`#f5f4ed\` parchment, never pure white)
- Single accent color: ink blue \`#1B365D\`. No gradients, no second chromatic hue, no hard drop shadows
- Serif (TsangerJinKai02 CN / Newsreader EN) weight locked at 500. Never bold.
- **Do not change paper size** — it is locked in \`.pneuma/config.json\`. If the user wants a different size, they must create a new workspace.
- Do not edit \`_shared/styles.css\` tokens casually. Aesthetic drift compounds fast.
- When importing raw content, create a new content set (see \`skill/references/writing.md\`).
- Do not modify \`.claude/\` directory — it's runtime-managed.
{{#imageGenEnabled}}

### AI Image Generation
- \`scripts/generate_image.mjs\` — Generate images from text prompts (default model: \`gpt-image-2\`, strong at legible labels for diagrams and mockups)
- Save generated images to the active content set's \`assets/\` directory (alongside the existing \`_shared/assets/\`)
- Every image must respect kami's aesthetic — warm palette, no second chromatic hue, no drop shadows/gradients/glow. See the "Image Generation" section of the \`pneuma-kami\` skill for the slop-test and prompt patterns.
- After embedding an image, re-read \`.pneuma/kami-fit.json\` — images change page height and can tip a previously-fitting page into overflow.
{{/imageGenEnabled}}`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    sharedScripts: ["generate_image.mjs"],
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
    site: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/*.html", "**/manifest.json"],
        load: loadSite,
        save: saveSite,
      },
    },
    assets: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/*.css", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx",
          "**/*.svg", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp",
          "**/*.woff", "**/*.woff2", "**/*.ttf",
        ],
      },
    },
    // Raw HTML / CSS / JS source — the iframe srcdoc path reads this to
    // splice body edits back and to serve asset references. Matches webcraft's
    // `files` source; WebPreview (which KamiPreview forks) consumes it.
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/*.html", "**/*.css", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx",
          "**/*.json",
          "**/*.svg", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp",
          "**/*.woff", "**/*.woff2",
        ],
      },
    },
    config: {
      kind: "json-file",
      config: {
        path: ".pneuma/config.json",
        parse: (raw: string) => JSON.parse(raw),
        serialize: (v: unknown) => JSON.stringify(v, null, 2),
      },
    },
  },

  init: {
    contentCheckPattern: "**/manifest.json",
    seedFiles: {
      "modes/kami/seed/_shared/":          "_shared/",
      // Two demos: one-pager as the primary (single-sheet fit to safe
      // area) and portfolio as a multi-sheet reference. Dropped the
      // blank starter and musk-resume — the two remaining demos cover
      // the single- vs multi-sheet spectrum cleanly enough and the
      // fewer files a user sees on first run, the faster they decide.
      "modes/kami/seed/pneuma-one-pager/": "pneuma-one-pager/",
      "modes/kami/seed/kaku-portfolio/":   "kaku-portfolio/",
    },
    params: [
      { name: "paperSize",   label: "Paper size",  type: "select", options: ["A4", "A5", "A3", "Letter", "Legal"], defaultValue: "A4" },
      { name: "orientation", label: "Orientation", type: "select", options: ["Portrait", "Landscape"],             defaultValue: "Portrait" },
      { name: "falApiKey",        label: "fal.ai API Key",     description: "for AI image generation (default model: gpt-image-2)", type: "string", defaultValue: "", sensitive: true },
      { name: "openrouterApiKey", label: "OpenRouter API Key", description: "optional fallback for Gemini 3 Pro; leave blank to skip", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (p) => {
      const size = String(p.paperSize);
      const dims = PAPER_SIZES_MM[size];
      if (!dims) throw new Error(`Unknown paperSize: ${size}`);
      const [w, h] = dims;
      const landscape = p.orientation === "Landscape";
      const margins = SAFE_MARGINS_MM[size] ?? SAFE_MARGINS_MM.A4;
      return {
        ...p,
        pageWidthMm:  landscape ? h : w,
        pageHeightMm: landscape ? w : h,
        safeTopMm:    margins.top,
        safeSideMm:   margins.side,
        safeBottomMm: margins.bottom,
        imageGenEnabled: (p.falApiKey || p.openrouterApiKey) ? "true" : "",
      };
    },
  },

  evolution: {
    directive: `Learn the user's document design preferences from conversation history.
Focus on: content density (dense one-pager vs breathable long-doc), bilingual tone
(CN/EN writing), section patterns, diagram usage, whether they tend to deviate from
kami's defaults or stick close to them.
Augment the skill with personalized typesetting guidance that respects kami's
aesthetic constraints.`,
  },
};

export default kamiManifest;
