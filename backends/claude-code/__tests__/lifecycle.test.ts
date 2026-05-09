import { runLifecycleHarness } from "../../__tests__/lifecycle-harness.js";
import { claudeCodeModule } from "../manifest.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "pneuma-claude-lifecycle-"));

runLifecycleHarness({
  module: claudeCodeModule,
  workspaceRoot: workspace,
  // Claude Code is the reference backend — expect all 6 scenarios to pass.
});

// Cleanup: the harness handles per-scenario workspace cleanup. The tmp root
// directory is small and survives the test run, picked up by OS tmp cleanup.
