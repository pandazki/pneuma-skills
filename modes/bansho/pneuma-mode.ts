/**
 * Bansho ModeDefinition — the React-side binding (design §10).
 *
 * The manifest stays React-free (G4); this file pairs it with the viewer
 * contract. It is a BINDING and nothing more: the action space is declared
 * once in the manifest and referenced here, and `extractContext` delegates
 * to `viewer/context.ts` so the block the agent reads can be tested
 * without mounting React.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerFileContent,
  ViewerSelectionContext,
} from "../../core/types/viewer-contract.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";
import banshoManifest from "./manifest.js";
import BanshoPreview from "./viewer/BanshoPreview.js";
import { buildViewerContext } from "./viewer/context.js";
import { readBoardMoment } from "./viewer/player-status.js";

const resolveBoardDirectories = createDirectoryContentSetResolver({
  minFiles: 1,
  allowSingle: true,
});

/**
 * A bansho workspace is either one board at the root or several boards in
 * top-level directories (multi-locale / multi-theme decks, §3). A root
 * `board.md` wins — directories are then supporting assets, not sets.
 */
export function resolveBanshoContentSets(files: ViewerFileContent[]) {
  const hasRootBoard = files.some((file) => file.path === "board.md");
  if (hasRootBoard) return [];

  const boardDirectories = new Set(
    files.flatMap((file) => {
      const match = file.path.match(/^([^/]+)\/board\.md$/);
      return match ? [match[1]] : [];
    }),
  );
  if (boardDirectories.size === 0) return [];

  return resolveBoardDirectories(
    files.filter((file) => boardDirectories.has(file.path.split("/", 1)[0]!)),
  );
}

const banshoMode: ModeDefinition = {
  manifest: banshoManifest,

  viewer: {
    PreviewComponent: BanshoPreview,

    workspace: {
      type: "single",
      multiFile: false,
      ordered: false,
      hasActiveFile: false,
      resolveContentSets: resolveBanshoContentSets,
    },

    // Declared once, in the manifest — the instructions file and the
    // viewer read the same array.
    actions: banshoManifest.viewerApi?.actions,

    /**
     * The ViewerAddress vocabulary ({contentSet?, section?, step?}) coming
     * back the other way (§8). Half of what the agent needs is not in the
     * files — where the board is, and whether the step in question has
     * been written yet — so the mounted viewer publishes a reader for it
     * (viewer/player-status.ts) and the block is assembled from both.
     */
    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      return buildViewerContext(selection, files, readBoardMoment());
    },

    updateStrategy: "incremental",
  },
};

export default banshoMode;
