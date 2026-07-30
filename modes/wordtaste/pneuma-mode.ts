import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerAddress,
  ViewerFileContent,
  ViewerSelectionContext,
} from "../../core/types/viewer-contract.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";
import WordtastePreview from "./viewer/WordtastePreview.js";
import wordtasteManifest from "./manifest.js";

interface WordtasteAddress extends ViewerAddress {
  contentSet?: string;
  file?: string;
  quote?: string;
  start?: number;
  end?: number;
}

const EMPTY_WORKFLOW = {
  version: 2,
  stage: "intake",
  goal: "",
  emphasis: [],
  candidates: [],
};

const resolvePieceDirectories = createDirectoryContentSetResolver({
  minFiles: 1,
  allowSingle: true,
});

/**
 * A WordTaste workspace is either one piece at the root or several pieces in
 * top-level directories. Supporting folders such as materials/, taste/, and
 * candidates/ are never pieces by themselves.
 */
export function resolveWordtasteContentSets(
  files: ViewerFileContent[],
) {
  const hasRootPiece = files.some(
    (file) => file.path === "draft.md" || file.path === "workflow.json",
  );
  if (hasRootPiece) return [];

  const pieceDirectories = new Set(
    files.flatMap((file) => {
      const match = file.path.match(/^([^/]+)\/(?:draft\.md|workflow\.json)$/);
      return match ? [match[1]] : [];
    }),
  );
  if (pieceDirectories.size === 0) return [];

  return resolvePieceDirectories(
    files.filter((file) => pieceDirectories.has(file.path.split("/", 1)[0])),
  );
}

const wordtasteMode: ModeDefinition = {
  manifest: wordtasteManifest,

  viewer: {
    PreviewComponent: WordtastePreview,

    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      resolveContentSets: resolveWordtasteContentSets,
      createEmpty(files) {
        const existing = new Set(files.map((file) => file.path));
        let prefix = "";
        let counter = 1;
        while (
          existing.has(prefix ? `${prefix}/draft.md` : "draft.md")
          || existing.has(prefix ? `${prefix}/workflow.json` : "workflow.json")
        ) {
          prefix = `untitled-${counter++}`;
        }
        const at = (path: string) => (prefix ? `${prefix}/${path}` : path);
        return [
          { path: at("draft.md"), content: "" },
          {
            path: at("workflow.json"),
            content: `${JSON.stringify(EMPTY_WORKFLOW, null, 2)}\n`,
          },
          {
            path: at("materials/brief.md"),
            content: "# Writing brief\n\nDescribe the concrete writing goal here.\n",
          },
        ];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      if (!selection || selection.type === "viewing") return "";
      const address = (selection.address ?? {}) as WordtasteAddress;
      const attrs = ['mode="wordtaste"'];
      if (address.contentSet) {
        attrs.push(`contentSet="${escapeAttr(address.contentSet)}"`);
      }
      if (address.file) attrs.push(`file="${escapeAttr(address.file)}"`);

      const quote = address.quote ?? selection.content;
      const lines = [
        quote ? `The user pointed at this text: "${quote}"` : "",
        selection.address
          ? `Address in the current draft: ${JSON.stringify(selection.address)}`
          : "",
        "Treat this as a cheap human signal. Do not ask them to diagnose the cause.",
      ].filter(Boolean);

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "incremental",
  },
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export default wordtasteMode;
