/**
 * ClipCraft Mode — ModeDefinition.
 * Wires the manifest together with the React viewer component.
 * Dynamically imported by mode-loader.ts via default export.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import ClipCraftPreview from "./viewer/ClipCraftPreview.js";
import clipcraftManifest from "./manifest.js";

const clipcraftMode: ModeDefinition = {
  manifest: clipcraftManifest,

  viewer: {
    PreviewComponent: ClipCraftPreview,

    extractContext(_selection, files) {
      const fileCount = files.length;
      return `<viewer-context mode="clipcraft" files="${fileCount}">\nClipCraft bootstrap — ${fileCount} file(s) in workspace\n</viewer-context>`;
    },

    updateStrategy: "full-reload",

    locatorDescription:
      'After creating or editing assets, clips, or moving the playhead, embed <viewer-locator> cards so the user can jump straight to the change. Emit one card per distinct thing you changed (a newly generated asset, a clip you just placed, a time beat you built around) — not one per response. Data shapes: navigate to an asset in the library via `data=\'{"assetId":"asset-<semantic-id>"}\'`; navigate to a clip on the timeline (auto-selects the clip and seeks the playhead to its start) via `data=\'{"clipId":"clip-<semantic-id>"}\'`; seek the playhead to a time in seconds via `data=\'{"time":3.5}\'`; focus a track via `data=\'{"trackId":"track-<semantic-id>"}\'`. Use short concrete labels like "新的 VO 开场" or "panda clip on Main" — the user will see these cards in chat and click to navigate.',
  },
};

export default clipcraftMode;
