/**
 * Cosmos ModeDefinition — frontend binding. Wires the manifest to a
 * ViewerContract that renders the cosmos as an interactive graph.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerFileContent, ViewerSelectionContext } from "../../core/types/viewer-contract.js";

import manifest from "./manifest.js";
import { CosmosPreview } from "./viewer/CosmosPreview.js";

const cosmosMode: ModeDefinition = {
  manifest,

  viewer: {
    PreviewComponent: CosmosPreview,
    updateStrategy: "incremental",

    /**
     * Selection → `<viewer-context>` block.
     *
     * The Address line is the round-trippable handle. When the user
     * selects a node, the agent receives the JSON address and can copy
     * it verbatim into `capture({ address })` to screenshot that node,
     * or into a `<viewer-locator label="…" address='{…}' />` card to
     * point back at it in chat.
     */
    extractContext(
      selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      if (!selection) return "";

      const lines: (string | null)[] = [
        `Mode: cosmos`,
        selection.address
          ? `Address: ${JSON.stringify(selection.address)}`
          : null,
        selection.label ? `Selected: ${selection.label}` : null,
        selection.nearbyText ? `Nearby: ${selection.nearbyText}` : null,
      ];

      return lines.filter(Boolean).join("\n");
    },

    workspace: {
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
      // Single cosmos: no file list to render in the TopBar; viewer owns
      // the entire surface. resolveItems returns empty.
      resolveItems(_files: ViewerFileContent[]) {
        return [];
      },
      // No empty-state scaffold — when the workspace lacks cosmos.json,
      // the seed mechanism provides the starter example. The agent
      // creates new cosmos.json files in response to user requests, not
      // via a viewer "New" button.
      createEmpty(_files: ViewerFileContent[]) {
        return null;
      },
    },

    actions: manifest.viewerApi?.actions,
  },
};

export default cosmosMode;
