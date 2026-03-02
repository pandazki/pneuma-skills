/**
 * Doc Mode — 完整的 ModeDefinition。
 *
 * 绑定 manifest (声明式配置) + viewer (React 组件)。
 * 由前端通过 mode-loader 动态 import。
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import DocPreview from "./viewer/DocPreview.js";
import docManifest from "./manifest.js";

const docMode: ModeDefinition = {
  manifest: docManifest,

  viewer: {
    PreviewComponent: DocPreview,

    workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files[0]?.path || "";
      if (!file) return "";

      const attrs = [`mode="doc"`, `file="${file}"`];
      if (selection?.viewport) {
        attrs.push(`viewport="${selection.viewport.startLine}-${selection.viewport.endLine}"`);
      }

      const lines: string[] = [];
      if (selection?.viewport?.heading) {
        lines.push(`Visible section: ${selection.viewport.heading}`);
      }
      if (selection && selection.type !== "viewing") {
        const desc = selection.level
          ? `${selection.type} (level ${selection.level})`
          : selection.type;
        lines.push(`Selected: ${desc} "${selection.content}"`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default docMode;
