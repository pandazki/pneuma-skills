import { runLifecycleHarness } from "../../__tests__/lifecycle-harness.js";
import { codexModule } from "../manifest.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "pneuma-codex-lifecycle-"));

runLifecycleHarness({
  module: codexModule,
  workspaceRoot: workspace,
});

// Cleanup: the harness handles per-scenario workspace cleanup. The tmp root
// directory is small and survives the test run, picked up by OS tmp cleanup.
