/**
 * Draw Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded dynamically by the frontend via mode-loader.
 * Provides the Excalidraw-based preview component and context extraction.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import DrawPreview from "./components/DrawPreview.js";
import drawManifest from "./manifest.js";

const drawMode: ModeDefinition = {
  manifest: drawManifest,

  viewer: {
    PreviewComponent: DrawPreview,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const parts: string[] = [];
      if (files.length > 0) {
        const viewingFile = files[0];
        if (viewingFile) {
          parts.push(`[User is viewing: ${viewingFile.path}]`);
        }
      }
      if (selection) {
        if (selection.type === "viewing") {
          parts.push(`[Active file: ${selection.file}]`);
        } else {
          parts.push(`[User selected element(s): ${selection.content}]`);
        }
      }
      return parts.join("\n");
    },

    updateStrategy: "full-reload",
  },
};

export default drawMode;
