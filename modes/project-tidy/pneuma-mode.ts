/**
 * Project Tidy Mode — ModeDefinition binding manifest + viewer.
 *
 * The viewer renders a live progress report from `tidy/report.json`
 * (written by the agent into `<sessionDir>/tidy/report.json`). There is
 * no apply step: each session refine is applied directly via
 * `pneuma session refine --target-session <id>`; the report only
 * reflects what the agent has done so far.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import TidyPreview from "./viewer/TidyPreview.js";
import projectTidyManifest from "./manifest.js";

const projectTidyMode: ModeDefinition = {
  manifest: projectTidyManifest,

  viewer: {
    PreviewComponent: TidyPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      _selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      // Tidy is a one-shot sweep. The agent writes a single progress
      // report; the viewer renders it. No per-row selection flows back.
      return `<viewer-context mode="project-tidy">\nTidy progress report active. Write your progress to $PNEUMA_SESSION_DIR/tidy/report.json — the viewer renders it automatically as each session's status updates.\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default projectTidyMode;
