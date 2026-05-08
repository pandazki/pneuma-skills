/**
 * Per-backend installer registry.
 *
 * Each agent CLI Pneuma supports has its own filesystem conventions:
 * which directory it scans for skills, which project-level instructions
 * file it reads at startup, what label to use when generating prose
 * inside the instructions file, etc. The skill installer used to switch
 * on `backendType` inline at every touchpoint; this registry centralises
 * the conventions in one place so the installer's main flow is
 * backend-agnostic.
 *
 * Adding a new backend:
 *   1. Pick the directory it reads skills from (its CLI's native path —
 *      cross-tool fallbacks via "the new backend also discovers .claude/"
 *      are nice but a backend's *own* canonical path keeps installs clean
 *      when the same workspace is opened by multiple backends).
 *   2. Pick the instructions filename (CLAUDE.md / AGENTS.md / something
 *      backend-native).
 *   3. Add a `BackendInstallHandler` entry below.
 *   4. Done — the rest of the installer is driven by the handler. No
 *      `if (backendType === "...")` should be added in the install path.
 *
 * If a future backend needs lifecycle behaviour beyond filename choice
 * (e.g. a content transform on the instructions file, a post-install
 * config write), extend the `BackendInstallHandler` interface with an
 * optional method, call it unconditionally from the installer, and let
 * each handler opt in. The interface intentionally starts small — adding
 * a hook before there's a real reason just creates dead code paths.
 */

import { join } from "node:path";

export interface BackendInstallHandler {
  /**
   * Workspace-relative path where mode + dependency skills are installed.
   * Each backend's CLI scans this path during startup discovery.
   */
  readonly skillsDir: string;

  /**
   * Project-level instructions filename the agent's CLI reads at startup.
   * Pneuma's marker blocks (pneuma:start, pneuma:viewer-api:start, etc.)
   * are merged into this file at install time.
   */
  readonly instructionsFile: string;

  /**
   * Label used when the installer generates prose that mentions the
   * runtime / CLI by name (e.g. inside the pneuma:start scene paragraph).
   * Should be the conventional short name a user would search for in
   * docs, NOT the brand-marketing name.
   */
  readonly displayLabel: string;
}

const HANDLERS: Record<string, BackendInstallHandler> = {
  "claude-code": {
    skillsDir: join(".claude", "skills"),
    instructionsFile: "CLAUDE.md",
    displayLabel: "claude-code",
  },
  codex: {
    skillsDir: join(".agents", "skills"),
    instructionsFile: "AGENTS.md",
    displayLabel: "codex",
  },
  "kimi-cli": {
    // Kimi's own primary location per `kimi_cli/skill/` — also discovered
    // by Kimi's multi-source skill scanner with highest precedence.
    skillsDir: join(".kimi", "skills"),
    // Kimi explicitly reads `AGENTS.md` (and `.kimi/AGENTS.md`) per
    // `kimi_cli/soul/agent.py:88-132`. It does NOT read `CLAUDE.md` at all.
    instructionsFile: "AGENTS.md",
    displayLabel: "kimi-cli",
  },
};

const FALLBACK = HANDLERS["claude-code"];

/**
 * Look up the install handler for a backend. Falls back to claude-code's
 * conventions when `backendType` is undefined or unknown — that's the
 * legacy 2.x default and matches how the installer behaved before kimi /
 * codex were added.
 */
export function getBackendInstallHandler(backendType?: string): BackendInstallHandler {
  if (!backendType) return FALLBACK;
  return HANDLERS[backendType] ?? FALLBACK;
}
