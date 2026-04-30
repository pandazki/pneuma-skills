/**
 * Project Onboard Mode — ModeDefinition binding manifest + viewer.
 *
 * The viewer renders a Discovery Report from `proposal.json` (written
 * by the agent into `<sessionDir>/onboard/proposal.json`). Apply +
 * handoff actions are user-driven: clicking a task card lands the
 * proposal's writes and emits a Smart Handoff to the target mode with
 * the prepared brief.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import OnboardPreview from "./viewer/OnboardPreview.js";
import projectOnboardManifest from "./manifest.js";

const projectOnboardMode: ModeDefinition = {
  manifest: projectOnboardManifest,

  viewer: {
    PreviewComponent: OnboardPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      _selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      // Onboarding is a one-shot, click-driven flow. The agent writes a
      // single proposal.json; the viewer renders + acts on it. There's
      // no chat-driven iteration, so the context block is minimal.
      return `<viewer-context mode="project-onboard">\nDiscovery Report active. Write your proposal to $PNEUMA_SESSION_DIR/onboard/proposal.json — the viewer renders it automatically and surfaces the user's apply / task-handoff clicks.\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default projectOnboardMode;
