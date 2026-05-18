/**
 * Project Onboard Mode Manifest — fresh-project initialization agent.
 *
 * Pure data declaration, no React dependency. Safely imported by both
 * the backend (pneuma.ts) and the frontend (pneuma-mode.ts).
 *
 * One-shot mode auto-launched when a Pneuma project is opened for the
 * first time (no sessions, no `onboardedAt` flag in `project.json`).
 * Mines the directory for existing material — README, logos, palette
 * signals, package manifest, framework hints — and writes a single
 * `proposal.json` capturing:
 *   - project.json updates (displayName, description, optional cover source)
 *   - the full project-atlas.md body
 *   - "anchors" (what the discovery surfaced) + open questions
 *   - two next-step task recommendations tailored to the project shape
 *     and the user's configured API keys
 *   - optional API-key hints for unlocking better follow-on tasks
 *
 * The user reviews the proposal in a custom viewer (OnboardPreview),
 * apply lands the writes + optionally emits a Smart Handoff to spawn
 * the chosen task in its target mode.
 *
 * See `docs/design/2026-04-30-project-onboard.md` for the full design
 * and acceptance criteria.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const projectOnboardManifest: ModeManifest = {
  name: "project-onboard",
  version: "1.0.0",
  displayName: {
    en: "Project Discovery",
    "zh-CN": "项目探索",
    "zh-TW": "專案探索",
    ja: "プロジェクト探索",
    ko: "프로젝트 탐색",
    es: "Descubrimiento del proyecto",
    de: "Projekt-Erkundung",
  },
  description: {
    en: "Mine a fresh project for existing material — README, logos, palette, configs — and propose project metadata + atlas + two tailored next-step tasks.",
    "zh-CN": "为全新项目挖掘已有素材 —— README、Logo、配色、配置 —— 提出项目元数据、项目图谱与两项贴合实际的下一步任务。",
    "zh-TW": "為全新專案挖掘已有素材 —— README、Logo、配色、設定 —— 提出專案元資料、專案總覽與兩項貼合實際的下一步任務。",
    ja: "新規プロジェクトから既存素材（README、ロゴ、パレット、設定）を発掘し、プロジェクトメタデータ・アトラスと、ぴったりな次の 2 つのタスクを提案。",
    ko: "새 프로젝트에서 기존 자료(README, 로고, 팔레트, 설정)를 발굴하고, 프로젝트 메타데이터·아틀라스와 상황에 맞는 다음 단계 작업 두 가지를 제안합니다.",
    es: "Extrae el material existente de un proyecto nuevo —— README, logotipos, paleta, configuraciones —— y propone metadatos del proyecto, atlas y dos siguientes tareas a medida.",
    de: "Vorhandenes Material aus einem neuen Projekt erschließen —— README, Logos, Palette, Konfigurationen —— und Projekt-Metadaten, Atlas sowie zwei passgenaue nächste Aufgaben vorschlagen.",
  },
  // Internal mode — auto-launched on fresh project open or via the
  // ProjectPanel's "Re-discover" affordance, never picked from the
  // launcher's user-pickable mode grid.
  hidden: true,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21l-4.3-4.3"/><circle cx="11" cy="11" r="7"/><path d="M11 8v3l2 2"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-project-onboard",
    mdScene: `You and the user are looking at a fresh Pneuma project together for the first time. Your job is to read the directory carefully — README, logos, palette, package manifest, asset folders — and assemble a single discovery proposal: what this project is, what's already in it, and two concrete next steps the user can take to put Pneuma to work right away. The user watches a custom Discovery Report viewer that renders your proposal in real time; when they click a task card, you hand off to the target mode with a fully-prepared brief.`,
  },

  viewer: {
    // The viewer reads `proposal.json` from `<sessionDir>/onboard/`. The
    // file is the agent's primary output for this mode; nothing else in
    // the session dir needs to be watched for the viewer to render.
    watchPatterns: ["onboard/proposal.json"],
    ignorePatterns: [],
  },

  sources: {},

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Project Discovery" skill="pneuma-project-onboard" session="new"></system-info>
The user just opened a fresh Pneuma project for the first time. Begin discovery immediately — do not wait for user input. Open with one short sentence (1-2 sentences max) acknowledging what you're about to do (read README, package manifest, asset folders, configs; surface a discovery proposal with two tailored next-step tasks), then start the work and write the proposal to <sessionDir>/onboard/proposal.json. Do not enumerate the steps you'll take; announce briefly and go.`,
  },

  // Discovery currently relies on Claude Code's tool surface. Codex
  // support can come later — the structural mining (file reads, image
  // detection) is portable, but proposal authoring conventions are
  // tuned for Claude's strengths today.
  supportedBackends: ["claude-code"],
};

export default projectOnboardManifest;
