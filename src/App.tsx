import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { getApiBase } from "./utils/api.js";
import { Panel, Group, Separator } from "react-resizable-panels";
import TopBar from "./components/TopBar.js";
import ChatPanel from "./components/ChatPanel.js";
import DiffPanel from "./components/DiffPanel.js";
import ProcessPanel from "./components/ProcessPanel.js";
import ContextPanel from "./components/ContextPanel.js";
import SchedulePanel from "./components/SchedulePanel.js";

import { useStore, nextId } from "./store.js";
import type { SelectionType } from "./types.js";
import { connect } from "./ws.js";
import { loadReplay } from "./replay-engine.js";
import { loadMode, registerExternalMode } from "../core/mode-loader.js";
import { useSystemPreferences } from "./hooks/useSystemPreferences.js";
import { useAppTheme } from "./hooks/useAppTheme.js";
import { selectBestContentSet } from "../core/utils/content-set-matcher.js";
import { ReplayPlayer } from "./components/ReplayPlayer";
import type { ViewerPreviewProps } from "../core/types/viewer-contract.js";
import type { Source, FileChannel } from "../core/types/source.js";
import { SourceRegistry } from "../core/source-registry.js";
import { BUILT_IN_PROVIDERS } from "../core/sources/index.js";
import { BrowserFileChannel } from "./runtime/file-channel.js";
import { useThumbnailCapture } from "./hooks/useThumbnailCapture.js";
import { useCaptureAction } from "./hooks/useCaptureAction.js";
import { useBackgroundStatusReporter } from "./hooks/useBackgroundStatusReporter.js";
import { normalizeViewerState } from "./utils/viewer-state.js";
import { ViewerErrorBoundary } from "./components/ViewerErrorBoundary.js";

const EditorPanel = lazy(() => import("./components/EditorPanel.js"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel.js"));
const Launcher = lazy(() => import("./components/Launcher.js"));
const AgentBubble = lazy(() => import("./components/AgentBubble.js"));
const AppModeToggle = lazy(() => import("./components/AppModeToggle.js"));
const HandoffCard = lazy(() => import("./components/HandoffCard.js"));
const EmptyShell = lazy(() =>
  import("./components/EmptyShell.js").then((m) => ({ default: m.EmptyShell })),
);
const GalleryEmptyState = lazy(() =>
  import("./components/GalleryEmptyState.js").then((m) => ({ default: m.GalleryEmptyState })),
);
const NoSeedOnboardOverlay = lazy(() =>
  import("./components/NoSeedOnboardOverlay.js").then((m) => ({ default: m.NoSeedOnboardOverlay })),
);

function LazyFallback() {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-center justify-center h-full text-cc-muted text-sm">
      {t("loading")}
    </div>
  );
}

function RightPanel() {
  const activeTab = useStore((s) => s.activeTab);
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (activeTab === "terminal") setTerminalMounted(true);
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      {activeTab === "chat" && <ChatPanel />}
      {activeTab === "editor" && (
        <Suspense fallback={<LazyFallback />}>
          <EditorPanel />
        </Suspense>
      )}
      {activeTab === "diff" && <DiffPanel />}
      {/* Terminal stays mounted once visited to preserve PTY connection */}
      {terminalMounted && (
        <Suspense fallback={activeTab === "terminal" ? <LazyFallback /> : null}>
          <div className={activeTab === "terminal" ? "flex flex-col h-full" : "hidden"}>
            <TerminalPanel />
          </div>
        </Suspense>
      )}
      {activeTab === "processes" && <ProcessPanel />}
      {activeTab === "context" && <ContextPanel />}
      {activeTab === "schedules" && <SchedulePanel />}
    </div>
  );
}

/**
 * Instantiate sources AND the FileChannel for the current mode. Returns
 * both as a single object so useViewerProps can pass each through to the
 * viewer as separate props. Rebuilds (destroying the old set) whenever
 * the active mode changes.
 *
 * This is the lifecycle boundary for sources. When a user switches modes
 * in the launcher, the old mode's sources are destroyed here and the new
 * mode's sources are created against a fresh FileChannel + SourceRegistry.
 * Sources and the FileChannel never outlive their mode.
 */
function useSourceInstances(): {
  sources: Record<string, Source<unknown>>;
  channel: FileChannel;
} {
  const manifest = useStore((s) => s.modeManifest);
  const [state, setState] = useState<{
    sources: Record<string, Source<unknown>>;
    channel: FileChannel;
  }>(() => ({ sources: {}, channel: new BrowserFileChannel() }));

  useEffect(() => {
    if (!manifest) {
      setState({ sources: {}, channel: new BrowserFileChannel() });
      return;
    }
    const channel = new BrowserFileChannel();
    const registry = new SourceRegistry();
    for (const provider of BUILT_IN_PROVIDERS) registry.register(provider);
    // Plugin-contributed providers live server-side (see PluginRegistry.collectSourceProviders).
    // They are not currently wired into the browser-side SourceRegistry because plugin
    // providers contain .create() functions that can't be serialized over WS. When the
    // first browser-capable plugin provider exists, it will need either (a) a bridge
    // that proxies provider.create() calls over WS, or (b) a browser-loaded plugin
    // runtime. Until then, only built-in providers are available in the browser.
    const ctx = {
      workspace: "", // workspace is known to the server; providers
                     // that need it get it via FileChannel instead
      log: (msg: string) => {
        console.debug("[source]", msg);
      },
      signal: new AbortController().signal,
      files: channel,
    };
    // Pre-2.29 manifests throw from effectiveSources(). Don't let that
    // bubble — degrade to empty sources so the viewer still mounts (and
    // ViewerErrorBoundary downstream can show a friendly message instead
    // of an uncaught React error landing in the user's console).
    let built: Record<string, Source<unknown>> = {};
    try {
      const effective = SourceRegistry.effectiveSources(manifest);
      built = registry.instantiateAll(effective, ctx);
    } catch (err) {
      console.warn(
        `[source-registry] Mode "${manifest.name}" sources unavailable — viewer will render with no sources. Cause:`,
        err,
      );
    }
    setState({ sources: built, channel });
    return () => {
      registry.destroyAll(built);
      (channel as BrowserFileChannel).destroy();
    };
  }, [manifest]);

  return state;
}

/** Build the ViewerPreviewProps from store state.
 *
 * Caller passes `prefs` (the same `useSystemPreferences()` value the
 * session shell already reads for content-set auto-selection) so we don't
 * mount a second `/api/user-locale + /api/user-theme` fetch. */
function useViewerProps(prefs: { theme: "light" | "dark"; locale: string }): ViewerPreviewProps {
  const { sources, channel: fileChannel } = useSourceInstances();
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const previewMode = useStore((s) => s.previewMode);
  const imageTick = useStore((s) => s.imageTick);
  const initParams = useStore((s) => s.initParams);
  const activeFile = useStore((s) => s.activeFile);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setViewportRange = useStore((s) => s.setViewportRange);
  const workspaceItems = useStore((s) => s.workspaceItems);
  const actionRequest = useStore((s) => s.actionRequest);
  const setActionRequest = useStore((s) => s.setActionRequest);
  const navigateRequest = useStore((s) => s.navigateRequest);
  const setNavigateRequest = useStore((s) => s.setNavigateRequest);
  const contentSets = useStore((s) => s.contentSets);
  const replayMode = useStore((s) => s.replayMode);
  // Backward-compat snapshot for pre-2.29 viewers (e.g. external modes
  // that still read `props.files.find(...)`). New viewers consume
  // `sources` instead — see ViewerPreviewProps docstring.
  const filesCompat = useStore((s) => s.files);

  return {
    sources,
    fileChannel,
    files: filesCompat,
    activeFile,
    selection: selection
      ? {
        type: selection.type,
        content: selection.content,
        level: selection.level,
        file: selection.file,
        tag: selection.tag,
        classes: selection.classes,
        selector: selection.selector,
        thumbnail: selection.thumbnail,
        label: selection.label,
        nearbyText: selection.nearbyText,
        accessibility: selection.accessibility,
      }
      : null,
    onSelect: (sel) => {
      if (!sel) {
        setSelection(null);
        return;
      }
      // Use file from the viewer component (e.g. current slide).
      // Viewers that care about file attribution always populate sel.file.
      const file = sel.file || "";
      setSelection({
        type: sel.type as SelectionType,
        content: sel.content,
        level: sel.level,
        file,
        tag: sel.tag,
        classes: sel.classes,
        selector: sel.selector,
        address: sel.address,
        thumbnail: sel.thumbnail,
        label: sel.label,
        nearbyText: sel.nearbyText,
        accessibility: sel.accessibility,
      });
    },
    mode: previewMode,
    imageVersion: imageTick,
    initParams,
    onActiveFileChange: setActiveFile,
    onViewportChange: setViewportRange,
    workspaceItems,
    // `capture` is a framework-level action handled by useCaptureAction —
    // mask it from the mode viewer so the two don't both answer the request.
    actionRequest: actionRequest?.actionId === "capture" ? null : actionRequest,
    onActionResult: (requestId, result) => {
      import("./ws.js").then(({ sendViewerActionResponse }) => {
        sendViewerActionResponse(requestId, result);
      });
      setActionRequest(null);
    },
    onNotifyAgent: (notification) => {
      // Unified queue — if agent is idle, send immediately; otherwise queue for flush on idle
      useStore.getState().addPendingNotification(notification);
    },
    navigateRequest,
    onNavigateComplete: () => setNavigateRequest(null),
    commands: useStore((s) => s.modeCommands),
    readonly: replayMode,
    theme: prefs.theme,
    locale: prefs.locale,
  };
}

export default function App() {
  // Launcher mode — lightweight marketplace UI
  const [isLauncher] = useState(() => {
    const params = new URLSearchParams(location.search);
    // Launcher if explicitly requested OR no session/mode params (bare URL)
    return params.has("launcher") || (!params.has("session") && !params.has("mode"));
  });
  const [projectParam] = useState(() => new URLSearchParams(location.search).get("project"));
  // Empty shell — `?project=<root>` with no session/mode. Renders the editor
  // chrome + TopBar without spawning an agent. ProjectChip (Phase 2) will
  // mount inside the surviving TopBar to expose the project's sessions.
  // Tied directly to URL params (not `isLauncher`) so a manual `?launcher=1`
  // can't drag a project session URL into empty shell.
  const [isEmptyShell] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.has("project") && !params.has("session") && !params.has("mode");
  });

  // Background mode — relay turn status to Electron main (no-ops on web).
  // Placed before the early returns below so its hook order stays stable
  // across launcher / empty-shell / session renders.
  useBackgroundStatusReporter();

  if (isEmptyShell && projectParam) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <EmptyShell projectRoot={projectParam} />
      </Suspense>
    );
  }
  if (isLauncher) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <Launcher />
      </Suspense>
    );
  }

  const PreviewComponent = useStore((s) => s.modeViewer?.PreviewComponent);
  const captureViewport = useStore((s) => s.modeViewer?.captureViewport);

  // Flipped to true once the initial `/api/files` request resolves (success
  // OR empty). Gates the gallery's empty-state render so old sessions
  // resuming with content don't flash gallery during the brief window
  // between `setModeViewer` and `setFiles`.
  const [filesFetched, setFilesFetched] = useState(false);
  // User-driven dismissal of the gallery / no-seed overlay. Persists for
  // the lifetime of the session. Auto-dismiss-on-content-production is
  // still handled by `userContentCount` / `hasSeedsDeclared`; this lets
  // the user close the gallery explicitly even before content arrives.
  const [galleryDismissedByUser, setGalleryDismissedByUser] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const explicitSession = params.get("session");
    const modeName = params.get("mode") || "doc";
    if (params.get("debug") === "1") {
      useStore.getState().setDebugMode(true);
    }

    // Check if this is an external mode — fetch mode info from server first
    const loadModeAsync = async () => {
      try {
        const modeInfoRes = await fetch(`${getApiBase()}/api/mode-info`);
        const modeInfo = await modeInfoRes.json();

        if (modeInfo.external && modeInfo.name === modeName) {
          // Register external mode so mode-loader knows where to import from
          registerExternalMode(modeInfo.name, modeInfo.path);
          console.log(`[app] Registered external mode "${modeInfo.name}" from ${modeInfo.path}`);
        }
      } catch {
        // Server not available yet or no external mode — continue with builtin
      }

      const def = await loadMode(modeName);
      const { resolveLocalized } = await import("../core/types/mode-manifest.js");
      const lang = (await import("./i18n/index.js")).currentLocale();
      useStore.getState().setModeViewer(def.viewer);
      useStore.getState().setModeManifest(def.manifest);
      useStore.getState().setModeDisplayName(resolveLocalized(def.manifest.displayName, lang));
      useStore.getState().setModeCommands(def.manifest.viewerApi?.commands ?? []);
    };

    // Load mode viewer first, then files + viewer state restore
    // (viewer must be loaded before setFiles so resolveContentSets is available)
    const replayPath = params.get("replay");

    loadModeAsync()
      .then(async () => {
        if (replayPath) {
          // Replay mode — skip disk files, let loadReplay control the viewer
          console.log("[app] Auto-loading replay from:", replayPath);
          await loadReplay(replayPath).catch((err) =>
            console.error("[app] Failed to load replay:", err)
          );
          setFilesFetched(true);
        } else {
          // Normal mode — load workspace files from disk
          const d = await fetch(`${getApiBase()}/api/files`).then((r) => r.json());
          if (d.files?.length) useStore.getState().setFiles(d.files);
          setFilesFetched(true);
          // Restore persisted viewer position (content set + active file)
          try {
            const vs = await fetch(`${getApiBase()}/api/viewer-state`).then((r) => r.json());
            const store = useStore.getState();
            const normalized = normalizeViewerState(vs, store.contentSets);
            if (normalized.contentSet && store.contentSets.some((cs: { prefix: string }) => cs.prefix === normalized.contentSet)) {
              store.setActiveContentSet(normalized.contentSet);
            }
            if (normalized.file) {
              const items = useStore.getState().workspaceItems;
              if (items.some((item: { path: string }) => item.path === normalized.file)) {
                useStore.getState().setActiveFile(normalized.file);
              }
            }
          } catch { /* no saved state — auto-selection will handle it */ }
        }
      })
      .catch((err) => {
        console.error(`[app] Failed to load mode "${modeName}":`, err);
      });

    // Connect to session (always — even in replay mode, for Continue Work transition).
    // Also fetch /api/session to discover project paths (Pneuma 3.0) so the
    // store knows whether this session belongs to a project surface.
    fetch(`${getApiBase()}/api/session`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.project?.projectRoot) {
          useStore.getState().setProjectContext({
            projectRoot: d.project.projectRoot,
            homeRoot: d.project.homeRoot,
            sessionDir: d.project.sessionDir,
            projectName: d.project.projectName,
            projectDescription: d.project.projectDescription,
          });
        }
        // The per-session working dir — equals the project session dir for
        // project sessions, the quick-session workspace otherwise. The Editor
        // tabbar's "open in IDE" affordance reads this so it always lands on
        // the agent's actual surface, not the shared project root.
        if (typeof d?.workspace === "string") {
          useStore.getState().setSessionWorkspace(d.workspace);
        }
        if (!explicitSession) {
          connect(d?.sessionId || "default");
        }
      })
      .catch(() => {
        if (!explicitSession) connect("default");
      });
    if (explicitSession) {
      connect(explicitSession);
    }

    // Fetch mode init params
    fetch(`${getApiBase()}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.initParams) useStore.getState().setInitParams(d.initParams);
        if (d.layout) useStore.getState().setLayout(d.layout);
        if (d.editing !== undefined) useStore.getState().setEditing(d.editing);
        if (d.editingSupported) useStore.getState().setEditingSupported(d.editingSupported);
      })
      .catch(() => { });

    // Check git availability
    fetch(`${getApiBase()}/api/git/available`)
      .then((r) => r.json())
      .then((d) => useStore.getState().setGitAvailable(d.available))
      .catch(() => useStore.getState().setGitAvailable(false));
  }, []);

  // Pending queue flush is handled by store subscriber in store/index.ts (tryFlushPendingQueue)

  // Workspace item auto-selection (topBarNavigation modes)
  const topBarNav = useStore((s) => s.modeViewer?.workspace?.topBarNavigation);
  const workspaceItemsForAutoSelect = useStore((s) => s.workspaceItems);
  const activeFileForAutoSelect = useStore((s) => s.activeFile);
  useEffect(() => {
    if (topBarNav && workspaceItemsForAutoSelect.length > 0 && !activeFileForAutoSelect) {
      useStore.getState().setActiveFile(workspaceItemsForAutoSelect[0].path);
    }
  }, [topBarNav, workspaceItemsForAutoSelect, activeFileForAutoSelect]);

  // Content set auto-selection based on system preferences. We wait for
  // `systemPrefs.ready` so the Pneuma-saved locale/theme overrides land
  // before the picker runs — otherwise the synchronous browser defaults
  // grab the slot, `activeContentSet` becomes truthy, and the
  // `!activeContentSet` guard locks us out of revising once the overrides
  // arrive.
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const systemPrefs = useSystemPreferences();
  useEffect(() => {
    if (!systemPrefs.ready) return;
    // Auto-select fires whenever there is at least one content set and
    // nothing is active. The legacy gate (`> 1`) covered the
    // multi-variant case (e.g. slide's en-dark vs zh-light) but left
    // single-variant trait-bearing states orphaned — which now happens
    // routinely after the gallery copies just one seed into the
    // workspace. `selectBestContentSet` already returns the lone set
    // unchanged when there is only one, so widening the gate is safe.
    if (contentSets.length >= 1 && !activeContentSet) {
      const best = selectBestContentSet(contentSets, systemPrefs);
      if (best) useStore.getState().setActiveContentSet(best.prefix);
    }
  }, [contentSets, systemPrefs]); // activeContentSet intentionally excluded

  const viewerProps = useViewerProps(systemPrefs);
  const layout = useStore((s) => s.layout);
  const replayMode = useStore((s) => s.replayMode);
  const editing = useStore((s) => s.editing);

  // Gallery decision — show the seed-gallery empty state when the
  // workspace has no agent-authored content and the mode ships seeds.
  // The condition is runtime-observed so old sessions with existing
  // content skip gallery automatically. Suppressed in replay (read-only
  // historical view) and in non-editing sessions (viewing-only modes
  // don't author seeds either).
  //
  // The store's `files` includes framework-owned state files surfaced by
  // the file watcher (`.pneuma/session.json`, `.pneuma/history.json`,
  // the installed skill under `.claude/`) — those are *not* user
  // content and must be filtered out before the empty check. Filtering
  // here, not in the watcher, because other call sites (e.g. share
  // export) want those files included.
  const filesForGallery = useStore((s) => s.files);
  const userContentCount = filesForGallery.filter((f) => {
    const p = f.path;
    if (p === "CLAUDE.md" || p === "AGENTS.md") return false;
    if (p.startsWith(".pneuma/") || p.startsWith(".claude/") || p.startsWith(".agents/")) return false;
    if (p.startsWith(".kimi/")) return false;
    if (p === ".gitignore") return false;
    // `_`-prefixed top-level dirs are framework-managed seeds (e.g. kami's
    // `_shared/` design-system bundle resynced on every boot). They are
    // not user content — they live in the workspace but the gallery still
    // counts as "empty" if those are the only files present.
    if (p.startsWith("_")) return false;
    return true;
  }).length;
  const modeManifestForGallery = useStore((s) => s.modeManifest);
  // Must mirror `resolveSeedCatalog` on the server (seed-installer.ts):
  // a mode "has seeds" iff either init.seeds is non-empty, OR the
  // auto-derive rule finds at least one non-`_`-prefixed, directory-
  // shaped entry. Single-file seedFiles entries are framework setup,
  // not user-pickable templates, and don't qualify for the gallery.
  const hasSeedsDeclared = (() => {
    const init = modeManifestForGallery?.init;
    if (!init?.seedFiles) return false;
    if (init.seeds && init.seeds.length > 0) {
      // Trust the manifest author — declared seeds always count, even
      // single-file ones (e.g. doc/README.md). The server filters
      // dropped sourceKeys; here we just need to know the intent.
      return init.seeds.some((s) => {
        const keys = Array.isArray(s.sourceKey) ? s.sourceKey : [s.sourceKey];
        return keys.every((k) => k in init.seedFiles!);
      });
    }
    return Object.entries(init.seedFiles).some(([src, dst]) => {
      if (dst.startsWith("_")) return false;
      return src.endsWith("/") || dst.endsWith("/") || dst === "./" || dst === "";
    });
  })();
  const isEmptyWorkspace =
    !replayMode
    && editing !== false
    && filesFetched
    && userContentCount === 0;
  const showGallery = isEmptyWorkspace && hasSeedsDeclared && !galleryDismissedByUser;
  // Modes with no seeds keep the viewer mounted as the action surface
  // (invoice-organization, dashboards, anything whose UI *is* the
  // entry point) and float a dismissable intro sidebar on top.
  // Replacing the viewer outright hides the workspace the user is
  // supposed to interact with.
  const showNoSeedOverlay = isEmptyWorkspace && !hasSeedsDeclared;
  // Until /api/files has resolved we don't know whether the workspace
  // is empty. Showing the bare viewer in that window causes pre-2.29
  // external modes to crash on `props.files.find(...)` (files is
  // undefined under the new contract). Hold the preview behind a loading
  // state so the empty/gallery branches get a chance to take over.
  const previewWaitingForFiles =
    !replayMode && editing !== false && !filesFetched && !!PreviewComponent;
  // Session shell theming — the launcher's choice (saved in
  // ~/.pneuma/settings.json) propagates here via `pneuma:theme-changed`.
  // The session root flips `.cc-theme-light` to swap the cc-* token surface.
  const { resolved: appTheme } = useAppTheme();
  const themeClass = appTheme === "light" ? "cc-theme-light" : "";

  // Thumbnail capture — snapshot the preview panel periodically
  const previewRef = useRef<HTMLDivElement>(null);
  const imageTick = useStore((s) => s.imageTick);
  const fileCount = useStore((s) => s.files.length);
  useThumbnailCapture(previewRef, !!PreviewComponent, imageTick + fileCount, captureViewport);

  // Framework-level `capture` viewer action — screenshots the live viewer to
  // a PNG the agent can Read, so it can self-QA without an external browser.
  useCaptureAction(previewRef, captureViewport);

  // ── App layout (use mode only): Viewer fullscreen, no editor chrome ─────
  //    Edit mode falls through to the editor layout below for full editing experience.

  const modeNameForError = modeManifestForGallery?.name;

  if (layout === "app" && !editing) {
    return (
      <div className={`h-screen w-screen bg-cc-bg text-cc-fg relative overflow-hidden ${themeClass}`}>
        <div ref={previewRef} className="h-full w-full relative">
          {showGallery ? (
            <Suspense fallback={<LazyFallback />}>
              <GalleryEmptyState onDismiss={() => setGalleryDismissedByUser(true)} />
            </Suspense>
          ) : previewWaitingForFiles ? (
            <LazyFallback />
          ) : PreviewComponent ? (
            <>
              <ViewerErrorBoundary modeName={modeNameForError}>
                <PreviewComponent
                  {...viewerProps}
                  editing={false}
                />
              </ViewerErrorBoundary>
              {showNoSeedOverlay && (
                <Suspense fallback={null}>
                  <NoSeedOnboardOverlay />
                </Suspense>
              )}
            </>
          ) : (
            <LazyFallback />
          )}
        </div>
        {replayMode ? (
          <ReplayPlayer />
        ) : (
          <Suspense fallback={null}>
            <AppModeToggle />
          </Suspense>
        )}
        <Suspense fallback={null}>
          <HandoffCard />
        </Suspense>
      </div>
    );
  }

  // ── Editor layout: split panel (2.x default) ──────────────────────────

  return (
    <div className={`flex flex-col h-screen bg-cc-bg text-cc-fg relative overflow-hidden p-4 sm:p-6 md:p-8 ${themeClass}`}>
      {/* Immersive mesh gradient — dark-mode atmospherics; hidden in light. */}
      <div className="session-shell-mesh absolute top-[-10%] left-[-10%] w-[60%] h-[50%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="session-shell-mesh absolute top-[20%] right-[-10%] w-[50%] h-[60%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />

      <div className="session-shell-card relative z-10 flex flex-col flex-1 border border-cc-primary/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5 before:absolute before:inset-0 before:bg-cc-surface/40 before:backdrop-blur-3xl before:-z-10">
        <TopBar />
        <Group orientation="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={65} minSize={30}>
            <div ref={previewRef} className="h-full w-full relative">
              {showGallery ? (
                <Suspense fallback={<LazyFallback />}>
                  <GalleryEmptyState onDismiss={() => setGalleryDismissedByUser(true)} />
                </Suspense>
              ) : previewWaitingForFiles ? (
                <LazyFallback />
              ) : PreviewComponent ? (
                <>
                  <ViewerErrorBoundary modeName={modeNameForError}>
                    <PreviewComponent {...viewerProps} />
                  </ViewerErrorBoundary>
                  {showNoSeedOverlay && (
                    <Suspense fallback={null}>
                      <NoSeedOnboardOverlay />
                    </Suspense>
                  )}
                </>
              ) : (
                <LazyFallback />
              )}
            </div>
          </Panel>
          <Separator className="w-[1px] bg-cc-border/40 hover:w-1 hover:bg-cc-primary/40 transition-all duration-300 cursor-col-resize z-10" />
          <Panel defaultSize={35} minSize={20}>
            <RightPanel />
          </Panel>
        </Group>
        {replayMode && <ReplayPlayer />}
      </div>
      <Suspense fallback={null}>
        <HandoffCard />
      </Suspense>
    </div>
  );
}
