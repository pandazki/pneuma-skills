/**
 * ClipCraft Mode — ModeDefinition.
 * Wires the manifest together with the React viewer component.
 * Dynamically imported by mode-loader.ts via default export.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import ClipCraftPreview from "./viewer/ClipCraftPreview.js";
import clipcraftManifest from "./manifest.js";

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const clipcraftMode: ModeDefinition = {
  manifest: clipcraftManifest,

  viewer: {
    PreviewComponent: ClipCraftPreview,

    extractContext(_selection, files) {
      const fileCount = files.length;
      const projectFile = files.find((f) => f.path === "project.json");

      // Defensive parse: if project.json isn't in files or doesn't parse,
      // fall back to the bootstrap message. We don't want extractContext
      // to throw — that would break agent context for every turn.
      let previewSummary: string | null = null;
      if (projectFile) {
        try {
          const parsed = JSON.parse(projectFile.content) as {
            composition?: {
              tracks?: Array<{
                id?: string;
                name?: string;
                previewFrames?: Array<{ id?: string; time?: number; assetId?: string }>;
              }>;
            };
          };
          const tracks = parsed.composition?.tracks ?? [];
          const perTrack = tracks
            .map((t) => ({
              id: t.id ?? "",
              name: t.name ?? "",
              count: Array.isArray(t.previewFrames) ? t.previewFrames.length : 0,
            }))
            .filter((t) => t.count > 0);
          const total = perTrack.reduce((s, t) => s + t.count, 0);

          if (total > 0) {
            const trackLines = perTrack
              .map(
                (t) =>
                  `  <track id="${escapeXmlAttr(t.id)}" name="${escapeXmlAttr(t.name)}" count="${t.count}" />`,
              )
              .join("\n");
            previewSummary = `<preview-frames total="${total}">\n${trackLines}\n</preview-frames>`;
          } else {
            previewSummary = `<preview-frames total="0" />`;
          }
        } catch {
          // Malformed project.json — skip the summary, don't crash.
        }
      }

      const lines = [`ClipCraft bootstrap — ${fileCount} file(s) in workspace`];
      if (previewSummary) lines.push(previewSummary);

      return `<viewer-context mode="clipcraft" files="${fileCount}">\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default clipcraftMode;
