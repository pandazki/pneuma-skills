import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  PneumaCraftProvider,
  usePneumaCraftStore,
  useEventLog,
  useDispatch,
  usePlayback,
} from "@pneuma-craft/react";
import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import {
  projectFileToCommands,
  serializeProject,
  type CaptionStyle,
  type ProjectFile,
} from "../persistence.js";
import {
  createWorkspaceAssetResolver,
  type WorkspaceAssetResolver,
} from "./assetResolver.js";
import { PreviewPanel } from "./PreviewPanel.js";
import { resolveCaptionStyle } from "./preview/captionStyle.js";
import { createSubtitleRenderer } from "./preview/subtitleRenderer.js";
import { CommandBar } from "./CommandBar.js";
import { ExportProgress } from "./export/ExportProgress.js";
import { useExportVideo } from "./export/useExportVideo.js";
import { GenerationDialogProvider } from "./generation/useGenerationDialog.js";
import { PendingGenerationsProvider } from "./generation/PendingGenerations.js";
import { SceneProvider, useScenes } from "./scenes/SceneContext.js";
import { TimelineModeProvider } from "./hooks/useTimelineMode.js";
import { TimelineZoomProvider } from "./hooks/useTimelineZoomShared.js";
import { AssetErrorsProvider } from "./assets/useAssetErrors.js";
import { VariantPointerProvider } from "./dive/useVariantPointer.js";
import { EditorToolProvider } from "./timeline/hooks/useEditorTool.js";
import { theme } from "./theme/tokens.js";

const AUTOSAVE_DELAY_MS = 500;

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({
  sources,
  commands,
  onNotifyAgent,
  navigateRequest,
  onNavigateComplete,
}) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);
  const projectSource = sources.project as Source<ProjectFile> | undefined;
  const { value: project, write: writeProject, status } = useSource(projectSource);

  // Stable-identity subtitle renderer: the PneumaCraftProvider captures it
  // once at mount (store-level), so live edits to captionStyle must flow
  // through a ref the renderer reads on every frame.
  const captionStyleRef = useRef<Required<CaptionStyle>>(resolveCaptionStyle(undefined));
  captionStyleRef.current = resolveCaptionStyle(project?.captionStyle);
  const subtitleRenderer = useMemo(
    () => createSubtitleRenderer(() => captionStyleRef.current),
    [],
  );

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
    <PneumaCraftProvider
      key={providerKey}
      assetResolver={assetResolver}
      subtitleRenderer={subtitleRenderer}
    >
      <AssetErrorsProvider>
        <VariantPointerProvider>
          <SceneProvider initialScenes={project?.scenes ?? []}>
            <TimelineModeProvider>
              <TimelineZoomProvider>
                <EditorToolProvider>
                  <PendingGenerationsProvider>
                    <GenerationDialogProvider onNotifyAgent={onNotifyAgent}>
                      <SyncedBody
                      project={project}
                      writeProject={writeProject}
                      currentTitleRef={currentTitleRef}
                      hydrationError={errorMessage}
                      commands={commands ?? []}
                      onNotifyAgent={onNotifyAgent}
                      assetResolver={assetResolver}
                      subtitleRenderer={subtitleRenderer}
                      navigateRequest={navigateRequest ?? null}
                      onNavigateComplete={onNavigateComplete}
                    />
                    </GenerationDialogProvider>
                  </PendingGenerationsProvider>
                </EditorToolProvider>
              </TimelineZoomProvider>
            </TimelineModeProvider>
          </SceneProvider>
        </VariantPointerProvider>
      </AssetErrorsProvider>
    </PneumaCraftProvider>
  );
};

function SyncedBody({
  project,
  writeProject,
  currentTitleRef,
  hydrationError,
  commands,
  onNotifyAgent,
  assetResolver,
  subtitleRenderer,
  navigateRequest,
  onNavigateComplete,
}: {
  project: ProjectFile | null;
  writeProject: (value: ProjectFile) => Promise<void>;
  currentTitleRef: React.MutableRefObject<string>;
  hydrationError: string | null;
  commands: import("../../../core/types/viewer-contract.js").ViewerCommandDescriptor[];
  onNotifyAgent?: (
    n: import("../../../core/types/viewer-contract.js").ViewerNotification,
  ) => void;
  assetResolver: WorkspaceAssetResolver;
  subtitleRenderer: import("@pneuma-craft/video").SubtitleRenderer;
  navigateRequest: import("../../../core/types/viewer-contract.js").ViewerLocator | null;
  onNavigateComplete?: () => void;
}) {
  const dispatchEnvelope = usePneumaCraftStore((s) => s.dispatchEnvelope);
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const composition = usePneumaCraftStore((s) => s.composition);
  const playback = usePlayback();
  const dispatch = useDispatch();
  const eventCount = useEventLog().length;
  const scenes = useScenes();
  const captionStyle = project?.captionStyle;

  // Browser-side export — runs the craft ExportEngine directly against
  // the live composition and the already-mounted AssetResolver. No agent
  // round-trip, no backend invocation. The hook manages its own state
  // (progress, download url, error) so the CommandBar button can remain
  // a thin dispatcher.
  const exportVideo = useExportVideo(composition, assetResolver, subtitleRenderer);
  const commandHandlers = useMemo(
    () => ({
      "export-video": () => {
        void exportVideo.start(currentTitleRef.current);
      },
    }),
    [exportVideo, currentTitleRef],
  );

  // ── Locator navigation ──────────────────────────────────────────────
  //
  // Agent-emitted <viewer-locator> cards arrive as `navigateRequest`.
  // Data shapes (documented in pneuma-mode.ts as locatorDescription):
  //   { clipId }   — select the clip + seek playhead to clip.startTime,
  //                  then scroll/flash the DOM element.
  //   { assetId }  — scroll/flash the asset tile or row.
  //   { time }     — seek only (no selection, no scroll).
  //   { trackId }  — scroll/flash the track label.
  //
  // DOM highlight uses the Web Animations API so no global CSS is needed;
  // the scroll happens via scrollIntoView on the element matching the
  // data attribute wired into AssetThumbnail / AssetListRow / VideoClip /
  // AudioClip / SubtitleClip / TrackLabel.
  const flashElement = useCallback((selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    el.animate(
      [
        { outline: "2px solid rgba(249, 115, 22, 0)", outlineOffset: "2px" },
        { outline: "2px solid rgba(249, 115, 22, 0.95)", outlineOffset: "2px" },
        { outline: "2px solid rgba(249, 115, 22, 0)", outlineOffset: "2px" },
      ],
      { duration: 1400, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, []);

  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;

    if (typeof data.clipId === "string") {
      const clipId = data.clipId;
      let clipStart: number | null = null;
      if (composition) {
        for (const track of composition.tracks) {
          const c = track.clips.find((c) => c.id === clipId);
          if (c) {
            clipStart = c.startTime;
            break;
          }
        }
      }
      dispatch("human", {
        type: "selection:set",
        selection: { type: "clip", ids: [clipId] },
      });
      if (clipStart !== null) playback.seek(clipStart);
      // Next frame so the selection has landed before we flash.
      requestAnimationFrame(() =>
        flashElement(`[data-clip-id="${CSS.escape(clipId)}"]`),
      );
    } else if (typeof data.assetId === "string") {
      const assetId = data.assetId;
      requestAnimationFrame(() =>
        flashElement(`[data-asset-id="${CSS.escape(assetId)}"]`),
      );
    } else if (typeof data.time === "number") {
      playback.seek(Math.max(0, data.time));
    } else if (typeof data.trackId === "string") {
      const trackId = data.trackId;
      requestAnimationFrame(() =>
        flashElement(`[data-track-id="${CSS.escape(trackId)}"]`),
      );
    }

    onNavigateComplete?.();
  }, [navigateRequest, composition, dispatch, playback, flashElement, onNavigateComplete]);

  // Initial frame paint: when the composition first hydrates, seek to
  // the earliest time that has actual visible video content so the
  // canvas shows a real frame instead of a black square (and so a
  // leading gap doesn't paint nothing). Upstream `store.seek()`
  // lazy-inits the engine (commit c18ab13 in pneuma-craft).
  // Fires once per composition identity — re-edits keep currentTime.
  //
  // Defer the seek to the next microtask and bail if the component
  // unmounted meanwhile. Otherwise the async engine init can race with
  // a provider remount (external edit triggers providerKey change) and
  // store.ts logs "Store destroyed".
  const initialPaintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!composition) return;
    const compId = composition.id;
    if (initialPaintRef.current === compId) return;
    initialPaintRef.current = compId;
    const videoClips = composition.tracks
      .filter((t) => t.type === "video")
      .flatMap((t) => t.clips);
    const firstVisible =
      videoClips.length > 0
        ? Math.min(...videoClips.map((c) => c.startTime))
        : 0;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      playback.seek(firstVisible);
    });
    return () => { cancelled = true; };
  }, [composition, playback]);

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.color.surface0,
      }}
    >
      <CommandBar
        commands={commands}
        onNotifyAgent={onNotifyAgent}
        handlers={commandHandlers}
      />
      <ExportProgress
        state={exportVideo.state}
        onAbort={exportVideo.abort}
        onDismiss={exportVideo.dismiss}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <PreviewPanel hydrationError={hydrationError} />
      </div>
    </div>
  );
}

export default ClipCraftPreview;
