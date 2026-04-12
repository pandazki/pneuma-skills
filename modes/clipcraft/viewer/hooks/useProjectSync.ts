import { useEffect, useRef, type MutableRefObject } from "react";
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
  /**
   * Called when an external edit arrives on a non-fresh store. The parent
   * should bump its providerKey to remount the hook with a fresh craft store.
   *
   * Must be a stable reference.
   */
  onExternalEdit: () => void;
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
  const { lastAppliedRef, onLocalWrite, onExternalEdit } = options;
  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;

  // Instance-local ref — tracks which diskContent the CURRENT hook instance
  // has already hydrated. Used for strict-mode double-invoke protection.
  // This ref is reset on every hook remount (providerKey bump), so after an
  // external edit the fresh instance will re-hydrate cleanly. lastAppliedRef
  // (parent-owned) is only for echo-skip on our own writes.
  const hydratedDiskRef = useRef<string | null>(null);

  // Plan 3c: remember the on-disk title so serialization can round-trip it.
  // Craft's domain model has no title concept, so we track it out-of-band.
  const currentTitleRef = useRef<string>("Untitled");

  // Locate project.json
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const diskContent = projectFile?.content ?? null;

  // ── Hydration: disk → memory ─────────────────────────────────────────
  useEffect(() => {
    if (diskContent === null) return;
    // Echo skip: ignore a disk change that matches our own last write.
    if (diskContent === lastAppliedRef.current) return;
    // Strict-mode double-invoke guard (instance-local).
    if (diskContent === hydratedDiskRef.current) return;
    hydratedDiskRef.current = diskContent;

    // If the parent already has a different content applied, this is an
    // external edit landing on a live (stale) store. Defer to the parent
    // to bump providerKey and remount us — the fresh instance will then
    // hydrate cleanly on next render. We intentionally do NOT dispatch
    // against the stale store (would produce duplicate-id errors) and do
    // NOT update lastAppliedRef here (the parent needs to still see the
    // old value during its external-edit decision).
    if (lastAppliedRef.current !== null) {
      onExternalEdit();
      return;
    }

    const parsed = parseProjectFile(diskContent);
    if (!parsed.ok) return;

    // Plan 3c: remember the on-disk title so serialization can round-trip it.
    currentTitleRef.current = parsed.value.title;

    for (const env of projectFileToCommands(parsed.value)) {
      try {
        dispatchEnvelope(env);
      } catch (e) {
        // Expected for re-dispatch scenarios (strict-mode, debounced echo).
        // eslint-disable-next-line no-console
        console.warn(
          "[clipcraft] hydration envelope rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }

    // Claim the now-hydrated content in the parent-owned ref AFTER dispatch.
    // This is what the parent's isExternalEdit check reads to decide whether
    // to remount on subsequent disk changes. Updating it AFTER dispatch (not
    // before) means the parent's effect, which runs after this child effect,
    // sees `lastAppliedRef.current === diskContent` and correctly decides
    // "not an external edit" on the initial hydration.
    lastAppliedRef.current = diskContent;
  }, [diskContent, dispatchEnvelope, lastAppliedRef]);

  // ── Persistence: memory → disk (debounced) ──────────────────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      const file = serializeProject(coreState, composition, currentTitleRef.current);
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
