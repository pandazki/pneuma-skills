/**
 * Evolution Mode — ModeDefinition binding manifest + viewer.
 *
 * The workspace is the target project being evolved.
 * extractContext outputs proposal count + latest status so the Agent
 * knows what's been proposed and what the user has decided.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import EvolutionPreview from "./viewer/EvolutionPreview.js";
import evolveManifest from "./manifest.js";

const evolveMode: ModeDefinition = {
  manifest: evolveManifest,

  viewer: {
    PreviewComponent: EvolutionPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      _selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      // The evolution viewer gets its data from the API, not from watched files.
      // We provide minimal context so the agent knows the dashboard is active.
      return `<viewer-context mode="evolve">\nEvolution Dashboard active. Proposals written to .pneuma/evolution/proposals/ appear in the dashboard automatically.\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default evolveMode;
