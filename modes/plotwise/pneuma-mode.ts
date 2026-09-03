/**
 * Plotwise Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded dynamically by the frontend via mode-loader; the backend and
 * skill-installer read manifest.ts directly (no React there).
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ContentSet,
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
} from "../../core/types/viewer-contract.js";

import plotwiseManifest from "./manifest.js";
import PlotwisePreview from "./viewer/PlotwisePreview.js";

/**
 * Only directories containing a course.json are content sets — a generic
 * top-level-directory resolver would pick up assets/ or scratch dirs.
 * A single course must still surface (kami precedent): the viewer reads
 * content-set-relative paths, so the prefix has to activate even alone.
 */
function resolvePlotwiseContentSets(files: ViewerFileContent[]): ContentSet[] {
  const sets: ContentSet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const match = file.path.match(/^([^/]+)\/course\.json$/);
    if (!match) continue;
    const dirName = match[1];
    if (dirName.startsWith(".") || seen.has(dirName)) continue;
    seen.add(dirName);

    let label = dirName.charAt(0).toUpperCase() + dirName.slice(1);
    try {
      const parsed = JSON.parse(file.content);
      if (parsed.title) label = parsed.title;
    } catch {
      /* use dir name */
    }

    sets.push({ prefix: dirName, label, traits: {} });
  }

  return sets;
}

const plotwiseMode: ModeDefinition = {
  manifest: plotwiseManifest,

  viewer: {
    PreviewComponent: PlotwisePreview,
    updateStrategy: "incremental",

    extractContext(
      selection: ViewerSelectionContext | null,
      _files: ViewerFileContent[],
    ): string {
      if (!selection) return "";
      const lines: Array<string | null> = [
        `Mode: ${plotwiseManifest.name}`,
        selection.address
          ? `Address: ${JSON.stringify(selection.address)}`
          : null,
        selection.file ? `File: ${selection.file}` : null,
        selection.label ? `Label: ${selection.label}` : null,
        selection.nearbyText ? `Context: ${selection.nearbyText}` : null,
      ];
      return lines.filter(Boolean).join("\n");
    },

    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      manifestFile: "course.json",
      resolveContentSets: resolvePlotwiseContentSets,

      // One item per course node. Files arrive content-set-stripped, so
      // the manifest is `course.json` at the root of the active set.
      // Taken path first (in walk order), then remaining nodes.
      resolveItems(files: ViewerFileContent[]): WorkspaceItem[] {
        const manifestFile = files.find(
          (f) => f.path === "course.json" || f.path.endsWith("/course.json"),
        );
        if (!manifestFile) return [];
        try {
          const parsed = JSON.parse(manifestFile.content) as {
            path?: string[];
            nodes?: Record<string, { choiceLabel?: string; status?: string }>;
          };
          const nodes = parsed.nodes ?? {};
          const walked = (parsed.path ?? []).filter((id) => nodes[id]);
          const rest = Object.keys(nodes).filter((id) => !walked.includes(id));
          return [...walked, ...rest].map((id, i) => ({
            path: `nodes/${id}/script.md`,
            label: nodes[id]?.choiceLabel || id,
            index: i,
          }));
        } catch {
          return [];
        }
      },

      // Courses are born from conversation (topic → outline → segments),
      // not from an empty-state scaffold button.
      createEmpty() {
        return null;
      },
    },

    actions: plotwiseManifest.viewerApi?.actions,
  },
};

export default plotwiseMode;
