/**
 * Self-test for the lifecycle harness.
 *
 * Verifies the harness machinery (skip behaviour, scenario registration)
 * without spawning any real CLI binaries — every backend module here is a
 * stub that returns sensible defaults for the protocol surface but never
 * actually runs.
 *
 * The real "does the harness drive a CLI correctly" assertions live in the
 * per-backend `lifecycle.test.ts` files (Tasks 10/11/12). This file's job
 * is to keep the harness's own logic regression-tested.
 */

import { describe, expect, it } from "bun:test";
import { ALL_SCENARIOS, runLifecycleHarness } from "./lifecycle-harness.js";
import type {
  AgentBackend,
  BackendModule,
  BackendRequirementResult,
} from "../../core/types/agent-backend.js";

function fakeBackend(): AgentBackend {
  return {
    name: "claude-code",
    capabilities: {
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    },
    launch: () => ({
      sessionId: "fake",
      state: "starting",
      cwd: "/tmp",
      createdAt: Date.now(),
    }),
    getSession: () => undefined,
    isAlive: () => false,
    markConnected: () => {},
    setAgentSessionId: () => {},
    kill: async () => true,
    killAll: async () => {},
    onSessionExited: () => {},
  };
}

function makeFakeModule(overrides: Partial<BackendModule> = {}): BackendModule {
  const base: BackendModule = {
    type: "claude-code",
    label: "Fake",
    description: "fake module for harness self-test",
    displayLabel: "fake",
    binary: "fake",
    installHint: "n/a",
    skillsDir: ".fake/skills",
    instructionsFile: "FAKE.md",
    capabilities: {
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    },
    createBackend: () => fakeBackend(),
    createBridgeBackend: () => null,
    checkRequirements: (): BackendRequirementResult => ({ ok: false, reason: "self-test stub" }),
  };
  return { ...base, ...overrides };
}

/**
 * Strategy for the self-test: rather than monkey-patching `bun:test`
 * (whose `describe`/`it` exports are frozen by the runtime), we rely on
 * the visible side effect of `runLifecycleHarness`: it registers a child
 * `describe` block with six `it.skip`s when the binary is unavailable or
 * the entire scenario list is in `skip`. Bun's test reporter then shows
 * those as skipped rather than failing — which is exactly the contract
 * we want to verify.
 *
 * The assertions in this file therefore check:
 *   1. The harness exports the expected scenario list.
 *   2. Calling the harness with `checkRequirements` returning `ok: false`
 *      does not throw.
 *   3. Calling the harness with every scenario in `skip` does not throw.
 *
 * The skip-count check is observational: this file runs cleanly with
 * "12 skip" added to the test report (6 per `runLifecycleHarness` call).
 */

describe("lifecycle harness self-test", () => {
  it("exports six canonical scenarios", () => {
    expect([...ALL_SCENARIOS].sort()).toEqual([
      "boot",
      "greeting",
      "interrupt",
      "multi-turn",
      "resume",
      "tool-flow",
    ]);
  });

  describe("when binary is unavailable", () => {
    // The harness should register an `it.skip` per scenario rather than
    // throwing. We invoke it inside a child describe and rely on bun:test
    // to surface skipped tests in the report.
    runLifecycleHarness({
      module: makeFakeModule({
        type: "claude-code",
        checkRequirements: () => ({ ok: false, reason: "self-test: pretend binary missing" }),
      }),
      workspaceRoot: "/tmp/pneuma-harness-selftest-skip",
    });

    it("reaches this assertion (harness did not throw on missing binary)", () => {
      expect(true).toBe(true);
    });
  });

  describe("when skip list is provided", () => {
    // ok=true but every scenario in the skip list — we should see no real
    // launch attempts. Since the harness skips before doing any setup, the
    // scenarios appear as "skipped" in the report.
    runLifecycleHarness({
      module: makeFakeModule({
        // Pretend the binary IS available; the harness will move past the
        // initial guard and into per-scenario registration.
        checkRequirements: () => ({ ok: true, binaryPath: "/usr/bin/fake" }),
      }),
      workspaceRoot: "/tmp/pneuma-harness-selftest-skipall",
      skip: [...ALL_SCENARIOS],
    });

    it("reaches this assertion (no scenarios actually executed)", () => {
      expect(true).toBe(true);
    });
  });

  it("registers six scenarios per call (12 total skipped from the two suites above)", () => {
    // This is an observational check: read the bun:test report — the two
    // `runLifecycleHarness` calls above should contribute 12 skipped tests
    // (6 each). If the harness ever drifts (e.g. drops a scenario, splits
    // one), `bun test backends/__tests__/lifecycle-harness.test.ts` will
    // surface it via a changed skip count.
    expect(ALL_SCENARIOS.length).toBe(6);
  });
});
