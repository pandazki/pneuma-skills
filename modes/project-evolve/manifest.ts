/**
 * Project Evolve Mode Manifest — project-level evolution agent.
 *
 * Pure data declaration, no React dependency.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 *
 * Forked from `evolve` for the Pneuma 3.0 project layer:
 * - personal `evolve` operates on a single mode's skill, scoped to the
 *   current workspace's session history.
 * - `project-evolve` operates on the *project* — mining cross-mode
 *   sibling sessions to author/refresh `<root>/.pneuma/project-atlas.md`
 *   (a high-density project introduction + quick-reference index that
 *   auto-injects into every project session's CLAUDE.md) and to
 *   maintain `<root>/.pneuma/preferences/{profile,mode-*}.md`
 *   (cross-mode and per-mode project preferences).
 *
 * The two modes coexist deliberately: personal evolve hasn't gone away;
 * project-evolve is the new project-scoped surface launched from the
 * Project chip.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const projectEvolveManifest: ModeManifest = {
  name: "project-evolve",
  version: "1.0.0",
  displayName: {
    en: "Project Atlas",
    "zh-CN": "项目图谱",
    "zh-TW": "專案總覽",
    ja: "プロジェクトアトラス",
    ko: "프로젝트 아틀라스",
    es: "Atlas del proyecto",
    de: "Projekt-Atlas",
  },
  description: {
    en: "Mine the project for high-density context and maintain shared preferences — the briefing every mode reads on startup.",
    "zh-CN": "为项目挖掘高密度上下文并维护共享偏好 —— 每个模式启动时都会读取的简报。",
    "zh-TW": "為專案挖掘高密度上下文並維護共享偏好 —— 每個模式啟動時都會讀取的簡報。",
    ja: "プロジェクトから濃密なコンテキストを抽出し、共有プリファレンスを保守 —— あらゆるモードが起動時に読むブリーフィング。",
    ko: "프로젝트에서 고밀도 컨텍스트를 추출하고 공유 환경설정을 유지 —— 모든 모드가 시작 시 읽는 브리핑입니다.",
    es: "Extrae contexto de alta densidad del proyecto y mantiene preferencias compartidas —— el resumen que cada modo lee al iniciar.",
    de: "Hochdichten Kontext aus dem Projekt extrahieren und gemeinsame Einstellungen pflegen —— das Briefing, das jeder Modus beim Start liest.",
  },
  // Internal mode — surfaced through the Project chip's Evolve sparkle,
  // not the launcher's user-pickable mode grid.
  hidden: true,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a2 2 0 0 0-2 2v3"/><path d="M15 4h4a2 2 0 0 1 2 2v3"/><path d="M3 15v3a2 2 0 0 0 2 2h4"/><path d="M21 15v3a2 2 0 0 1-2 2h-4"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-project-evolve",
    mdScene: `You and the user are reflecting on this project's accumulated work to refresh the project atlas — the high-density briefing every mode session reads at startup — and the project preferences. This isn't co-creation: you're synthesizing what already exists across sibling sessions and user content into a denser introduction, not generating new artifacts. The user reviews every proposal in the dashboard before anything lands on disk.`,
  },

  viewer: {
    watchPatterns: [],
    ignorePatterns: [],
  },

  sources: {},

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Project Atlas" skill="pneuma-project-evolve" session="new"></system-info>
The user just opened the project's Atlas dashboard to refresh the project-atlas.md briefing and shared preferences. Open with one short sentence (1-2 sentences max) acknowledging what you're about to do (mine the sibling sessions for accumulated context; surface proposals for the user to review in the dashboard), then start the analysis. Do not ask the user for input first — they came here to see a fresh atlas, not to brief you. If they want to nudge focus later, they will tell you mid-flight.`,
  },

  // Mining cross-session conversation history relies on Claude Code's
  // structured JSONL artifacts. Codex support can come later if/when
  // its history format stabilises.
  supportedBackends: ["claude-code"],
};

export default projectEvolveManifest;
