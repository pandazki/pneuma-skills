import type { CollaborationPublicationProjection } from "../../core/types/collaboration-publication.js";
import type { FileChannel, Source } from "../../core/types/source.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Only a committed mode projection enters these Sources; all writes fail closed. */
export function publishedSources(projection: CollaborationPublicationProjection): { sources: Record<string, Source<unknown>>; fileChannel: FileChannel; update: (next: CollaborationPublicationProjection) => void } {
  const records = new Map<string, { value: unknown; destroyed: boolean; listeners: Set<(event: import("../../core/types/source.js").SourceEvent<unknown>) => void> }>();
  const sources = Object.fromEntries(Object.entries(projection.sources).map(([key, raw]) => {
    const record = { value: freeze(structuredClone(raw)) as unknown, destroyed: false, listeners: new Set<(event: import("../../core/types/source.js").SourceEvent<unknown>) => void>() };
    records.set(key, record);
    const source: Source<unknown> = {
      current: () => record.value,
      subscribe: (listener) => { if (record.destroyed) return () => {}; record.listeners.add(listener); return () => record.listeners.delete(listener); },
      write: async () => { if (!record.destroyed) throw new Error("Shared publications are read only. Edit your own workspace in its private Session."); },
      destroy: () => { record.destroyed = true; record.value = null; record.listeners.clear(); },
    };
    return [key, source];
  }));
  let files = publicFiles(projection);
  return {
    sources,
    update: (next) => {
      if (next.schema !== projection.schema || JSON.stringify(Object.keys(next.sources).sort()) !== JSON.stringify([...records.keys()].sort())) throw new Error("Publication Source keys changed without a compatible schema");
      const values = new Map(Object.entries(next.sources).map(([key, value]) => [key, freeze(structuredClone(value))]));
      // Commit every Source and the file snapshot before any subscriber sees the revision.
      files = publicFiles(next);
      for (const [key, record] of records) if (!record.destroyed) record.value = values.get(key);
      for (const record of records.values()) if (!record.destroyed) for (const listener of record.listeners) listener({ kind: "value", origin: "external", value: record.value });
    },
    fileChannel: {
      snapshot: () => files,
      subscribe: () => () => {},
      write: async () => { throw new Error("Shared publications cannot write workspace files"); },
      delete: async () => { throw new Error("Shared publications cannot delete workspace files"); },
    },
  };
}

function publicFiles(projection: CollaborationPublicationProjection): ViewerFileContent[] {
  return Array.isArray(projection.sources.files) ? freeze(structuredClone(projection.sources.files)) as unknown as ViewerFileContent[] : [];
}

/** Encode a raw workspace-relative file path and keep every URL inside its grant. */
export function publicResourceResolver(pageUrl: string, page: string, authorityBaseUrl: string): (path: string) => string {
  const pageAddress = new URL(pageUrl, authorityBaseUrl || location.origin);
  const suffix = page.split("/").map(encodeURIComponent).join("/");
  if (!pageAddress.pathname.endsWith(suffix)) throw new Error("The public resource grant does not match the published entry page");
  const base = new URL(pageAddress);
  base.pathname = base.pathname.slice(0, -suffix.length); base.search = ""; base.hash = "";
  return (path) => {
    const value = path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
    const target = new URL(value, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new Error("Resource is outside the publication grant");
    return target.toString();
  };
}
