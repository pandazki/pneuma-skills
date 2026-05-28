/**
 * Mode Maker Manifest — create and develop new Pneuma modes with AI assistance.
 *
 * Pure data declaration, no React dependency.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const modeMakerManifest: ModeManifest = {
  name: "mode-maker",
  version: "1.1.0",
  displayName: {
    en: "Mode Maker",
    "zh-CN": "Mode Maker",
    "zh-TW": "Mode Maker",
    ja: "Mode Maker",
    ko: "Mode Maker",
    es: "Mode Maker",
    de: "Mode Maker",
  },
  description: {
    en: "Create, develop, test, and publish new Pneuma mode packages",
    "zh-CN": "创建、开发、测试并发布新的 Pneuma 模式包",
    "zh-TW": "建立、開發、測試並發布新的 Pneuma 模式套件",
    ja: "新しい Pneuma モードパッケージを作成・開発・テスト・公開する",
    ko: "새로운 Pneuma 모드 패키지를 만들고, 개발하고, 테스트하고, 게시합니다",
    es: "Crea, desarrolla, prueba y publica nuevos paquetes de modos de Pneuma",
    de: "Neue Pneuma-Moduspakete erstellen, entwickeln, testen und veröffentlichen",
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-mode-maker",
    mdScene: `You and the user are co-developing a new Pneuma mode together — the workspace IS the mode package, with manifest.ts, viewer, skill, and seed files all evolving live as you edit. The user has a Play harness that spawns your candidate mode in an isolated child pneuma process so they can click through a real viewer without leaving this window. Every file you save is what the next Play click will load.`,
  },

  viewer: {
    watchPatterns: [
      "manifest.ts",
      "manifest.js",
      "pneuma-mode.ts",
      "pneuma-mode.js",
      "viewer/**/*.tsx",
      "viewer/**/*.ts",
      "viewer/**/*.js",
      "skill/**/*.md",
      "skill/**/*",
      "seed/**/*",
    ],
    ignorePatterns: [
      ".build/**",
    ],
  },

  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "manifest.ts", "manifest.js",
          "pneuma-mode.ts", "pneuma-mode.js",
          "viewer/**/*.tsx", "viewer/**/*.ts", "viewer/**/*.js",
          "skill/**/*.md", "skill/**/*",
          "seed/**/*",
        ],
        ignore: [".build/**"],
      },
    },
  },

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: true },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Mode Maker" skill="pneuma-mode-maker" session="new"></system-info>
The user just opened the workspace. You are ready to assist with mode package development. Greet the user briefly (1-2 sentences).`,
  },

  init: {
    contentCheckPattern: "manifest.ts",
    params: [
      { name: "modeName", label: "Mode name", description: "lowercase identifier (e.g. quiz, kanban)", type: "string", defaultValue: "my-mode" },
      { name: "displayName", label: "Display name", description: "human-readable name (e.g. Quiz, Kanban Board)", type: "string", defaultValue: "My Mode" },
    ],
    seedFiles: {
      "modes/mode-maker/seed/manifest.ts": "manifest.ts",
      "modes/mode-maker/seed/pneuma-mode.ts": "pneuma-mode.ts",
      "modes/mode-maker/seed/viewer/Preview.tsx": "viewer/Preview.tsx",
      "modes/mode-maker/seed/skill/SKILL.md": "skill/SKILL.md",
      "modes/mode-maker/seed/package.json": "package.json",
    },
    seeds: [
      {
        id: "scaffold",
        // Compound — a mode package needs every file present together
        // (manifest, mode binding, viewer component, skill, package.json).
        // Picking any single file in isolation would leave the workspace
        // in a broken half-mode state.
        sourceKey: [
          "modes/mode-maker/seed/manifest.ts",
          "modes/mode-maker/seed/pneuma-mode.ts",
          "modes/mode-maker/seed/viewer/Preview.tsx",
          "modes/mode-maker/seed/skill/SKILL.md",
          "modes/mode-maker/seed/package.json",
        ],
        thumbnail: "scaffold.png",
        displayName: {
          en: "New mode scaffold",
          "zh-CN": "新模式脚手架",
          "zh-TW": "新模式腳手架",
        },
        description: {
          en: "A blank mode package — manifest, viewer, skill, and package.json wired together. Rename, fill in the blanks, hit Play.",
          "zh-CN": "一个空白模式包 —— manifest、viewer、skill、package.json 已经接好。改个名、填空、点 Play。",
        },
        tags: ["Scaffold"],
      },
    ],
  },
};

export default modeMakerManifest;
