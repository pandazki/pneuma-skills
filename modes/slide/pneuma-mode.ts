/**
 * Slide Mode — ModeDefinition binding.
 *
 * Binds manifest (declarative config) + viewer (React component).
 * Dynamically imported by frontend via mode-loader.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../core/types/viewer-contract.js";
import SlidePreview from "./components/SlidePreview.js";
import slideManifest from "./manifest.js";

const slideMode: ModeDefinition = {
  manifest: slideManifest,

  viewer: {
    PreviewComponent: SlidePreview,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const parts: string[] = [];

      // Resolve slide title from manifest.json
      const resolveSlideTitle = (filePath: string): string => {
        const manifestFile = files.find(
          (f) =>
            f.path === "manifest.json" ||
            f.path.endsWith("/manifest.json"),
        );
        if (!manifestFile) return "";
        try {
          const manifest = JSON.parse(manifestFile.content);
          const slide = manifest.slides?.find(
            (s: { file: string; title: string }) => s.file === filePath,
          );
          return slide?.title || "";
        } catch {
          return "";
        }
      };

      // Include which slide the user is viewing
      if (selection?.file) {
        const slideTitle = resolveSlideTitle(selection.file);
        const viewDesc = slideTitle
          ? `${selection.file} "${slideTitle}"`
          : selection.file;
        parts.push(`[Context: slide, viewing: ${viewDesc}]`);
      }

      // Include element selection (skip for "viewing" pseudo-selection)
      if (selection && selection.type !== "viewing" && selection.content) {
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

export default slideMode;
