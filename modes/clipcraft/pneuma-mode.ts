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
  },
};

export default clipcraftMode;
