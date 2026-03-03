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
import SlidePreview from "./viewer/SlidePreview.js";
import slideManifest from "./manifest.js";

const slideMode: ModeDefinition = {
  manifest: slideManifest,

  viewer: {
    PreviewComponent: SlidePreview,

    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      resolveItems: (files) => {
        const mf = files.find(
          (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
        );
        if (!mf) return [];
        try {
          const parsed = JSON.parse(mf.content);
          return (parsed.slides ?? []).map(
            (s: { file: string; title?: string }, i: number) => ({
              path: s.file,
              label: s.title || s.file,
              index: i,
            }),
          );
        } catch {
          return [];
        }
      },
    },

    actions: slideManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      if (!selection?.file) return "";

      // Parse manifest for slide info
      const manifestFile = files.find(
        (f) =>
          f.path === "manifest.json" ||
          f.path.endsWith("/manifest.json"),
      );
      let slideTitle = "";
      let slideIndex = 0;
      let slideCount = 0;
      if (manifestFile) {
        try {
          const manifest = JSON.parse(manifestFile.content);
          const slides: { file: string; title?: string }[] = manifest.slides ?? [];
          slideCount = slides.length;
          const idx = slides.findIndex((s) => s.file === selection.file);
          if (idx >= 0) {
            slideIndex = idx + 1;
            slideTitle = slides[idx].title || "";
          }
        } catch { /* ignore parse errors */ }
      }

      // Helper to get slide label from file path
      const getSlideLabel = (file: string): string => {
        if (!manifestFile) return file;
        try {
          const m = JSON.parse(manifestFile.content);
          const ss: { file: string; title?: string }[] = m.slides ?? [];
          const idx = ss.findIndex((s) => s.file === file);
          if (idx >= 0) {
            const title = ss[idx].title;
            return title ? `slide ${idx + 1}: "${title}"` : `slide ${idx + 1}`;
          }
        } catch {}
        return file;
      };

      // Annotations mode — multiple annotated elements with comments
      if (selection.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="slide"`, `file="${selection.file}"`];
        const lines: string[] = [];

        if (slideIndex > 0) {
          const desc = slideTitle
            ? `Viewing slide ${slideIndex}/${slideCount}: "${slideTitle}"`
            : `Viewing slide ${slideIndex}/${slideCount}`;
          lines.push(desc);
        }

        lines.push("Annotations:");
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          const slideLabel = getSlideLabel(ann.slideFile);

          // Primary identification: selector or type description (same as select mode)
          let primary: string;
          if (el.selector) {
            primary = el.selector;
          } else {
            const desc = el.type;
            primary = `${desc} "${(el.content || "").slice(0, 50)}"`;
          }

          lines.push(`  ${i + 1}. [${slideLabel}] ${primary}`);

          // Rich identification details (same fields as select mode)
          if (el.label) {
            lines.push(`     Element: ${el.label}`);
          }
          if (el.nearbyText) {
            lines.push(`     Context: ${el.nearbyText}`);
          }
          if (el.accessibility) {
            lines.push(`     Accessibility: ${el.accessibility}`);
          }
          if (el.type === "region" && el.thumbnail) {
            lines.push(`     [region screenshot attached as image]`);
          }
          if (ann.comment) {
            lines.push(`     Feedback: ${ann.comment}`);
          }
        });

        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="slide"`, `file="${selection.file}"`];
      const lines: string[] = [];

      if (slideIndex > 0) {
        const desc = slideTitle
          ? `Viewing slide ${slideIndex}/${slideCount}: "${slideTitle}"`
          : `Viewing slide ${slideIndex}/${slideCount}`;
        lines.push(desc);
      }

      // Include element selection (skip for "viewing" pseudo-selection)
      if (selection.type !== "viewing" && (selection.selector || selection.content)) {
        if (selection.selector) {
          lines.push(`Selected: ${selection.selector}`);
        } else {
          const desc = selection.level
            ? `${selection.type} (level ${selection.level})`
            : selection.type;
          lines.push(`Selected: ${desc} "${selection.content}"`);
        }
        // Rich identification from iframe selection
        if (selection.label) {
          lines.push(`  Element: ${selection.label}`);
        }
        if (selection.nearbyText) {
          lines.push(`  Context: ${selection.nearbyText}`);
        }
        if (selection.accessibility) {
          lines.push(`  Accessibility: ${selection.accessibility}`);
        }
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default slideMode;
