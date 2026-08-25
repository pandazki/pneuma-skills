/**
 * ELI5 Mode — ModeDefinition binding.
 *
 * Binds manifest (declarative config) + viewer (React component).
 * Dynamically imported by the frontend via mode-loader. Every piece of
 * data lives in `manifest.ts`; only the functions — which a manifest
 * cannot carry across the backend/frontend boundary — are written here.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";
import eli5Manifest from "./manifest.js";
import Eli5Preview from "./viewer/Eli5Preview.js";

/**
 * The manifest for the ladder currently in view, plus the directory it
 * sits in.
 *
 * The file list arrives content-set-stripped when a content set is
 * active, and unstripped when it is not — a single-topic workspace has
 * no switchable set, so its files still read `<topic>/manifest.json`.
 * Returning the prefix alongside the parse lets both callers below stay
 * correct in either shape.
 */
function findLadder(
  files: ViewerFileContent[],
): { prefix: string; audiences: Array<{ file: string; label: string }> } | null {
  const manifestFile = files.find(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (!manifestFile) return null;

  const prefix =
    manifestFile.path === "manifest.json"
      ? ""
      : manifestFile.path.slice(0, -"/manifest.json".length);

  try {
    const parsed = JSON.parse(manifestFile.content) as {
      audiences?: Array<{ id?: string; label?: string; file?: string }>;
    };
    const raw = Array.isArray(parsed.audiences) ? parsed.audiences : [];
    return {
      prefix,
      audiences: raw.map((a, i) => {
        const file = typeof a?.file === "string" ? a.file : "";
        const label =
          (typeof a?.label === "string" && a.label) ||
          (typeof a?.id === "string" && a.id) ||
          file ||
          `Audience ${i + 1}`;
        return { file, label };
      }),
    };
  } catch {
    // A half-written manifest is a normal intermediate state while the
    // agent edits; an empty ladder for one render is the right answer.
    return null;
  }
}

/** Join a content-set prefix back onto a page path. */
function withPrefix(prefix: string, file: string): string {
  if (!file) return "";
  return prefix === "" ? file : `${prefix}/${file}`;
}

const eli5Mode: ModeDefinition = {
  manifest: eli5Manifest,

  viewer: {
    PreviewComponent: Eli5Preview,

    workspace: {
      // Data comes from the manifest — it is the single source of truth,
      // read by the backend too. Only functions are defined here.
      type: eli5Manifest.viewerApi!.workspace!.type,
      multiFile: eli5Manifest.viewerApi!.workspace!.multiFile,
      ordered: eli5Manifest.viewerApi!.workspace!.ordered,
      hasActiveFile: eli5Manifest.viewerApi!.workspace!.hasActiveFile,
      manifestFile: eli5Manifest.viewerApi!.workspace!.manifestFile,

      // One topic per top-level directory.
      resolveContentSets: createDirectoryContentSetResolver(),

      /**
       * One workspace item per rung of the ladder, in manifest order.
       *
       * The path is prefixed back into the space of the `files` array we
       * were handed, so an item always names a file the caller can find.
       * That matters here more than it does for slide: an ELI5 workspace
       * usually holds a single topic, which the directory resolver does
       * not surface as a content set, so paths arrive unstripped and an
       * unprefixed item would be nulled out of `activeFile` on sight.
       */
      resolveItems(files: ViewerFileContent[]): WorkspaceItem[] {
        const ladder = findLadder(files);
        if (!ladder) return [];
        return ladder.audiences.map((audience, i) => ({
          path: withPrefix(ladder.prefix, audience.file),
          label: audience.label,
          index: i,
        }));
      },

      // Explainers are agent-authored: a topic is born from a request in
      // chat, not from an empty-shell "new" button. Nothing to create.
      createEmpty: () => null,
    },

    actions: eli5Manifest.viewerApi?.actions,

    /**
     * Translate the user's focus into the `<viewer-context>` block that
     * prefixes their next message.
     *
     * The envelope is not decoration: `src/ws.ts` injects the active
     * content set into the opening tag, re-prefixes the `file` attribute,
     * appends the content-set listing, and splices `<user-actions>` in
     * before the closing tag. A bare list of lines would silently lose
     * all four.
     */
    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const ladder = findLadder(files);

      // Derive the page in view: explicit selection → first rung.
      let activeFile = selection?.file || "";
      if (!activeFile && ladder && ladder.audiences.length > 0) {
        activeFile = withPrefix(ladder.prefix, ladder.audiences[0].file);
      }
      if (!activeFile) return "";

      const lines: string[] = [];

      if (ladder && ladder.audiences.length > 0) {
        const rung = ladder.audiences.findIndex(
          (a) =>
            a.file === activeFile ||
            withPrefix(ladder.prefix, a.file) === activeFile,
        );
        if (rung >= 0) {
          lines.push(
            `Viewing audience ${rung + 1}/${ladder.audiences.length}: "${ladder.audiences[rung].label}"`,
          );
        }
      }

      // Skip the "viewing" pseudo-selection — it carries no user intent
      // beyond the page already named in the attributes.
      if (selection && selection.type !== "viewing") {
        if (selection.selector) {
          lines.push(`Selected: ${selection.selector}`);
        } else if (selection.content) {
          const desc = selection.level
            ? `${selection.type} (level ${selection.level})`
            : selection.type;
          lines.push(`Selected: ${desc} "${selection.content}"`);
        }
        // The ViewerAddress — the machine handle the agent feeds straight
        // back into `navigate-to`, `capture`, or a `<viewer-locator>`.
        if (selection.address) {
          lines.push(`Address: ${JSON.stringify(selection.address)}`);
        }
        if (selection.label) lines.push(`Label: ${selection.label}`);
        if (selection.nearbyText) lines.push(`Context: ${selection.nearbyText}`);
        if (selection.accessibility) {
          lines.push(`Accessibility: ${selection.accessibility}`);
        }
      }

      if (lines.length === 0) return "";

      const attrs = [`mode="eli5"`, `file="${escapeAttr(activeFile)}"`];
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

export default eli5Mode;
