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
  displayName: "Project Onboarding",
  description:
    "Mine a fresh project for existing material — README, logos, palette, configs — and propose project metadata + atlas + two tailored next-step tasks.",
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
  },

  // Discovery currently relies on Claude Code's tool surface. Codex
  // support can come later — the structural mining (file reads, image
  // detection) is portable, but proposal authoring conventions are
  // tuned for Claude's strengths today.
  supportedBackends: ["claude-code"],
};

export default projectOnboardManifest;
