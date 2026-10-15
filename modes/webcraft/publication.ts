import type { ModePublicationAdapter, ModePublicationOutput } from "../../core/types/collaboration-publication.js";
import { isCollaborationPublicPath } from "../../core/types/collaboration-publication.js";
import { loadSite } from "./domain.js";
import { buildWebcraftPublicPageScript } from "./viewer/page-runtime.js";

export const WEBCRAFT_PUBLICATION_SCHEMA = "webcraft-public-v1";
const RENDERING_RESOURCE = /\.(?:html?|css|m?js|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|mp4|webm|mp3|wav|ogg)$/i;

const adapter: ModePublicationAdapter = {
  schema: WEBCRAFT_PUBLICATION_SCHEMA,
  frameScript: buildWebcraftPublicPageScript(),
  project(input): ModePublicationOutput {
    const contentSet = input.contentSet;
    if (contentSet && !isCollaborationPublicPath(contentSet)) throw new Error("The selected content set cannot be published");
    const prefix = contentSet ? `${contentSet}/` : "";
    const otherContentSets = new Set(input.files.flatMap((file) => {
      const match = file.path.match(/^([^/]+)\/manifest\.json$/);
      return match ? [match[1]] : [];
    }));
    const implicitContentSets = new Set(input.files.flatMap((file) => {
      const match = file.path.match(/^([^/]+)\/[^/]+\.html?$/i);
      return match ? [match[1]] : [];
    }));
    const rootManifest = input.files.find((file) => file.path === "manifest.json");
    const rootPages = !prefix && rootManifest ? loadSite([rootManifest])?.byContentSet[""]?.pages ?? [] : [];
    const rootPageDirectories = new Set(rootPages.filter((entry) => entry.file.includes("/")).map((entry) => entry.file.split("/")[0]));
    const candidates = input.files.filter((file) => isCollaborationPublicPath(file.path)
      && (prefix ? file.path.startsWith(prefix) : !otherContentSets.has(file.path.split("/")[0])
        && (!implicitContentSets.has(file.path.split("/")[0]) || rootPageDirectories.has(file.path.split("/")[0]))));
    // Selecting a content set explicitly declares its static data public too.
    // Root-level JSON has no such scope; manifests supply projected page metadata only.
    const rendering = candidates.filter((file) => RENDERING_RESOURCE.test(file.path)
      || !!prefix && /\.json$/i.test(file.path) && !/(?:^|\/)manifest\.json$/i.test(file.path));
    if (!prefix) {
      // Root workspaces also hold unrelated JSON. Only declared page/script
      // references make their data dependencies part of the public site.
      const referenced = new Set<string>();
      for (const file of rendering) {
        for (const match of file.content.matchAll(/["']([^"'\s]+\.json(?:[?#][^"'\s]*)?)["']/gi)) {
          try {
            const url = new URL(match[1], `https://webcraft.invalid/${file.path}`);
            if (url.origin === "https://webcraft.invalid") referenced.add(decodeURIComponent(url.pathname.slice(1)));
          } catch { /* A malformed URL is not a public dependency. */ }
        }
      }
      for (const file of candidates) if (referenced.has(file.path) && /\.json$/i.test(file.path) && !/(?:^|\/)manifest\.json$/i.test(file.path)) rendering.push(file);
    }
    const available = new Set(rendering.map((file) => file.path));
    const loaded = loadSite(candidates.filter((file) => file.path === `${prefix}manifest.json` || /\.html?$/i.test(file.path)));
    const bucket = loaded?.byContentSet[contentSet ?? ""];
    if (!bucket) throw new Error("The selected site has no publishable pages");
    const pages = bucket.pages.filter((entry) => isCollaborationPublicPath(entry.file) && available.has(prefix + entry.file))
      .map((entry) => ({ file: entry.file, title: entry.title }));
    if (!pages.length) throw new Error("The selected site has no publishable pages");
    const active = input.activeFile && available.has(prefix + input.activeFile) && /\.html?$/i.test(input.activeFile)
      ? input.activeFile : pages.find((entry) => entry.file === "index.html")?.file ?? pages[0].file;
    return {
      projection: { schema: WEBCRAFT_PUBLICATION_SCHEMA,
        sources: { site: { byContentSet: { [contentSet ?? ""]: { pages } } },
          files: rendering.map((file) => ({ path: file.path, content: "" })) },
        entryAddress: { ...(contentSet ? { contentSet } : {}), page: active } },
      resources: rendering.map((file) => file.path), page: prefix + active,
      projectionInputs: candidates.some((file) => file.path === `${prefix}manifest.json`) ? [`${prefix}manifest.json`] : [],
    };
  },
};

export default adapter;
