/**
 * Draw Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded dynamically by the frontend via mode-loader.
 * Provides the Excalidraw-based preview component and context extraction.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import DrawPreview from "./viewer/DrawPreview.js";
import drawManifest from "./manifest.js";

// Module-level ref — kept for potential future use (e.g. explicit user-triggered capture)
const _captureRef: { current: (() => Promise<{ data: string; media_type: string } | null>) | null } = {
  current: null,
};

export function setDrawCaptureViewport(
  fn: (() => Promise<{ data: string; media_type: string } | null>) | null,
) {
  _captureRef.current = fn;
}

const drawMode: ModeDefinition = {
  manifest: drawManifest,

  viewer: {
    PreviewComponent: DrawPreview,

    workspace: { type: "single", multiFile: false, ordered: false, hasActiveFile: false },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files[0]?.path || "";
      if (!file) return "";

      const attrs = [`mode="draw"`, `file="${file}"`];
      const lines: string[] = [];

      if (selection && selection.type !== "viewing" && selection.content) {
        lines.push(`Selected: ${selection.content}`);
        if (selection.thumbnail) {
          lines.push("[selection screenshot attached]");
        }
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default drawMode;
