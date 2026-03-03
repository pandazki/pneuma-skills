/**
 * {{displayName}} Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded dynamically by the frontend via mode-loader.
 * Provides the preview component and context extraction.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import Preview from "./viewer/Preview.js";
import manifest from "./manifest.js";

const mode: ModeDefinition = {
  manifest,

  viewer: {
    PreviewComponent: Preview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files[0]?.path || "";
      if (!file) return "";

      const attrs = [`mode="{{modeName}}"`, `file="${file}"`];
      const lines: string[] = [];

      if (selection && selection.type !== "viewing") {
        lines.push(`Selected: ${selection.type} "${selection.content}"`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default mode;
