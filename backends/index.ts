/**
 * Pure backend registry.
 *
 * Every backend ships a `BackendModule` from its own `manifest.ts` (see
 * `backends/<name>/manifest.ts` and `core/types/agent-backend.ts:BackendModule`).
 * This file is the only place those modules are aggregated; the rest of the
 * system (skill installer, bin/pneuma launcher, frontend availability badges)
 * goes through the helpers below — it never reaches into the per-backend
 * folders directly, and it never branches on `if (type === ...)`.
 *
 * Adding a new backend:
 *   1. Create `backends/<name>/manifest.ts` exporting a `BackendModule`.
 *   2. Add it to `MODULES` below.
 *   3. Done — descriptors, capabilities, availability probes, factory calls,
 *      and skill-installer file conventions all flow through automatically.
 */

import type {
  AgentBackend,
  AgentBackendDescriptor,
  AgentBackendType,
  AgentCapabilities,
  BackendModule,
  BackendRequirementResult,
} from "../core/types/agent-backend.js";
import { claudeCodeModule } from "./claude-code/manifest.js";
import { codexModule } from "./codex/manifest.js";
import { kimiCliModule } from "./kimi-cli/manifest.js";

// Thunks, not values. A backend's manifest reaches back into this registry
// through its own bridge/server imports, so touching the imported bindings in
// this module's body puts them in the temporal dead zone whenever the graph is
// entered from that side — `bun test backends/kimi-cli` failed with
// "Cannot access 'kimiCliModule' before initialization" while the full
// `bun test backends` run, which enters from another file first, passed.
// Deferring the reference to call time removes the ordering dependency.
const MODULES: Record<AgentBackendType, () => BackendModule> = {
  "claude-code": () => claudeCodeModule,
  codex: () => codexModule,
  "kimi-cli": () => kimiCliModule,
};

export function getBackendModule(type: AgentBackendType): BackendModule {
  return MODULES[type]();
}

/**
 * Resolve install conventions (skillsDir / instructionsFile / displayLabel /
 * etc.) for a backend type. Tolerant variant of `getBackendModule` that
 * accepts an `unknown`/legacy string and falls back to claude-code when the
 * value is undefined or doesn't match a known backend — that's the legacy
 * 2.x default and matches how the skill installer behaved before kimi /
 * codex were added.
 *
 * Use this from any consumer that has to deal with a stored / on-disk
 * `backendType` string of unverified type (skill installer, evolution
 * agent, replay loaders). The runtime guard keeps a single fallback policy
 * in one place — callers should never branch on `if (type === ...)`.
 */
export function getInstallConventions(backendType?: string): BackendModule {
  if (
    backendType === "claude-code" ||
    backendType === "codex" ||
    backendType === "kimi-cli"
  ) {
    return getBackendModule(backendType);
  }
  return getBackendModule("claude-code");
}

export function getAllBackendModules(): BackendModule[] {
  return Object.values(MODULES).map((load) => load());
}

export function getBackendDescriptors(): AgentBackendDescriptor[] {
  return getAllBackendModules().map((m) => ({
    type: m.type,
    label: m.label,
    description: m.description,
    implemented: true,
  }));
}

export function getImplementedBackends(): AgentBackendDescriptor[] {
  return getBackendDescriptors();
}

export function getDefaultBackendType(): AgentBackendType {
  return "claude-code";
}

export function getBackendCapabilities(type: AgentBackendType): AgentCapabilities {
  // A copy, not the manifest's own object. `makeDefaultState` hands this
  // straight into a session's state, so returning the shared instance would
  // let one session's edit rewrite the declared capabilities of the backend
  // itself — and with them every other session in the process.
  return { ...MODULES[type]().capabilities };
}

export interface BackendAvailability {
  type: AgentBackendType;
  available: boolean;
  binaryPath?: string;
  reason?: string;
}

/**
 * Detect which backends have their CLI binary available on the system.
 * Results are NOT cached — call sparingly (shell PATH probe is ~50ms each).
 */
export function detectBackendAvailability(): BackendAvailability[] {
  return getAllBackendModules().map((m) => {
    const r: BackendRequirementResult = m.checkRequirements();
    return r.ok
      ? { type: m.type, available: true, binaryPath: r.binaryPath }
      : { type: m.type, available: false, reason: r.reason };
  });
}

export function createBackend(type: AgentBackendType, port: number): AgentBackend {
  return MODULES[type]().createBackend(port);
}
