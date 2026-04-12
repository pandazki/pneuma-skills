import { useEffect } from "react";
import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { parseProjectFile, projectFileToCommands } from "../../persistence.js";

/**
 * Hydrate the craft store from the current project.json file content.
 *
 * Re-runs whenever the content of project.json changes. This wipes the
 * in-memory undo stack (by dispatching a fresh sequence of commands on top
 * of a potentially non-empty core) — acceptable in Plan 2 because there are
 * no user-initiated dispatches yet, so the undo stack is always just prior
 * hydration events.
 *
 * TODO(plan-3): replace the full re-dispatch with a diff-and-dispatch
 * strategy that appends only the changes, preserving undo history across
 * external edits.
 */
export function useProjectHydration(files: ViewerFileContent[]): {
  error: string | null;
} {
  const dispatch = usePneumaCraftStore((s) => s.dispatch);

  // Find project.json by suffix match so subdirectory layouts still work.
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const projectContent = projectFile?.content ?? null;

  useEffect(() => {
    if (projectContent === null) return;

    const parsed = parseProjectFile(projectContent);
    if (!parsed.ok) {
      // Error surfaced via return value, not thrown — viewer renders a
      // readable error state instead of crashing the React tree.
      return;
    }

    const envelopes = projectFileToCommands(parsed.value);
    for (const env of envelopes) {
      try {
        dispatch(env.actor, env.command);
      } catch (e) {
        // Commands may reject (e.g. missing parent in provenance:link due
        // to the Plan 2 id-stability TODO). Plan 2: log and continue —
        // downstream state will be partial but the viewer still shows
        // "what worked" as a text dump.
        // eslint-disable-next-line no-console
        console.warn(
          "[clipcraft] hydration command rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }
  }, [projectContent, dispatch]);

  if (projectContent === null) {
    return { error: "project.json not found in workspace" };
  }
  const parsed = parseProjectFile(projectContent);
  return { error: parsed.ok ? null : parsed.error };
}
