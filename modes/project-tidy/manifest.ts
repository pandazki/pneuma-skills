/**
 * Project Tidy Mode Manifest — batch session-meta organizer.
 *
 * Pure data declaration, no React dependency. Safely imported by both
 * the backend (pneuma.ts) and the frontend (pneuma-mode.ts).
 *
 * A temporary, internal session launched from the ProjectPanel's AI
 * (sparkle) menu. Its single job is to walk every sibling session under
 * `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<id>/` that still carries a
 * default / placeholder title and rewrite its `displayName` +
 * `description` — the same `pneuma session refine` logic that the
 * `pneuma-session` skill runs *inside* one session, but pulled out into
 * a dedicated pass that covers the whole Recent Sessions list at once.
 *
 * Forked from `project-evolve` for the cross-session data access, but
 * it produces no proposals and lands nothing reviewable: each refine is
 * applied directly (titles are cheap and reversible). The viewer is a
 * live progress report, not a proposal dashboard.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const projectTidyManifest: ModeManifest = {
  name: "project-tidy",
  version: "1.0.0",
  displayName: {
    en: "Tidy Sessions",
    "zh-CN": "整理会话",
    "zh-TW": "整理會話",
    ja: "セッション整理",
    ko: "세션 정리",
    es: "Ordenar sesiones",
    de: "Sitzungen aufräumen",
  },
  description: {
    en: "Sweep the project's Recent Sessions list and rewrite every placeholder title + summary so each row says what it's actually about.",
    "zh-CN": "扫一遍项目的最近会话列表，为每个还是默认标题的会话补全标题与摘要，让每一行都说清自己讲的是什么。",
    "zh-TW": "掃一遍專案的最近會話列表，為每個還是預設標題的會話補全標題與摘要，讓每一行都說清自己講的是什麼。",
    ja: "プロジェクトの最近のセッション一覧を一巡し、プレースホルダーのままのタイトルと要約を書き直して、各行が何についてかを明確にします。",
    ko: "프로젝트의 최근 세션 목록을 훑어, 기본 제목으로 남아 있는 세션의 제목과 요약을 다시 작성해 각 행이 무엇에 관한 것인지 분명히 합니다.",
    es: "Recorre la lista de Sesiones recientes del proyecto y reescribe cada título y resumen de marcador de posición para que cada fila diga de qué trata realmente.",
    de: "Geht die Liste der letzten Sitzungen des Projekts durch und schreibt jeden Platzhaltertitel samt Zusammenfassung neu, damit jede Zeile sagt, worum es wirklich geht.",
  },
  // Internal mode — surfaced through the ProjectPanel's AI (sparkle)
  // menu, never picked from the launcher's user-pickable mode grid.
  hidden: true,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h12"/><path d="M3 18h6"/><path d="m17 14 1.5 3.5L22 19l-3.5 1.5L17 24l-1.5-3.5L12 19l3.5-1.5z"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-project-tidy",
    mdScene: `You and the user are tidying this project's Recent Sessions list. Every session row defaults to "<Mode> session" until someone refines it; you're doing that refine in bulk — reading each un-tidied sibling session's conversation, then writing a meaningful title + one-line summary for it. You author nothing new; you only re-label what already exists. The user watches a live progress report as each row updates.`,
  },

  viewer: {
    // The viewer reads `tidy/report.json` from `<sessionDir>/tidy/`. The
    // agent rewrites this file as it sweeps the list; nothing else needs
    // watching for the progress report to render.
    watchPatterns: ["tidy/report.json"],
    ignorePatterns: [],
  },

  sources: {},

  viewerApi: {
    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Tidy Sessions" skill="pneuma-project-tidy" session="new"></system-info>
The user just opened the Tidy Sessions pass to clean up this project's Recent Sessions list. Begin immediately — do not wait for input. Open with one short sentence (1-2 sentences max) saying what you're about to do (scan the project's sessions, then re-title the ones still on a default name), then run the sweep: enumerate the sessions, write the initial report to <sessionDir>/tidy/report.json, and refine each un-tidied session in turn, updating the report as you go. Don't enumerate your steps; announce briefly and go.`,
  },

  // Mining cross-session conversation history relies on Claude Code's
  // structured JSONL artifacts and the project session layout. Codex
  // support can come later if/when its history format stabilises.
  supportedBackends: ["claude-code"],
};

export default projectTidyManifest;
