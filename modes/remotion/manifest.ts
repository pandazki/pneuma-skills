/**
 * Remotion Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const remotionManifest: ModeManifest = {
  name: "remotion",
  version: "0.3.0",
  changelog: {
    "0.3.0": [
      "Seed gallery offers the Pneuma intro in English and in Chinese, each one flat Remotion project built from shared scenes plus a locale file",
      "Chinese version set in LXGW WenKai; every face is loaded before a frame renders, in the preview and in remotion render",
      "New mode-catalog scene: a deterministic rigid-body pile that renders identical pixels in the preview, a full render and an isolated still",
      "Tighter opening, staged scene handoffs that never leave an empty frame, and the repository URL on the sign-off",
      "Seed images shrunk from 13 MB to 1.3 MB",
    ],
    "0.2.2": ["Install instructions collapsed to one line; rules written in third person with their reasons instead of MUST and FORBIDDEN"],
    "0.2.1": ["Make skill discovery and guidance portable across Claude Code and Codex"],
    "0.2.0": [
      "Canonical skeleton inlined in SKILL.md — Root.tsx + Composition + tokens pattern",
      "Restores best-practice anchor agents used to read from auto-copied seed files",
      "Non-negotiables documented: one composition per file, integer durationInFrames, tokens-at-top",
    ],
  },
  displayName: {
    en: "Remotion",
    "zh-CN": "Remotion",
    "zh-TW": "Remotion",
    ja: "Remotion",
    ko: "Remotion",
    es: "Remotion",
    de: "Remotion",
  },
  description: {
    en: "Programmatic video creation with React — live preview with custom Player",
    "zh-CN": "用 React 编程式创作视频 —— 配备自定义 Player 的实时预览",
    "zh-TW": "用 React 程式化創作影片 —— 配備自訂 Player 的即時預覽",
    ja: "React でプログラマブルに動画を制作 —— カスタム Player によるライブプレビュー",
    ko: "React로 프로그래밍 방식의 영상 제작 —— 커스텀 Player를 통한 실시간 미리보기",
    es: "Creación programática de video con React —— vista previa en vivo con un Player personalizado",
    de: "Programmatische Videoerstellung mit React —— Live-Vorschau mit benutzerdefiniertem Player",
  },
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/><line x1="12" y1="3" x2="12" y2="21" opacity="0.3"/></svg>`,
  supportedBackends: ["claude-code"],
  inspiredBy: {
    name: "troyhua/claude-code-remotion",
    url: "https://github.com/troyhua/claude-code-remotion",
  },
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-remotion",
    mdScene: `You and the user are creating programmatic video together inside Pneuma. The user watches a live Player panel as you write Remotion compositions — every Edit or Write you do recompiles in-browser within a second, with frame-accurate scrubbing, so they can react to motion the moment it appears. You shape the video by writing React files in \`src/\`; the panel renders the active composition as files change.`,
  },

  viewer: {
    watchPatterns: [
      // Single project (workspace root)
      "src/**/*.tsx",
      "src/**/*.ts",
      "src/**/*.css",
      "public/**",
      // Content set projects (subdirectory per project)
      "*/src/**/*.tsx",
      "*/src/**/*.ts",
      "*/src/**/*.css",
      "*/public/**",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "src/**/*.tsx", "src/**/*.ts", "src/**/*.css", "public/**",
          "*/src/**/*.tsx", "*/src/**/*.ts", "*/src/**/*.css", "*/public/**",
        ],
      },
    },
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
    },
    actions: [
      {
        id: "get-playback-state",
        label: "Get Playback State",
        category: "custom",
        agentInvocable: true,
        description:
          "Query the current playback state: composition, frame, duration, playing, speed, all compositions list",
      },
      {
        id: "seek-to-frame",
        label: "Seek to Frame",
        category: "navigate",
        agentInvocable: true,
        params: {
          frame: {
            type: "number",
            description: "Target frame number (0-based)",
            required: true,
          },
        },
        description: "Navigate to a specific frame",
      },
      {
        id: "set-playback-rate",
        label: "Set Playback Rate",
        category: "ui",
        agentInvocable: true,
        params: {
          rate: {
            type: "number",
            description: "Playback speed (0.25 to 4)",
            required: true,
          },
        },
        description: "Change playback speed",
      },
      {
        id: "set-composition",
        label: "Switch Composition",
        category: "navigate",
        agentInvocable: true,
        params: {
          compositionId: {
            type: "string",
            description: "Composition ID to switch to",
            required: true,
          },
        },
        description: "Switch the active composition in the viewer",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Remotion" backend="claude-code">New Remotion session started. The viewer is ready — your compositions will preview live as you write them.</system-info>`,
  },

  init: {
    contentCheckPattern: "src/Root.tsx",
    // Compound seeds: `shared/` holds the project (config, public/, every scene) and each
    // locale dir adds only src/locale.ts (copy, text faces, size tweaks). Applied in order,
    // they produce one flat Remotion project.
    seedFiles: {
      "modes/remotion/seed/shared/": "./",
      "modes/remotion/seed/en/": "./",
      "modes/remotion/seed/zh/": "./",
    },
    seeds: [
      {
        id: "pneuma-intro-en",
        sourceKey: ["modes/remotion/seed/shared/", "modes/remotion/seed/en/"],
        thumbnail: "en.png",
        displayName: {
          en: "Pneuma intro · English",
          "zh-CN": "Pneuma 介绍片 · 英文",
          "zh-TW": "Pneuma 介紹片 · 英文",
          ja: "Pneuma 紹介映像 · 英語",
        },
        description: {
          en: "A 63-second product film at 1280×720, 30fps: one file seen two ways, four pillars, and the mode catalog piling up in real physics. Edit any scene and the player follows frame by frame.",
          "zh-CN": "一支 63 秒的产品介绍片（1280×720，30fps，英文版）：同一份文件的两种视角、四个支柱，还有用物理模拟堆起来的 mode 目录。改任意一幕，播放器逐帧跟上。",
          "zh-TW": "一支 63 秒的產品介紹片（1280×720，30fps，英文版）：同一份檔案的兩種視角、四個支柱，還有用物理模擬堆起來的 mode 目錄。改任意一幕，播放器逐格跟上。",
          ja: "63 秒のプロダクト映像（1280×720・30fps・英語版）。ひとつのファイルを二つの視点で、四つの柱、物理演算で積み上がる mode カタログ。どのシーンを直してもプレーヤーがフレーム単位で追従します。",
        },
        tags: ["Video", "EN"],
      },
      {
        id: "pneuma-intro-zh",
        sourceKey: ["modes/remotion/seed/shared/", "modes/remotion/seed/zh/"],
        thumbnail: "zh.png",
        displayName: {
          en: "Pneuma intro · Chinese",
          "zh-CN": "Pneuma 介绍片 · 中文",
          "zh-TW": "Pneuma 介紹片 · 中文",
          ja: "Pneuma 紹介映像 · 中国語",
        },
        description: {
          en: "The same 63-second film in Chinese, set in LXGW WenKai beside Fraunces. Fonts load from a CDN at render time, so the project stays small.",
          "zh-CN": "同一支 63 秒的介绍片，中文版，霞鹜文楷配 Fraunces。字体在渲染时从 CDN 加载，项目本身很轻。",
          "zh-TW": "同一支 63 秒的介紹片，中文版，霞鶩文楷配 Fraunces。字型在算繪時從 CDN 載入，專案本身很輕。",
          ja: "同じ 63 秒の映像の中国語版。書体は霞鹜文楷（LXGW WenKai）と Fraunces。フォントはレンダリング時に CDN から読み込むため、プロジェクト自体は軽量です。",
        },
        tags: ["Video", "中文"],
      },
    ],
    params: [
      { name: "compositionWidth", label: "Composition width", description: "pixels", type: "number", defaultValue: 1280 },
      { name: "compositionHeight", label: "Composition height", description: "pixels", type: "number", defaultValue: 720 },
    ],
  },

  evolution: {
    directive:
      "Extract the user's video style preferences: motion design (easing curves, timing, transitions), typography (fonts, sizes, weights), color palettes, composition layout patterns, pacing/rhythm, and visual effects.",
  },
};

export default remotionManifest;
