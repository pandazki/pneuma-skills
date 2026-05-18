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
  version: "1.3.0",
  displayName: {
    en: "Kami",
    "zh-CN": "Kami",
    "zh-TW": "Kami",
    ja: "Kami",
    ko: "Kami",
    es: "Kami",
    de: "Kami",
  },
  description: {
    en: "Paper-canvas web design with warm parchment aesthetic — design language adapted from tw93/kami (MIT)",
    "zh-CN": "纸张画布式网页设计，带温润羊皮纸质感 —— 设计语言取自 tw93/kami（MIT 许可）",
    "zh-TW": "紙張畫布式網頁設計，帶溫潤羊皮紙質感 —— 設計語言取自 tw93/kami（MIT 授權）",
    ja: "温かみのある羊皮紙の質感を持つ紙キャンバス型ウェブデザイン —— デザイン言語は tw93/kami（MIT）から取り入れ",
    ko: "따스한 양피지 질감을 지닌 종이 캔버스형 웹 디자인 —— 디자인 언어는 tw93/kami(MIT)에서 차용",
    es: "Diseño web sobre lienzo de papel con estética cálida de pergamino —— lenguaje de diseño adaptado de tw93/kami (MIT)",
    de: "Webdesign auf Papier-Leinwand mit warmer Pergament-Ästhetik —— Designsprache übernommen von tw93/kami (MIT)",
  },
  changelog: {
    "1.3.0": [
      "SKILL.md gains equity-report and changelog doc routing, plus 11 new diagram routes (bar-chart, candlestick, donut-chart, layer-stack, line-chart, state-machine, swimlane, timeline, tree, venn, waterfall)",
      "New \"Auto-select charts from data\" decision tree maps data shape to the right diagram type",
      "Per-page density rules tightened — items-per-page contracts per template, expressed as kami-fit-loop thresholds",
      "New Step \"Source and material pass\" before drafting — explicit materials status block",
      "Optional layout-note step gives the user a non-blocking editor preview before code",
      "Headings now ship in TsangerJinKai02-W05 (500-weight) alongside W04 body — matching upstream dual-face stack",
    ],
    "1.2.0": [
      "Synced upstream tw93/kami v1.4.1 → V1.5.0 (Live Paper)",
      "New anti-patterns reference — six-category quality checklist (Emptiness / Fabrication / Mimicry / Excess / Source gaps / Tone)",
      "New resume-writing reference — three-part bullet structure (Role / Actions / Impact) with per-language char limits",
      "design.md gains Pygments-style syntax highlighting token map and tightened sparse-slide handling",
      "writing.md gains Term annotation half-life + English-term density rules",
      "diagrams.md adds slide-scale SVG sizing rule (>=65% slide area)",
    ],
    "1.1.0": [
      "Synced upstream tw93/kami v1.2.0 → V1.4.1 (Steadier Hand)",
      "14 SVG diagrams re-normalized: font-weight 500, no italic, solid hex pre-blended on parchment",
      "Reference docs (design / diagrams / writing) refreshed to V1.4.1; upstream now contains our former Pneuma-only sections verbatim",
    ],
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-kami",
    mdScene: `You and the user are designing a printed paper page together inside Pneuma. The user watches a live iframe preview rendered as a single paper sheet — every HTML/CSS/JS edit you make appears immediately, so they can react and redirect mid-stroke. The design language is adapted from tw93/kami (MIT): warm parchment canvas, single ink-blue accent, serif at weight 500, strict-page fit discipline.`,
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
      "modes/kami/seed/_shared/":            "_shared/",
      // Three demos covering the doc-type spectrum:
      //   • one-pager — single-sheet fit-to-safe-area
      //   • portfolio — multi-sheet narrative
      //   • equity-report — two-sheet research format with inline charts
      "modes/kami/seed/pneuma-one-pager/":   "pneuma-one-pager/",
      "modes/kami/seed/kaku-portfolio/":     "kaku-portfolio/",
      "modes/kami/seed/nvda-equity-report/": "nvda-equity-report/",
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
