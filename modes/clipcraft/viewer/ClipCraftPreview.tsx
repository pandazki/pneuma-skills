import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  PneumaCraftProvider,
  usePneumaCraftStore,
  useEventLog,
} from "@pneuma-craft/react";
import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import {
  projectFileToCommands,
  serializeProject,
  type ProjectFile,
} from "../persistence.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { PreviewPanel } from "./PreviewPanel.js";
import { SceneProvider, useScenes } from "./scenes/SceneContext.js";
import { TimelineModeProvider } from "./hooks/useTimelineMode.js";
import { TimelineZoomProvider } from "./hooks/useTimelineZoomShared.js";

const AUTOSAVE_DELAY_MS = 500;

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ sources }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);
  const projectSource = sources.project as Source<ProjectFile> | undefined;
  const { value: project, write: writeProject, status } = useSource(projectSource);

  // Keep the resolver's id → uri map in sync with the project's assets.
  // `assetResolver` identity is stable across setAssets calls, so updating
  // it in place does not violate PneumaCraftProvider's "stable resolver"
  // contract.
  useEffect(() => {
    if (!project) return;
    assetResolver.setAssets(project.assets);
  }, [project, assetResolver]);

  // Bumped when an external edit lands on a live store. Remounting the
  // PneumaCraftProvider gives us a fresh craft store, and the inline
  // hydration effect inside SyncedBody re-plays the new project against
  // the fresh store via the "initial" branch (because hasEmittedInitial
  // is reset together with the store).
  const [providerKey, setProviderKey] = useState(0);

  // Title side-channel — craft has no project-level title concept, so the
  // viewer carries it across hydrate/serialize. Lives at the parent so it
  // survives provider remounts.
  const currentTitleRef = useRef<string>("Untitled");

  // Subscribe directly to the source so every external event bumps the
  // provider key exactly once. A useEffect keyed on status.lastOrigin
  // would miss back-to-back externals (same string ⇒ no re-run).
  useEffect(() => {
    if (!projectSource) return;
    const off = projectSource.subscribe((ev) => {
      if (ev.kind === "value" && ev.origin === "external") {
        setProviderKey((k) => k + 1);
      }
    });
    return off;
  }, [projectSource]);

  const errorMessage = status.lastError?.message ?? null;

  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
      <SceneProvider initialScenes={project?.scenes ?? []}>
        <TimelineModeProvider>
          <TimelineZoomProvider>
            <SyncedBody
              project={project}
              writeProject={writeProject}
              currentTitleRef={currentTitleRef}
              hydrationError={errorMessage}
            />
          </TimelineZoomProvider>
        </TimelineModeProvider>
      </SceneProvider>
    </PneumaCraftProvider>
  );
};

function SyncedBody({
  project,
  writeProject,
  currentTitleRef,
  hydrationError,
}: {
  project: ProjectFile | null;
  writeProject: (value: ProjectFile) => Promise<void>;
  currentTitleRef: React.MutableRefObject<string>;
  hydrationError: string | null;
}) {
  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const eventCount = useEventLog().length;
  const scenes = useScenes();
  const captionStyle = project?.captionStyle;

  // ── Hydration: dispatch project into the (fresh) craft store ─────────
  //
  // Runs once per mount. Because the parent remounts via providerKey on
  // every external edit, this effect is guaranteed to see a fresh store
  // — there are no duplicate-id collisions to worry about.
  //
  // Self-origin events are our own autosave coming back through the
  // source. The craft store already reflects them (we dispatched the
  // envelopes BEFORE calling writeProject), so we explicitly skip
  // re-hydrating on self.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (!project) return;
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    currentTitleRef.current = project.title;
    for (const env of projectFileToCommands(project)) {
      try {
        dispatchEnvelope(env);
      } catch (e) {
        console.warn(
          "[clipcraft] hydration envelope rejected",
          env.command.type,
          (e as Error).message,
        );
      }
    }
  }, [project, dispatchEnvelope, currentTitleRef]);

  // ── Autosave: debounced source.write ─────────────────────────────────
  //
  // No echo bookkeeping. source.write() is atomic and the self event
  // comes back through the source with origin === "self", which the
  // parent's useEffect ignores (only "external" triggers remount).
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const timer = setTimeout(async () => {
      const file = serializeProject(
        coreState,
        composition,
        currentTitleRef.current,
        scenes,
        captionStyle,
      );
      try {
        await writeProject(file);
      } catch (err) {
        console.error("[clipcraft] autosave failed", err);
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eventCount, writeProject, scenes, captionStyle]);

  return <PreviewPanel hydrationError={hydrationError} />;
}

export default ClipCraftPreview;
