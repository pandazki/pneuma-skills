import type { ContentSet } from "../../core/types/viewer-contract.js";

export interface PersistedViewerState {
  contentSet?: string | null;
  file?: string | null;
}

/** Browser tab storage owns view position; Session files never coordinate it. */
export function viewerStateStorageKey(apiBase: string, href: string): string {
  const url = new URL(href);
  const session = url.searchParams.get("session") ?? "";
  const mode = url.searchParams.get("mode") ?? "";
  return `pneuma:viewer-state:${JSON.stringify([apiBase, session, mode])}`;
}

export function loadTabViewerState(key: string, storage: Pick<Storage, "getItem"> = sessionStorage): PersistedViewerState {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return {};
    const state = value as PersistedViewerState;
    return {
      contentSet: typeof state.contentSet === "string" ? state.contentSet : null,
      file: typeof state.file === "string" ? state.file : null,
    };
  } catch (error) {
    console.warn("[viewer-state] Could not restore tab position", error);
    return {};
  }
}

export function saveTabViewerState(key: string, state: PersistedViewerState, storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try { storage.setItem(key, JSON.stringify(state)); }
  catch (error) { console.warn("[viewer-state] Could not persist tab position", error); }
}

/**
 * Normalize persisted viewer state so content-set modes always store:
 * - `contentSet`: the selected top-level content set prefix
 * - `file`: the content-set-relative file path
 *
 * Older or raced state writes can produce `file: "site-a/index.html"` with
 * `contentSet: null`, which breaks manifest-based viewers on reload.
 */
export function normalizeViewerState(
  state: PersistedViewerState,
  contentSets: ContentSet[],
): { contentSet: string | null; file: string | null } {
  let contentSet = state.contentSet ?? null;
  let file = state.file ?? null;

  // const snapshot so TS narrows it to non-null inside the find() closure
  // (the mutable `file` let is reassigned below and cannot be narrowed there).
  const fileForMatch = file;
  const matchedSet = fileForMatch
    ? contentSets.find((cs) => fileForMatch === cs.prefix || fileForMatch.startsWith(cs.prefix + "/"))
    : undefined;

  if (matchedSet) {
    contentSet = matchedSet.prefix;
    file = file === matchedSet.prefix
      ? null
      : file!.slice(matchedSet.prefix.length + 1);
  } else if (contentSet && file && file.startsWith(contentSet + "/")) {
    file = file.slice(contentSet.length + 1);
  }

  return { contentSet, file };
}
