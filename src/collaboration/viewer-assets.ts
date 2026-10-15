import type { CollaborationViewerCatalog, CollaborationViewerAsset } from "../../core/types/collaboration-session.js";
import type { CollaborationRoom } from "../../core/types/collaboration.js";
import type { ModeDefinition } from "../../core/types/mode-definition.js";

export function matchViewerAsset(room: CollaborationRoom, catalog: CollaborationViewerCatalog): CollaborationViewerAsset {
  const expected = room.compatibility;
  if (!expected || catalog.coreVersion !== expected.coreVersion) throw new Error("The room requires a different viewer runtime version");
  const asset = catalog.modes.find((mode) => mode.mode === room.mode && mode.coreVersion === expected.coreVersion
    && mode.modeVersion === expected.modeVersion && mode.viewerHash === expected.viewerHash && mode.publicationSchema === expected.publicationSchema);
  if (!asset) throw new Error("The exact viewer build for this publication is unavailable. Retry after the host updates its viewer assets.");
  return asset;
}

export async function loadPublishedViewer(room: CollaborationRoom, authorityBaseUrl: string, signal: AbortSignal): Promise<ModeDefinition> {
  const origin = new URL(authorityBaseUrl || location.origin).origin;
  const response = await fetch(`${origin}/viewer-manifest.json`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("The published viewer catalog is unavailable");
  const asset = matchViewerAsset(room, await response.json());
  const trusted = (path: string) => {
    const url = new URL(path, origin);
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol)) throw new Error("Viewer assets must come from the publication authority");
    return url.toString();
  };
  await Promise.all(asset.styles.map((path) => new Promise<void>((resolve, reject) => {
    const href = trusted(path);
    if ([...document.querySelectorAll<HTMLLinkElement>('link[data-collaboration-viewer-style]')].some((link) => link.href === href && link.sheet)) { resolve(); return; }
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; link.dataset.collaborationViewerStyle = "true";
    const abort = () => { link.remove(); reject(signal.reason ?? new Error("Viewer load cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    link.onload = () => { signal.removeEventListener("abort", abort); resolve(); };
    link.onerror = () => { signal.removeEventListener("abort", abort); link.remove(); reject(new Error("The published viewer stylesheet could not load")); };
    document.head.append(link);
  })));
  signal.throwIfAborted();
  const module = await import(/* @vite-ignore */ trusted(asset.entry));
  signal.throwIfAborted();
  const definition: ModeDefinition = module.default;
  if (!definition?.viewer?.PreviewComponent || definition.manifest.name !== room.mode || definition.manifest.version !== asset.modeVersion
    || definition.manifest.viewerApi?.collaboration?.publication.schema !== asset.publicationSchema) throw new Error("The published viewer does not match the room's declared compatibility");
  return definition;
}
