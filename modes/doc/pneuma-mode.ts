/**
 * Doc Mode — 完整的 ModeDefinition。
 *
 * 绑定 manifest (声明式配置) + viewer (React 组件)。
 * 由前端通过 mode-loader 动态 import。
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import DocPreview from "./components/DocPreview.js";
import docManifest from "./manifest.js";

const docMode: ModeDefinition = {
  manifest: docManifest,

  viewer: {
    PreviewComponent: DocPreview,

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
        const desc = selection.level
          ? `${selection.type} (level ${selection.level})`
          : selection.type;
        parts.push(`[User selected: ${desc} "${selection.content}"]`);
      }
      return parts.join("\n");
    },

    updateStrategy: "full-reload",
  },
};

export default docMode;
