import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadStudio, saveStudio } from "./domain.js";

const manifest: ModeManifest = {
  name: "brand",
  version: "0.2.0",
  displayName: "Brand Studio",
  description: "Define a brand through visual rules, core assets and examples others can build on.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="15" rx="2"/><path d="M9 18v3h12V7h-6M6 7h5M6 11h3"/></svg>`,
  changelog: {
    "0.2.0": ["Export paginated brand books as PDF or PNG with the shared WebCraft export workbench"],
    "0.1.0": ["Living brand books with identity rules, core assets, application examples and reference comparison"],
  },
  skill: {
    sourceDir: "skill", installName: "pneuma-brand",
    mdScene: "You and the user are designing a brand in Pneuma. The brand itself is the deliverable: identity rules, core assets and representative visual applications. Help downstream makers understand and extend the system; application examples illustrate the brand rather than promise finished production materials.",
    sharedScripts: ["generate_image.mjs", "edit_image.mjs"],
    envMapping: { OPENROUTER_API_KEY: "openrouterApiKey" },
  },
  viewer: {
    watchPatterns: ["**/brand.json", "**/*.html", "**/*.htm", "**/*.css", "**/*.js", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp", "**/*.svg", "**/*.gif", "**/*.avif"],
    ignorePatterns: ["node_modules/**", ".pneuma/**"], serveDir: ".", refreshStrategy: "auto",
  },
  sources: { studio: { kind: "aggregate-file", config: { patterns: ["**/brand.json", "**/*.html", "**/*.htm"], load: loadStudio, save: saveStudio } } },
  artifactExport: { file: "brand-book.html" },
  init: {
    contentCheckPattern: "**/brand.json",
    seedFiles: { "modes/brand/seed/morrow/": "morrow/" },
    params: [{ name: "openrouterApiKey", label: "OpenRouter API Key", description: "Optional image generation fallback. A native image tool can be used without it.", type: "string", defaultValue: "", sensitive: true }],
  },
  viewerApi: {
    workspace: { type: "manifest", multiFile: true, ordered: true, hasActiveFile: true, manifestFile: "brand.json", supportsContentSets: true },
    actions: [
      { id: "navigate-to", label: "Inspect work", category: "navigate", agentInvocable: true, description: "Open a work or a declared image region.", params: { address: { type: "object", description: "{ contentSet?, item, region? }", required: true } } },
      { id: "compare", label: "Compare reference", category: "ui", agentInvocable: true, description: "Compare a work with its first reference.", params: { address: { type: "object", description: "{ contentSet?, item }", required: true } } },
    ],
    commands: [
      { id: "define", label: "Define brand", description: "Clarify the brand brief and identity rules." },
      { id: "generate", label: "Develop identity", description: "Develop the brand's visual language and core assets using its references." },
      { id: "apply", label: "Explore application", description: "Show how the brand behaves in a chosen context through a representative example." },
      { id: "audit", label: "Review consistency", description: "Review identity consistency and whether examples give downstream makers usable guidance." },
    ],
  },
  agent: { permissionMode: "bypassPermissions" },
  evolution: { directive: "Learn accepted brand invariants, reference choices, composition, density, mascot consistency and fidelity tolerances from explicit feedback; apply them to future brand briefs and reviews." },
  inspiredBy: { name: "Brand-to-interface workflow", url: "https://gwrdluzl9j9.feishu.cn/wiki/ZhfVwvNWCiK2V4kyJS4c3Z9Zn4d" },
};
export default manifest;
