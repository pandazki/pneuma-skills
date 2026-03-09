/**
 * WebCraft Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded dynamically by the frontend via mode-loader.
 * Provides the live web preview component and context extraction.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent, ContentSet } from "../../core/types/viewer-contract.js";
import WebPreview from "./viewer/WebPreview.js";
import webcraftManifest from "./manifest.js";

/**
 * Custom content set resolver for WebCraft.
 * Only directories that contain a manifest.json are considered content sets.
 * Generic directory-based resolver would pick up ALL top-level dirs (node_modules, src, etc.).
 */
function resolveWebcraftContentSets(files: ViewerFileContent[]): ContentSet[] {
  const sets: ContentSet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    // Match <dir>/manifest.json
    const match = file.path.match(/^([^/]+)\/manifest\.json$/);
    if (!match) continue;
    const dirName = match[1];
    if (dirName.startsWith(".") || seen.has(dirName)) continue;
    seen.add(dirName);

    // Try to extract title from manifest content
    let label = dirName.charAt(0).toUpperCase() + dirName.slice(1);
    try {
      const parsed = JSON.parse(file.content);
      if (parsed.title) label = parsed.title;
    } catch { /* use dir name */ }

    sets.push({ prefix: dirName, label, traits: {} });
  }

  // WebCraft always returns content sets if any manifest.json dirs found.
  // Unlike generic resolver (requires 2+), webcraft needs content-set prefix
  // stripping even with a single site directory.
  if (sets.length === 0) return [];
  sets.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return sets;
}

const webcraftMode: ModeDefinition = {
  manifest: webcraftManifest,

  viewer: {
    PreviewComponent: WebPreview,

    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      resolveContentSets: resolveWebcraftContentSets,
      resolveItems(files) {
        // Files are content-set-stripped: manifest.json, index.html, etc.
        const manifestFile = files.find(
          (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
        );
        if (!manifestFile) {
          // Fallback: list all HTML files
          return files
            .filter((f) => /\.html$/i.test(f.path))
            .map((f, i) => ({
              path: f.path,
              label: f.path.replace(/^.*\//, "").replace(/\.html$/i, ""),
              index: i,
            }));
        }
        try {
          const parsed = JSON.parse(manifestFile.content);
          return (parsed.pages || []).map((p: { file: string; title?: string }, i: number) => ({
            path: p.file,
            label: p.title || p.file.replace(/\.html$/i, ""),
            index: i,
          }));
        } catch {
          return [];
        }
      },
      // Creates a new site directory (content set) with manifest + index page.
      // Receives ALL raw workspace files (not content-set-filtered).
      createEmpty(files) {
        // Find existing top-level directories
        const existingDirs = new Set<string>();
        for (const f of files) {
          const slashIdx = f.path.indexOf("/");
          if (slashIdx > 0) existingDirs.add(f.path.slice(0, slashIdx));
        }

        // Pick a unique site name
        let siteName = "site-1";
        let n = 1;
        while (existingDirs.has(siteName)) {
          siteName = `site-${++n}`;
        }

        // Copy shared styles from an existing site if available
        let sharedCSS = "";
        for (const dir of existingDirs) {
          const css = files.find((f) => f.path === `${dir}/styles.css`);
          if (css) {
            sharedCSS = css.content;
            break;
          }
        }

        const manifest = {
          title: "New Site",
          pages: [{ file: "index.html", title: "Home" }],
        };

        const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Home</title>${sharedCSS ? '\n  <link rel="stylesheet" href="styles.css">' : ""}
</head>
<body>
  <h1>Home</h1>
  <p>Start building your new site.</p>
</body>
</html>
`;

        const result = [
          { path: `${siteName}/index.html`, content: indexHtml },
          { path: `${siteName}/manifest.json`, content: JSON.stringify(manifest, null, 2) },
        ];
        if (sharedCSS) {
          result.push({ path: `${siteName}/styles.css`, content: sharedCSS });
        }
        return result;
      },
    },

    actions: webcraftManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file = selection?.file || files.find((f) => /\.html$/i.test(f.path))?.path || "";
      if (!file) return "";

      // Parse manifest for page info
      const manifestFile = files.find(
        (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
      );
      let pages: { file: string; title?: string }[] = [];
      if (manifestFile) {
        try {
          const parsed = JSON.parse(manifestFile.content);
          pages = parsed.pages ?? [];
        } catch { /* ignore */ }
      }

      // Build page label from manifest or fallback to HTML file list
      let pageLabel: string;
      if (pages.length > 0) {
        const idx = pages.findIndex((p) => p.file === file);
        if (idx >= 0) {
          const title = pages[idx].title || file.replace(/\.html$/i, "").replace(/^.*\//, "");
          pageLabel = `Viewing page ${idx + 1}/${pages.length}: "${title}"`;
        } else {
          pageLabel = `Viewing: ${file}`;
        }
      } else {
        const htmlFiles = files.filter((f) => /\.html$/i.test(f.path));
        const idx = htmlFiles.findIndex((f) => f.path === file);
        pageLabel = idx >= 0
          ? `Viewing page ${idx + 1}/${htmlFiles.length}: "${file.replace(/\.html$/i, "").replace(/^.*\//, "")}"`
          : `Viewing: ${file}`;
      }

      // Helper to get page label from file path
      const getPageLabel = (filePath: string): string => {
        if (pages.length > 0) {
          const idx = pages.findIndex((p) => p.file === filePath);
          if (idx >= 0) {
            const title = pages[idx].title || filePath.replace(/\.html$/i, "").replace(/^.*\//, "");
            return `page ${idx + 1}: "${title}"`;
          }
        }
        return filePath;
      };

      // Annotations mode — multiple annotated elements with comments
      if (selection?.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="webcraft"`, `file="${file}"`];
        const lines: string[] = [];
        lines.push(pageLabel);
        lines.push("Annotations:");
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          const annPageLabel = getPageLabel(ann.slideFile);

          let primary: string;
          if (el.selector) {
            primary = el.selector;
          } else {
            primary = `${el.type} "${(el.content || "").slice(0, 50)}"`;
          }
          lines.push(`  ${i + 1}. [${annPageLabel}] ${primary}`);
          if (el.label) lines.push(`     Element: ${el.label}`);
          if (el.nearbyText) lines.push(`     Context: ${el.nearbyText}`);
          if (el.accessibility) lines.push(`     Accessibility: ${el.accessibility}`);
          if (ann.comment) lines.push(`     Feedback: ${ann.comment}`);
        });
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="webcraft"`, `file="${file}"`];
      const lines: string[] = [];
      lines.push(pageLabel);

      if (selection && selection.type !== "viewing") {
        if (selection.selector) {
          lines.push(`Selected: ${selection.selector}`);
        } else {
          const desc = selection.level
            ? `${selection.type} (level ${selection.level})`
            : selection.type;
          lines.push(`Selected: ${desc} "${selection.content}"`);
        }
        if (selection.label) lines.push(`  Element: ${selection.label}`);
        if (selection.tag) lines.push(`  Tag: <${selection.tag}>`);
        if (selection.classes) lines.push(`  Classes: ${selection.classes}`);
        if (selection.nearbyText) lines.push(`  Context: ${selection.nearbyText}`);
        if (selection.accessibility) lines.push(`  Accessibility: ${selection.accessibility}`);
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default webcraftMode;
