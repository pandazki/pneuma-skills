import type { ContentSet } from "../../core/types/viewer-contract.js";

export interface PersistedViewerState {
  contentSet?: string | null;
  file?: string | null;
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

  const matchedSet = file
    ? contentSets.find((cs) => file === cs.prefix || file.startsWith(cs.prefix + "/"))
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
