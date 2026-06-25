/**
 * Wordtaste Mode — complete ModeDefinition.
 *
 * Binds the (React-free) manifest to the ViewerContract: the WordtastePreview
 * studio component, `extractContext` (the §5.1 viewer-context block), and the
 * workspace model (content sets + new-project scaffold).
 *
 * Dynamically imported by the frontend via core/mode-loader.ts. React lives
 * here and in the viewer; the manifest stays backend-readable (brief §2).
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
  ViewerAddress,
} from "../../core/types/viewer-contract.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";
import WordtastePreview from "./viewer/WordtastePreview.js";
import wordtasteManifest from "./manifest.js";

/**
 * Wordtaste's address is `{ contentSet?, block, span? }` plus the viewer's
 * decorations (`frozen`, `rung`, `symptoms`) that `extractContext` surfaces.
 * Read defensively — the address is mode-opaque to the framework and any key
 * may be absent for a coarse (block-only) selection.
 */
interface WordtasteAddress extends ViewerAddress {
  contentSet?: string;
  block?: string;
  span?: { start: number; end: number; quote: string };
  frozen?: boolean;
  rung?: number;
  symptoms?: string[];
}

const wordtasteMode: ModeDefinition = {
  manifest: wordtasteManifest,

  viewer: {
    PreviewComponent: WordtastePreview,

    workspace: {
      // One writing project = one content set (top-level dir). The single
      // editable output per set is draft.md (brief §6.1).
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      // Discover writing projects from top-level directories. minFiles: 1 so a
      // project with just a draft.md counts; no locale/theme parsing needed —
      // the directory name is the project name. allowSingle: 1 so a SOLE
      // writing project living in a subdir (e.g. a freshly seeded
      // worked-example/) is still surfaced + auto-activated — wordtaste scopes
      // every file by the content-set prefix, so without this the lone set
      // stays unselected and the draft renders against the empty root.
      resolveContentSets: createDirectoryContentSetResolver({
        minFiles: 1,
        allowSingle: true,
      }),
      // A new writing project scaffolds an empty draft.md the agent fills in.
      createEmpty(files) {
        const existing = new Set(files.map((f) => f.path));
        let name = "draft.md";
        let n = 1;
        while (existing.has(name)) name = `untitled-${n++}/draft.md`;
        return [{ path: name, content: "" }];
      },
    },

    /**
     * Emit the §5.1 viewer-context block for a wordtaste selection. Even a plain
     * chat message ("this metaphor is too AI") is grounded in the exact
     * address — the agent feeds `address` straight back into
     * `rewrite-span` / `capture`. One noun, every verb.
     */
    extractContext(
      selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      if (!selection || selection.type === "viewing") return "";

      const address = (selection.address ?? {}) as WordtasteAddress;
      const contentSet = address.contentSet ?? "";
      const block = address.block ?? "";

      const attrs = [`mode="wordtaste"`];
      if (contentSet) attrs.push(`contentSet="${escapeAttr(contentSet)}"`);
      if (block) attrs.push(`block="${escapeAttr(block)}"`);

      const lines: string[] = [];

      const quote = address.span?.quote ?? selection.content;
      if (quote) {
        lines.push(`Selected (rewrite target): "${quote}"`);
      }
      if (selection.address) {
        lines.push(`  Address: ${JSON.stringify(selection.address)}`);
      }
      if (typeof address.frozen === "boolean") {
        lines.push(`  Block frozen: ${address.frozen}`);
      }
      if (typeof address.rung === "number") {
        lines.push(`  Active rung: ${address.rung}`);
      }
      if (Array.isArray(address.symptoms) && address.symptoms.length > 0) {
        lines.push(`  Symptoms flagged here: ${address.symptoms.join(", ")}`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    // The draft is large; reflow only changed blocks rather than re-rendering
    // the whole document on every file change (brief §9).
    updateStrategy: "incremental",
  },
};

/** Escape a value for safe inclusion in an XML-ish attribute. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export default wordtasteMode;
