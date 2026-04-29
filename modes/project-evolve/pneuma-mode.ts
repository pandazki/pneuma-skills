/**
 * Project Evolve Mode — ModeDefinition binding manifest + viewer.
 *
 * The workspace is `$PNEUMA_PROJECT_ROOT`'s session dir; the agent
 * uses `$PNEUMA_PROJECT_ROOT` to access project-wide files. The
 * dashboard surfaces the same "proposals → review → apply" loop as the
 * personal evolve mode, but proposals can target either the project
 * atlas (`<root>/.pneuma/project-atlas.md`) or project preferences
 * (`<root>/.pneuma/preferences/*.md`).
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import EvolutionPreview from "./viewer/EvolutionPreview.js";
import projectEvolveManifest from "./manifest.js";

const projectEvolveMode: ModeDefinition = {
  manifest: projectEvolveManifest,

  viewer: {
    PreviewComponent: EvolutionPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      _selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      // The evolution dashboard reads proposals from the API, not from
      // watched files. Minimal context tells the agent the dashboard is
      // active and where its proposals will surface.
      return `<viewer-context mode="project-evolve">\nProject Evolution Dashboard active. Proposals written to .pneuma/evolution/proposals/ appear in the dashboard automatically.\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default projectEvolveMode;
