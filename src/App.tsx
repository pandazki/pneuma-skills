import { useEffect, useState, useRef, lazy, Suspense } from "react";
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
import { selectBestContentSet } from "../core/utils/content-set-matcher.js";
import { ReplayPlayer } from "./components/ReplayPlayer";
import type { ViewerPreviewProps } from "../core/types/viewer-contract.js";
import type { Source, FileChannel } from "../core/types/source.js";
import { SourceRegistry } from "../core/source-registry.js";
import { BUILT_IN_PROVIDERS } from "../core/sources/index.js";
import { BrowserFileChannel } from "./runtime/file-channel.js";
import { useThumbnailCapture } from "./hooks/useThumbnailCapture.js";
import { normalizeViewerState } from "./utils/viewer-state.js";

const EditorPanel = lazy(() => import("./components/EditorPanel.js"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel.js"));
const Launcher = lazy(() => import("./components/Launcher.js"));
const AgentBubble = lazy(() => import("./components/AgentBubble.js"));
const AppModeToggle = lazy(() => import("./components/AppModeToggle.js"));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full text-cc-muted text-sm">
      Loading...
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
    const effective = SourceRegistry.effectiveSources(manifest);
    const built = registry.instantiateAll(effective, ctx);
    setState({ sources: built, channel });
    return () => {
      registry.destroyAll(built);
      (channel as BrowserFileChannel).destroy();
    };
  }, [manifest]);

  return state;
}

/** Build the ViewerPreviewProps from store state. */
function useViewerProps(): ViewerPreviewProps {
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

  return {
    sources,
    fileChannel,
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
    actionRequest,
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
  };
}

export default function App() {
  // Launcher mode — lightweight marketplace UI
  const [isLauncher] = useState(() => {
    const params = new URLSearchParams(location.search);
    // Launcher if explicitly requested OR no session/mode params (bare URL)
    return params.has("launcher") || (!params.has("session") && !params.has("mode"));
  });
  if (isLauncher) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <Launcher />
      </Suspense>
    );
  }

  const PreviewComponent = useStore((s) => s.modeViewer?.PreviewComponent);
  const captureViewport = useStore((s) => s.modeViewer?.captureViewport);

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
      useStore.getState().setModeViewer(def.viewer);
      useStore.getState().setModeManifest(def.manifest);
      useStore.getState().setModeDisplayName(def.manifest.displayName);
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
        } else {
          // Normal mode — load workspace files from disk
          const d = await fetch(`${getApiBase()}/api/files`).then((r) => r.json());
          if (d.files?.length) useStore.getState().setFiles(d.files);
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

    // Connect to session (always — even in replay mode, for Continue Work transition)
    if (explicitSession) {
      connect(explicitSession);
    } else {
      fetch(`${getApiBase()}/api/session`)
        .then((r) => r.json())
        .then((d) => {
          connect(d.sessionId || "default");
        })
        .catch(() => connect("default"));
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

  // Content set auto-selection based on system preferences
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  const systemPrefs = useSystemPreferences();
  useEffect(() => {
    if (contentSets.length > 1 && !activeContentSet) {
      const best = selectBestContentSet(contentSets, systemPrefs);
      if (best) useStore.getState().setActiveContentSet(best.prefix);
    }
  }, [contentSets, systemPrefs]); // activeContentSet intentionally excluded

  const viewerProps = useViewerProps();
  const layout = useStore((s) => s.layout);
  const replayMode = useStore((s) => s.replayMode);
  const editing = useStore((s) => s.editing);

  // Thumbnail capture — snapshot the preview panel periodically
  const previewRef = useRef<HTMLDivElement>(null);
  const imageTick = useStore((s) => s.imageTick);
  const fileCount = useStore((s) => s.files.length);
  useThumbnailCapture(previewRef, !!PreviewComponent, imageTick + fileCount, captureViewport);

  // ── App layout (use mode only): Viewer fullscreen, no editor chrome ─────
  //    Edit mode falls through to the editor layout below for full editing experience.

  if (layout === "app" && !editing) {
    return (
      <div className="h-screen w-screen bg-cc-bg text-cc-fg relative overflow-hidden">
        <div ref={previewRef} className="h-full w-full">
          {PreviewComponent ? (
            <PreviewComponent
              {...viewerProps}
              editing={false}
            />
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
      </div>
    );
  }

  // ── Editor layout: split panel (2.x default) ──────────────────────────

  return (
    <div className="flex flex-col h-screen bg-cc-bg text-cc-fg relative overflow-hidden p-4 sm:p-6 md:p-8">
      {/* Immersive mesh gradient background element */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[50%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] right-[-10%] w-[50%] h-[60%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />

      <div className="relative z-10 flex flex-col flex-1 border border-cc-primary/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5 before:absolute before:inset-0 before:bg-cc-surface/40 before:backdrop-blur-3xl before:-z-10">
        <TopBar />
        <Group orientation="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={65} minSize={30}>
            <div ref={previewRef} className="h-full w-full">
              {PreviewComponent ? (
                <PreviewComponent {...viewerProps} />
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
    </div>
  );
}
