/**
 * Doc Mode — Complete ModeDefinition.
 *
 * Binds manifest (declarative config) + viewer (React component).
 * Dynamically imported by the frontend via mode-loader.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import DocPreview from "./viewer/DocPreview.js";
import docManifest from "./manifest.js";

const docMode: ModeDefinition = {
  manifest: docManifest,

  viewer: {
    PreviewComponent: DocPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
      resolveItems(files) {
        return files
          .filter((f) => /\.(md|markdown)$/i.test(f.path))
          .map((f, i) => ({
            path: f.path,
            label: f.path.replace(/^.*\//, "").replace(/\.(md|markdown)$/i, ""),
            index: i,
          }));
      },
      createEmpty(files) {
        const existing = new Set(files.map((f) => f.path));
        let name = "untitled.md";
        let n = 1;
        while (existing.has(name)) {
          name = `untitled-${n++}.md`;
        }
        return [{ path: name, content: `# ${name.replace(/\.md$/, "")}\n` }];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files.find((f) => /\.(md|markdown)$/i.test(f.path))?.path || files[0]?.path || "";
      if (!file) return "";

      // Annotations mode — multiple annotated elements with comments
      if (selection?.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="doc"`, `file="${file}"`];
        if (selection.viewport) {
          attrs.push(`viewport="${selection.viewport.startLine}-${selection.viewport.endLine}"`);
        }
        const lines: string[] = [];
        if (selection.viewport?.heading) {
          lines.push(`Visible section: ${selection.viewport.heading}`);
        }
        lines.push("Annotations:");
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          let primary: string;
          if (el.selector) {
            primary = el.selector;
          } else {
            primary = `${el.type} "${(el.content || "").slice(0, 50)}"`;
          }
          lines.push(`  ${i + 1}. [${ann.slideFile}] ${primary}`);
          if (el.label) lines.push(`     Element: ${el.label}`);
          if (el.nearbyText) lines.push(`     Context: ${el.nearbyText}`);
          if (ann.comment) lines.push(`     Feedback: ${ann.comment}`);
        });
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="doc"`, `file="${file}"`];
      if (selection?.viewport) {
        attrs.push(`viewport="${selection.viewport.startLine}-${selection.viewport.endLine}"`);
      }

      const lines: string[] = [];
      if (selection?.viewport?.heading) {
        lines.push(`Visible section: ${selection.viewport.heading}`);
      }
      if (selection && selection.type !== "viewing") {
        if (selection.selector) {
          lines.push(`Selected: ${selection.selector}`);
        } else {
          const desc = selection.level
            ? `${selection.type} (level ${selection.level})`
            : selection.type;
          lines.push(`Selected: ${desc} "${selection.content}"`);
        }
        if (selection.label) lines.push(`  Element: ${selection.label}`);
        if (selection.nearbyText) lines.push(`  Context: ${selection.nearbyText}`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default docMode;
