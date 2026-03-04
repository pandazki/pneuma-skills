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

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
      resolveItems(files) {
        return files
          .filter((f) => f.path.endsWith(".excalidraw"))
          .map((f, i) => ({
            path: f.path,
            label: f.path.replace(/^.*\//, "").replace(/\.excalidraw$/, ""),
            index: i,
          }));
      },
      createEmpty(files) {
        const existing = new Set(files.map((f) => f.path));
        let name = "drawing.excalidraw";
        let n = 1;
        while (existing.has(name)) {
          name = `drawing-${n++}.excalidraw`;
        }
        const empty = JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "https://excalidraw.com",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        }, null, 2);
        return [{ path: name, content: empty }];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files[0]?.path || "";
      if (!file) return "";

      // Annotations mode — multiple annotated elements with comments
      if (selection?.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="draw"`, `file="${file}"`];
        const lines: string[] = [];
        lines.push("Annotations:");
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          const primary = el.label || `${el.type} "${(el.content || "").slice(0, 50)}"`;
          lines.push(`  ${i + 1}. [${ann.slideFile}] ${primary}`);
          if (ann.comment) lines.push(`     Feedback: ${ann.comment}`);
        });
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="draw"`, `file="${file}"`];
      const lines: string[] = [];

      if (selection && selection.type !== "viewing" && selection.content) {
        if (selection.label) {
          lines.push(`Selected: ${selection.label}`);
        } else {
          lines.push(`Selected: ${selection.content}`);
        }
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
