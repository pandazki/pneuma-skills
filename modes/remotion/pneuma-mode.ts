/**
 * Remotion Mode Definition — binds manifest + viewer.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
  ContentSet,
} from "../../core/types/viewer-contract.js";
import RemotionPreview from "./viewer/RemotionPreview.js";
import remotionManifest from "./manifest.js";
import { parseCompositions } from "./viewer/composition-parser.js";

/**
 * Discover content sets by looking for directories containing src/Root.tsx.
 * Each such directory is a separate Remotion project.
 * Returns empty if 0-1 projects (single project = no switching needed).
 */
function resolveRemotionContentSets(files: ViewerFileContent[]): ContentSet[] {
  const sets: ContentSet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    // Match <dir>/src/Root.tsx
    const match = file.path.match(/^([^/]+)\/src\/Root\.tsx$/);
    if (!match) continue;
    const dirName = match[1];
    if (dirName.startsWith(".") || seen.has(dirName)) continue;
    seen.add(dirName);

    // Use directory name as label, capitalize first letter
    const label = dirName.charAt(0).toUpperCase() + dirName.slice(1).replace(/[-_]/g, " ");
    sets.push({ prefix: dirName, label, traits: {} });
  }

  // Only return content sets if 2+ found
  if (sets.length < 2) return [];
  sets.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return sets;
}

/**
 * Resolve workspace items — each composition in Root.tsx becomes a navigable item.
 * The TopBar renders these as a selector; activeFile holds the composition ID.
 */
function resolveRemotionItems(files: ViewerFileContent[]) {
  const rootFile = files.find((f) => f.path === "src/Root.tsx");
  if (!rootFile) return [];

  const compositions = parseCompositions(rootFile.content);
  return compositions.map((c, i) => ({
    path: c.id,
    label: c.id,
    index: i,
    metadata: {
      durationInFrames: c.durationInFrames,
      fps: c.fps,
      width: c.width,
      height: c.height,
    },
  }));
}

const remotionMode: ModeDefinition = {
  manifest: remotionManifest,

  viewer: {
    PreviewComponent: RemotionPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
      resolveItems: resolveRemotionItems,
      resolveContentSets: resolveRemotionContentSets,
    },

    actions: remotionManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const rootFile = files.find(
        (f) => f.path === "src/Root.tsx",
      );

      const compositions = rootFile
        ? parseCompositions(rootFile.content)
        : [];

      const lines: string[] = [];

      // Playback state from viewport (silently set via onViewportChange)
      // viewport: file=compositionId, startLine=currentFrame, endLine=totalFrames, heading=status
      if (selection?.viewport) {
        const vp = selection.viewport;
        const compId = selection.file ?? vp.heading ?? "unknown";
        const currentFrame = vp.startLine;
        const totalFrames = vp.endLine;
        const comp = compositions.find((c) => c.id === compId);
        const fps = comp?.fps ?? 30;
        const status = vp.heading ?? "paused";
        const timeStr = `${(currentFrame / fps).toFixed(1)}s`;
        const durationStr = `${(totalFrames / fps).toFixed(1)}s`;
        lines.push(`Viewing: ${compId} (${status} at ${timeStr} / ${durationStr}, frame ${currentFrame}/${totalFrames})`);
      } else if (compositions.length > 0) {
        lines.push(`Compositions: ${compositions.map((c) => c.id).join(", ")}`);
      }

      return `<viewer-context mode="remotion">\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default remotionMode;
