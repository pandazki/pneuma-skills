import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../core/types/viewer-contract.js";
import DiagramPreview from "./viewer/DiagramPreview.js";
import diagramManifest from "./manifest.js";

const _captureRef: {
  current: (() => Promise<{ data: string; media_type: string } | null>) | null;
} = { current: null };

export function setDiagramCaptureViewport(
  fn: (() => Promise<{ data: string; media_type: string } | null>) | null,
) {
  _captureRef.current = fn;
}

const diagramMode: ModeDefinition = {
  manifest: diagramManifest,

  viewer: {
    PreviewComponent: DiagramPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,

      resolveItems(files) {
        return files
          .filter((f) => f.path.endsWith(".drawio"))
          .map((f, i) => ({
            path: f.path,
            label: f.path.replace(/^.*\//, "").replace(/\.drawio$/, ""),
            index: i,
          }));
      },

      createEmpty(files) {
        const existing = new Set(files.map((f) => f.path));
        let name = "diagram.drawio";
        let n = 1;
        while (existing.has(name)) {
          name = `diagram-${n++}.drawio`;
        }
        const empty = `<mxfile>\n  <diagram id="page-1" name="Page-1">\n    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
        return [{ path: name, content: empty }];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file =
        selection?.file ||
        files.find((f) => f.path.endsWith(".drawio"))?.path ||
        files[0]?.path ||
        "";
      if (!file) return "";

      if (selection?.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="diagram"`, `file="${file}"`];
        const lines: string[] = ["Annotations:"];
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          const primary =
            el.label || `${el.type} "${(el.content || "").slice(0, 50)}"`;
          lines.push(`  ${i + 1}. [${ann.slideFile}] ${primary}`);
          if (ann.comment) lines.push(`     Feedback: ${ann.comment}`);
        });
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="diagram"`, `file="${file}"`];
      const lines: string[] = [];

      if (selection && selection.type !== "viewing" && selection.content) {
        lines.push(
          selection.label
            ? `Selected: ${selection.label}`
            : `Selected: ${selection.content}`,
        );
        if (selection.thumbnail) {
          lines.push("[selection screenshot attached]");
        }
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",

    async captureViewport() {
      return _captureRef.current ? _captureRef.current() : null;
    },
  },
};

export default diagramMode;
