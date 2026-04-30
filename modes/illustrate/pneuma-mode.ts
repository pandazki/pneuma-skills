/**
 * Illustrate Mode — ModeDefinition binding manifest + viewer.
 * Loaded by frontend via mode-loader dynamic import.
 *
 * Content set + row-based canvas architecture:
 * - Each top-level directory is a content set (project)
 * - manifest.json tracks rows of generated images
 * - extractContext produces different output depending on selection mode
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import IllustratePreview from "./viewer/IllustratePreview.js";
import illustrateManifest from "./manifest.js";
import { createDirectoryContentSetResolver } from "../../core/utils/content-set-resolver.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ManifestItem {
  file: string;
  title: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  style?: string;
  tags?: string[];
  createdAt?: string;
  status?: "generating" | "ready";
}

interface ManifestRow {
  id: string;
  label: string;
  items: ManifestItem[];
}

interface IllustrateManifest {
  title: string;
  description?: string;
  rows: ManifestRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseManifest(files: ViewerFileContent[]): IllustrateManifest | null {
  const mf = files.find(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (!mf) return null;
  try {
    return JSON.parse(mf.content) as IllustrateManifest;
  } catch {
    return null;
  }
}

/** Find which row an image belongs to, returns row + item index. */
function findItemInRows(
  manifest: IllustrateManifest,
  file: string,
): { row: ManifestRow; rowIndex: number; item: ManifestItem; itemIndex: number } | null {
  for (let ri = 0; ri < manifest.rows.length; ri++) {
    const row = manifest.rows[ri];
    for (let ii = 0; ii < row.items.length; ii++) {
      if (row.items[ii].file === file) {
        return { row, rowIndex: ri, item: row.items[ii], itemIndex: ii };
      }
    }
  }
  return null;
}

function buildStyleSummary(manifest: IllustrateManifest): string {
  const counts: Record<string, number> = {};
  for (const row of manifest.rows) {
    for (const item of row.items) {
      const s = item.style || "unspecified";
      counts[s] = (counts[s] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([style, count]) => `${style} (${count})`)
    .join(", ");
}

function totalItemCount(manifest: IllustrateManifest): number {
  return manifest.rows.reduce((sum, row) => sum + row.items.length, 0);
}

// ── Mode Definition ──────────────────────────────────────────────────────────

const illustrateMode: ModeDefinition = {
  manifest: illustrateManifest,

  viewer: {
    PreviewComponent: IllustratePreview,

    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      resolveContentSets: createDirectoryContentSetResolver(),

      resolveItems(files) {
        const manifest = parseManifest(files);
        if (!manifest) return [];
        // Flatten all rows into a single ordered list of workspace items
        const items: { path: string; label: string; index: number }[] = [];
        let globalIndex = 0;
        for (const row of manifest.rows) {
          for (const item of row.items) {
            items.push({
              path: item.file,
              label: item.title || item.file,
              index: globalIndex++,
            });
          }
        }
        return items;
      },

      createEmpty(files) {
        // Find existing top-level directories
        const existingDirs = new Set<string>();
        for (const f of files) {
          const slashIdx = f.path.indexOf("/");
          if (slashIdx > 0) existingDirs.add(f.path.slice(0, slashIdx));
        }

        // Pick a unique project name
        let projectName = "project-1";
        let n = 1;
        while (existingDirs.has(projectName)) {
          projectName = `project-${++n}`;
        }

        const manifest: IllustrateManifest = {
          title: "New Project",
          description: "AI-generated illustrations",
          rows: [],
        };

        return [
          {
            path: `${projectName}/manifest.json`,
            content: JSON.stringify(manifest, null, 2) + "\n",
          },
        ];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const manifest = parseManifest(files);

      // ── Annotate mode: accumulated annotations ─────────────────────────
      if (selection?.annotations && selection.annotations.length > 0) {
        const file = selection.file || "";
        const lines: string[] = ["Annotations:"];
        selection.annotations.forEach((ann, i) => {
          let title = ann.element.label || ann.slideFile;
          if (manifest) {
            const found = findItemInRows(manifest, ann.slideFile);
            if (found) {
              title = `${found.item.title} (row: "${found.row.label}")`;
            }
          }
          lines.push(`  ${i + 1}. [${ann.slideFile}] "${title}"`);
          if (ann.comment) {
            lines.push(`     Feedback: ${ann.comment}`);
          }
        });

        const attrs = [`mode="illustrate"`];
        if (file) attrs.push(`file="${file}"`);
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      // ── Multi-select: multiple images selected ───────────────────────
      if (selection?.file && selection.content && selection.content.includes("\n")) {
        const attrs = [`mode="illustrate"`, `selection="multi"`];
        const contentLines = selection.content.split("\n").filter(Boolean);
        const lines: string[] = [`${contentLines.length} images selected:`];

        if (manifest) {
          // Parse each selected image from content and enrich with manifest data
          for (const row of manifest.rows) {
            for (const item of row.items) {
              if (contentLines.some((cl) => cl.includes(item.title))) {
                lines.push(`  - "${item.title}" [${item.file}] (row: "${row.label}")`);
                lines.push(`    Prompt: "${item.prompt}"`);
                if (item.style) lines.push(`    Style: ${item.style}`);
              }
            }
          }
        }

        if (lines.length === 1) {
          // Fallback: just use content as-is
          contentLines.forEach((cl) => lines.push(`  - ${cl}`));
        }

        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      // ── Select / view mode: single image selection ─────────────────────
      if (selection?.file) {
        const file = selection.file;
        const attrs = [`mode="illustrate"`, `file="${file}"`];
        const lines: string[] = [];

        if (manifest) {
          const found = findItemInRows(manifest, file);
          if (found) {
            lines.push(`Selected image: "${found.item.title}"`);
            lines.push(`Row ${found.rowIndex + 1}/${manifest.rows.length}: "${found.row.label}" (${found.row.items.length} items)`);
            lines.push(`Prompt: "${found.item.prompt}"`);
            if (found.item.style) lines.push(`Style: ${found.item.style}`);
            if (found.item.aspectRatio) lines.push(`Aspect ratio: ${found.item.aspectRatio}`);
            if (found.item.resolution) lines.push(`Resolution: ${found.item.resolution}`);
            if (found.item.tags?.length) lines.push(`Tags: ${found.item.tags.join(", ")}`);
            if (found.item.createdAt) lines.push(`Created: ${found.item.createdAt}`);
          }
        }

        if (!lines.length && selection.label) {
          lines.push(`Selected: ${selection.label}`);
        }

        if (lines.length === 0) return "";
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      // ── No selection: project-level overview with row summary ──────────
      if (manifest && manifest.rows.length > 0) {
        const total = totalItemCount(manifest);
        const lines: string[] = [];
        lines.push(`Project: "${manifest.title}" (${manifest.rows.length} rows, ${total} images)`);

        const styleSummary = buildStyleSummary(manifest);
        if (styleSummary) lines.push(`Styles: ${styleSummary}`);

        // Row summary
        lines.push("Rows:");
        manifest.rows.forEach((row, i) => {
          lines.push(`  ${i + 1}. "${row.label}" (${row.items.length} items)`);
        });

        // Collect unique tags
        const allTags = new Set<string>();
        for (const row of manifest.rows) {
          for (const item of row.items) {
            item.tags?.forEach((t) => allTags.add(t));
          }
        }
        if (allTags.size > 0) {
          lines.push(`Tags: ${Array.from(allTags).sort().join(", ")}`);
        }

        return `<viewer-context mode="illustrate">\n${lines.join("\n")}\n</viewer-context>`;
      }

      return "";
    },

    actions: [
      {
        id: "navigate-to",
        label: "View Image",
        category: "navigate",
        agentInvocable: true,
        params: {
          file: { type: "string", description: "Image file path", required: true },
        },
        description: "Navigate to and select a specific image on the canvas",
      },
      {
        id: "fit-view",
        label: "Fit All",
        category: "navigate",
        agentInvocable: true,
        params: {},
        description: "Zoom to fit all content on the canvas",
      },
      {
        id: "zoom-to-row",
        label: "Zoom to Row",
        category: "navigate",
        agentInvocable: true,
        params: {
          rowId: { type: "string", description: "Row ID to zoom to", required: true },
        },
        description: "Zoom the canvas to focus on a specific row",
      },
    ],

    updateStrategy: "full-reload",
  },
};

export default illustrateMode;
