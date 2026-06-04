// src/player/PlayerApp.tsx
//
// Root of the hosted, read-only player. This is "the same app in a different
// state": it mounts the exact mode viewers the live session uses (via the
// shared useViewerProps hook + the store), but with no Bun backend, no agent,
// and no live WebSocket. Content is a materialized play package fetched
// statically from R2; the viewer renders read-only and the conversation history
// is browsable on a timeline.

import { useEffect, useState, Suspense } from "react";
import { useStore } from "../store.js";
import { useViewerProps } from "../hooks/useViewerProps.js";
import { useSystemPreferences } from "../hooks/useSystemPreferences.js";
import { useAppTheme } from "../hooks/useAppTheme.js";
import { selectBestContentSet } from "../../core/utils/content-set-matcher.js";
import { loadMode } from "../../core/mode-loader.js";
import { resolveLocalized } from "../../core/types/mode-manifest.js";
import { fetchPlayIndex } from "../replay/provider.js";
import { loadStaticReplay } from "../replay-engine.js";
import { registerContentServiceWorker, notifyActiveContentSet } from "./content-sw-client.js";
import { ReplayPlayer } from "../components/ReplayPlayer.js";
import ChatPanel from "../components/ChatPanel.js";
import { ViewerErrorBoundary } from "../components/ViewerErrorBoundary.js";
import { LocalClientFallback } from "./LocalClientFallback.js";
import type { PlayPackageIndex } from "../../core/types/play-package.js";

/** Resolve the play package's base URL from `?pkg=` (explicit), or from the
 *  `/s/<id>` route combined with the build-time R2 base. */
function resolvePackageBase(): string {
  const params = new URLSearchParams(location.search);
  const pkg = params.get("pkg");
  if (pkg) return pkg.replace(/\/$/, "");
  const id = params.get("id") || location.pathname.match(/\/s\/([^/?#]+)/)?.[1];
  const r2 = (import.meta.env.VITE_PLAYER_PKG_BASE as string | undefined) || "";
  if (id && r2) return `${r2.replace(/\/$/, "")}/plays/${id}`;
  throw new Error("No play package specified (need ?pkg=<url> or /s/<id> with VITE_PLAYER_PKG_BASE).");
}

type Phase = "loading" | "ready" | "fallback" | "error";

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [index, setIndex] = useState<PlayPackageIndex | null>(null);
  const [error, setError] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(true);

  const { resolved: appTheme } = useAppTheme();
  const prefs = useSystemPreferences();
  const themeClass = appTheme === "light" ? "cc-theme-light" : "";

  const PreviewComponent = useStore((s) => s.modeViewer?.PreviewComponent);
  const modeDisplayName = useStore((s) => s.modeDisplayName);
  const viewerProps = useViewerProps({ theme: prefs.theme, locale: prefs.locale });

  // Bootstrap: load the package, then either mount the viewer or fall back.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = resolvePackageBase();
        const idx = await fetchPlayIndex(base);
        if (cancelled) return;
        setIndex(idx);

        if (!idx.supported) {
          setPhase("fallback");
          return;
        }

        const def = await loadMode(idx.mode);
        if (cancelled) return;
        const store = useStore.getState();
        store.setModeViewer(def.viewer);
        store.setModeManifest(def.manifest);
        store.setModeDisplayName(resolveLocalized(def.manifest.displayName, prefs.locale));
        store.setModeCommands(def.manifest.viewerApi?.commands ?? []);
        store.setEditing(false);
        if (def.manifest.layout) store.setLayout(def.manifest.layout);

        // Service worker must control the page before the first checkout so
        // /content/* asset fetches resolve from the package.
        await registerContentServiceWorker();
        await loadStaticReplay(base);
        if (!cancelled) setPhase("ready");
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Content-set auto-selection by system theme/locale (multi-variant decks).
  const contentSets = useStore((s) => s.contentSets);
  const activeContentSet = useStore((s) => s.activeContentSet);
  useEffect(() => {
    if (!prefs.ready || phase !== "ready") return;
    if (contentSets.length >= 1 && !activeContentSet) {
      const best = selectBestContentSet(contentSets, prefs);
      if (best) useStore.getState().setActiveContentSet(best.prefix);
    }
  }, [contentSets, prefs, phase]); // activeContentSet intentionally excluded

  // Keep the content service worker informed of the active content set so it can
  // resolve content-set-relative asset requests (illustrate, doc images).
  useEffect(() => {
    notifyActiveContentSet(activeContentSet);
  }, [activeContentSet]);

  if (phase === "loading") {
    return (
      <div className={`h-screen w-screen flex items-center justify-center bg-cc-bg text-cc-muted ${themeClass}`}>
        <div className="text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={`h-screen w-screen flex items-center justify-center bg-cc-bg text-cc-fg ${themeClass}`}>
        <div className="max-w-md text-center space-y-2 px-6">
          <div className="text-sm font-semibold">This shared link could not be loaded</div>
          <div className="text-xs text-cc-muted">{error}</div>
        </div>
      </div>
    );
  }

  if (phase === "fallback") {
    return (
      <div className={`h-screen w-screen bg-cc-bg text-cc-fg ${themeClass}`}>
        <LocalClientFallback index={index} />
      </div>
    );
  }

  const importUrl = index?.importUrl;

  return (
    <div className={`flex flex-col h-screen w-screen bg-cc-bg text-cc-fg relative overflow-hidden p-4 sm:p-6 md:p-8 ${themeClass}`}>
      {/* Ambient mesh + framed glassmorphism card — matches the live session shell
          so the player reads as "the same surface", just read-only. */}
      <div className="session-shell-mesh absolute top-[-10%] left-[-10%] w-[60%] h-[50%] bg-cc-primary/10 blur-[120px] rounded-full pointer-events-none animate-[pulse-dot_8s_ease-in-out_infinite]" />
      <div className="session-shell-mesh absolute top-[20%] right-[-10%] w-[50%] h-[60%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none animate-[pulse-dot_10s_ease-in-out_infinite_reverse]" />
      <div className="session-shell-card relative z-10 flex flex-col flex-1 min-h-0 border border-cc-primary/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)] ring-1 ring-white/5 before:absolute before:inset-0 before:bg-cc-surface/40 before:backdrop-blur-3xl before:-z-10">
      {/* Player chrome */}
      <header className="shrink-0 h-12 flex items-center gap-3 px-4 border-b border-cc-border bg-cc-surface/60 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-cc-fg truncate">
            {index?.manifest.metadata.title || modeDisplayName || "Pneuma"}
          </span>
          {modeDisplayName && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-cc-primary/15 text-cc-primary shrink-0">
              {modeDisplayName}
            </span>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="text-[11px] px-2.5 py-1 rounded-md border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-muted transition-colors cursor-pointer"
          title="Toggle conversation history"
        >
          {historyOpen ? "Hide history" : "Show history"}
        </button>
        {importUrl && (
          <a
            href={`pneuma://import/${encodeURIComponent(importUrl)}`}
            className="text-[11px] px-3 py-1 rounded-md bg-cc-primary text-white font-medium hover:brightness-110 transition-all cursor-pointer no-underline"
            title="Open this session in the Pneuma desktop app to continue editing"
          >
            Open in app
          </a>
        )}
      </header>

      {/* Body: viewer + collapsible history */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          {PreviewComponent ? (
            <ViewerErrorBoundary modeName={index?.mode}>
              <PreviewComponent {...viewerProps} editing={false} />
            </ViewerErrorBoundary>
          ) : (
            <div className="h-full flex items-center justify-center text-cc-muted text-sm">Loading viewer…</div>
          )}
        </div>
        {historyOpen && (
          <div className="w-[360px] shrink-0 border-l border-cc-border bg-cc-bg flex flex-col min-h-0">
            <Suspense fallback={null}>
              <ChatPanel />
            </Suspense>
          </div>
        )}
      </div>

      {/* Timeline */}
      <ReplayPlayer />
      </div>
    </div>
  );
}
