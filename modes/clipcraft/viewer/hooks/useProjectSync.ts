import { useEffect, type MutableRefObject } from "react";
import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import {
  usePneumaCraftStore,
  useEventLog,
} from "@pneuma-craft/react";
import {
  parseProjectFile,
  projectFileToCommands,
  serializeProject,
  formatProjectJson,
} from "../../persistence.js";
import { writeProjectFile } from "../../api-client.js";

const AUTOSAVE_DELAY_MS = 500;

export interface UseProjectSyncOptions {
  /**
   * Parent-owned ref tracking the content we've committed to (either by
   * hydrating from disk or by writing to disk). The hook reads from it to
   * skip echoes and writes to it after each successful write.
   *
   * Must be a stable ref (declared via useRef at the parent component level).
   */
  lastAppliedRef: MutableRefObject<string | null>;
  /**
   * Called after a successful local write with the content we just wrote.
   * Parent uses this to avoid bumping the providerKey when its own write
   * echoes back through the file watcher.
   *
   * Must be a stable reference (useCallback at the parent level).
   */
  onLocalWrite: (content: string) => void;
}

/**
 * Bidirectional project.json sync.
 *
 * Hydration direction:
 *   disk → files prop → hook → dispatch hydration commands to craft store
 *   Skipped when incoming content equals lastAppliedRef.current — that
 *   either means we just wrote it ourselves, or we already hydrated this
 *   exact content (strict-mode double-invoke protection).
 *
 * Persistence direction:
 *   craft events → debounced serialize → POST /api/files
 *   Skipped when the serialized content equals lastAppliedRef.current —
 *   prevents no-op writes when state changes but the serialization is the
 *   same (e.g. a selection:set that produces no on-disk delta).
 *
 * TODO(plan-3c): replace the "full re-dispatch on external edit" path with
 * diff-and-dispatch so the store (and any active PlaybackEngine) survives
 * cross-session edits. Also remove the lastAppliedRef band-aid once the diff
 * path is reliable.
 */
export function useProjectSync(
  files: ViewerFileContent[],
  options: UseProjectSyncOptions,
): { error: string | null } {
  const { lastAppliedRef, onLocalWrite } = options;
  const dispatch = usePneumaCraftStore((s) => s.dispatch);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;

  // Locate project.json
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const diskContent = projectFile?.content ?? null;

  // ── Hydration: disk → memory ─────────────────────────────────────────
  useEffect(() => {
    if (diskContent === null) return;
    if (diskContent === lastAppliedRef.current) return;

    // Claim this content as "applied" BEFORE dispatching so any echo that
    // arrives during the dispatch loop is correctly skipped.
    lastAppliedRef.current = diskContent;

    const parsed = parseProjectFile(diskContent);
    if (!parsed.ok) return;

    for (const env of projectFileToCommands(parsed.value)) {
      try {
        dispatch(env.actor, env.command);
      } catch (e) {
        // Expected for re-dispatch scenarios (strict-mode, debounced echo).
        // eslint-disable-next-line no-console
        console.warn(
          "[clipcraft] hydration command rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }
  }, [diskContent, dispatch, lastAppliedRef]);

  // ── Persistence: memory → disk (debounced) ──────────────────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      const file = serializeProject(coreState, composition);
      const content = formatProjectJson(file);
      if (content === lastAppliedRef.current) return;

      // Claim the new content BEFORE the fetch so the echo is skipped.
      // If the write fails, we roll back the claim — the in-memory state
      // is still the truth, and the next dispatch will try again.
      const previousApplied = lastAppliedRef.current;
      lastAppliedRef.current = content;

      try {
        await writeProjectFile(content);
        onLocalWrite(content);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[clipcraft] autosave failed", e);
        lastAppliedRef.current = previousApplied;
      }
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [eventCount, coreState, composition, lastAppliedRef, onLocalWrite]);

  // Return value: parse errors only (command dispatch errors are logged).
  if (diskContent === null) {
    return { error: "project.json not found in workspace" };
  }
  const parsed = parseProjectFile(diskContent);
  return { error: parsed.ok ? null : parsed.error };
}
