/**
 * RemotionPreview — Main viewer component for Remotion mode.
 *
 * Renders user compositions via @remotion/player with custom playback controls.
 * Uses JIT compilation (Babel) to compile user TSX in real-time.
 */

import { useCallback, useEffect, useRef, useState, type ErrorInfo, Component, type ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type {
  ViewerPreviewProps,
  ViewerActionRequest,
  ViewerActionResult,
  ViewerNotification,
  ViewerFileContent,
} from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useRemotionCompiler } from "./use-remotion-compiler.js";
import { getApiBase } from "../../../src/utils/api.js";
import RemotionControls from "./RemotionControls.js";

// ── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class PlayerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Reset error when children change (new compilation)
    if (prevProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full p-8 text-center"
          style={{ color: "var(--cc-text-secondary)" }}>
          <div>
            <div className="text-red-400 text-sm font-medium mb-2">Runtime Error</div>
            <pre className="text-xs text-left max-w-lg overflow-auto p-3 rounded"
              style={{ background: "var(--cc-bg-tertiary)" }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Player Canvas (aspect-ratio-preserving scale) ────────────────────────────

/** Scales the Player to fit the container while preserving aspect ratio (CSS transform). */
function PlayerCanvas({
  comp,
  ActiveComponent,
  playerRef,
  playbackRate,
  loop,
  inFrame,
  outFrame,
  onRuntimeError,
}: {
  comp: { width: number; height: number; durationInFrames: number; fps: number; id: string };
  ActiveComponent: React.ComponentType<Record<string, unknown>>;
  playerRef: React.RefObject<PlayerRef | null>;
  playbackRate: number;
  loop: boolean;
  inFrame: number | null;
  outFrame: number | null;
  onRuntimeError: (error: Error) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect;
      if (cw > 0 && ch > 0) {
        setScale(Math.min(cw / comp.width, ch / comp.height));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [comp.width, comp.height]);

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden min-h-0"
      style={{ background: "#000" }}>
      <div style={{
        width: comp.width,
        height: comp.height,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}>
        <PlayerErrorBoundary onError={onRuntimeError}>
          <Player
            ref={playerRef}
            component={ActiveComponent}
            compositionWidth={comp.width}
            compositionHeight={comp.height}
            durationInFrames={comp.durationInFrames}
            fps={comp.fps}
            playbackRate={playbackRate}
            loop={loop}
            inFrame={inFrame ?? undefined}
            outFrame={outFrame !== null ? Math.min(outFrame, comp.durationInFrames - 1) : undefined}
            controls={false}
            acknowledgeRemotionLicense
            style={{ width: comp.width, height: comp.height }}
          />
        </PlayerErrorBoundary>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function RemotionPreview({
  sources,
  activeFile,
  onActiveFileChange,
  onViewportChange,
  actionRequest,
  onActionResult,
  onNotifyAgent,
  navigateRequest,
  onNavigateComplete,
  readonly,
}: ViewerPreviewProps) {
  const filesSource = sources.files as Source<ViewerFileContent[]>;
  const { value: filesValue } = useSource(filesSource);
  const files: ViewerFileContent[] = filesValue ?? [];

  // Readonly mode: suppress agent notifications (replay / view-only)
  const effectiveOnNotifyAgent = readonly ? undefined : onNotifyAgent;

  const playerRef = useRef<PlayerRef | null>(null);
  const { compositions, components, errors } = useRemotionCompiler(files);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [inFrame, setInFrame] = useState<number | null>(null);
  const [outFrame, setOutFrame] = useState<number | null>(null);

  // Active composition driven by framework's activeFile (composition ID from TopBar)
  const activeComp = compositions.find((c) => c.id === activeFile) || compositions[0];
  const ActiveComponent = activeComp ? components.get(activeComp.componentName) : null;

  // Report active composition back to framework
  useEffect(() => {
    if (activeComp && activeComp.id !== activeFile) {
      onActiveFileChange?.(activeComp.id);
    }
  }, [activeComp?.id]);

  // Reset playback state when composition changes
  const prevCompIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeComp) return;
    if (prevCompIdRef.current && prevCompIdRef.current !== activeComp.id) {
      // Composition changed — pause, seek to 0, clear range
      const player = playerRef.current;
      if (player) {
        player.pause();
        player.seekTo(0);
      }
      setFrame(0);
      setPlaying(false);
      setInFrame(null);
      setOutFrame(null);
      setLoop(false);
    }
    prevCompIdRef.current = activeComp.id;
  }, [activeComp?.id]);

  // ── Report playback state silently via viewport (no UI card) ────────────

  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  const reportState = useCallback(() => {
    if (!activeComp) return;
    const f = playerRef.current?.getCurrentFrame() ?? 0;
    onViewportRef.current?.({
      file: activeComp.id,
      startLine: f,
      endLine: activeComp.durationInFrames,
      heading: playing ? "playing" : "paused",
    });
  }, [activeComp?.id, activeComp?.durationInFrames, playing]);

  // Report on composition/play state change + poll every 1s during playback
  useEffect(() => {
    reportState();
    if (!playing) return;
    const interval = setInterval(reportState, 1000);
    return () => clearInterval(interval);
  }, [reportState]);

  // ── Auto-play on successful compilation ────────────────────────────────

  const prevCompositionsLenRef = useRef(0);
  useEffect(() => {
    if (compositions.length > 0 && errors.length === 0) {
      // New successful compilation — auto-play from start
      const player = playerRef.current;
      if (player) {
        player.seekTo(0);
        // Small delay to let Player mount/update before playing
        requestAnimationFrame(() => player.play());
      }
    }
    prevCompositionsLenRef.current = compositions.length;
  }, [compositions, errors]);

  // ── Locator navigation from chat cards ────────────────────────────────

  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    // data.file holds the composition ID
    if (data.file && typeof data.file === "string") {
      const found = compositions.find((c) => c.id === data.file);
      if (found) {
        onActiveFileChange?.(found.id);
      }
    }
    // data.inFrame / data.outFrame set a loop range and auto-play
    if (typeof data.inFrame === "number" || typeof data.outFrame === "number") {
      const newIn = typeof data.inFrame === "number" ? data.inFrame : null;
      const maxFrame = (activeComp?.durationInFrames ?? 1) - 1;
      const newOut = typeof data.outFrame === "number" ? Math.min(data.outFrame, maxFrame) : null;
      setInFrame(newIn);
      setOutFrame(newOut);
      setLoop(true);
      // Wait for React to pass new inFrame/outFrame to Player before seeking
      setTimeout(() => {
        const player = playerRef.current;
        if (player) {
          player.seekTo(newIn ?? 0);
          player.play();
        }
      }, 100);
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── Player event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const lastFrame = (activeComp?.durationInFrames ?? 1) - 1;
    const onFrame = () => {
      const f = player.getCurrentFrame();
      setFrame(f);
      // Stop at last frame instead of looping back to 0
      if (!loop && f >= lastFrame && player.isPlaying()) {
        player.pause();
        player.seekTo(lastFrame);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);

    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [ActiveComponent]); // Re-attach when component changes

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const player = playerRef.current;
      if (!player) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;
        case "[":
          setPlaybackRate((r) => Math.max(0.25, r - 0.5));
          break;
        case "]":
          setPlaybackRate((r) => Math.min(4, r + 0.5));
          break;
        case "ArrowLeft":
          player.seekTo(Math.max(0, player.getCurrentFrame() - (e.shiftKey ? 10 : 1)));
          break;
        case "ArrowRight":
          player.seekTo(Math.min((activeComp?.durationInFrames ?? 1) - 1, player.getCurrentFrame() + (e.shiftKey ? 10 : 1)));
          break;
        case "i":
        case "I":
          setInFrame(player.getCurrentFrame());
          break;
        case "o":
        case "O":
          setOutFrame(player.getCurrentFrame());
          break;
        case "l":
        case "L":
          setLoop((l) => !l);
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeComp]);

  // ── Viewer actions (Agent → Viewer) ─────────────────────────────────────

  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params } = actionRequest as ViewerActionRequest & { requestId: string };
    const player = playerRef.current;

    let result: ViewerActionResult;

    switch (actionId) {
      case "get-playback-state":
        result = {
          success: true,
          data: {
            compositionId: activeComp?.id ?? null,
            frame,
            fps: activeComp?.fps ?? 30,
            durationInFrames: activeComp?.durationInFrames ?? 0,
            width: activeComp?.width ?? 0,
            height: activeComp?.height ?? 0,
            playing,
            playbackRate,
            compositions: compositions.map((c) => ({ id: c.id, durationInFrames: c.durationInFrames, fps: c.fps })),
          },
        };
        break;

      case "seek-to-frame":
        if (player && typeof params?.frame === "number") {
          player.seekTo(params.frame);
          result = { success: true };
        } else {
          result = { success: false, message: "Invalid frame parameter" };
        }
        break;

      case "set-playback-rate":
        if (typeof params?.rate === "number" && params.rate >= 0.25 && params.rate <= 4) {
          setPlaybackRate(params.rate);
          result = { success: true };
        } else {
          result = { success: false, message: "Rate must be between 0.25 and 4" };
        }
        break;

      case "set-composition":
        if (typeof params?.compositionId === "string") {
          const found = compositions.find((c) => c.id === params.compositionId);
          if (found) {
            onActiveFileChange?.(found.id);
            result = { success: true };
          } else {
            result = { success: false, message: `Composition "${params.compositionId}" not found` };
          }
        } else {
          result = { success: false, message: "Missing compositionId parameter" };
        }
        break;

      default:
        result = { success: false, message: `Unknown action: ${actionId}` };
    }

    onActionResult(requestId, result);
  }, [actionRequest]);

  // ── Notify agent on compilation errors ─────────────────────────────────

  const onNotifyAgentRef = useRef(effectiveOnNotifyAgent);
  onNotifyAgentRef.current = effectiveOnNotifyAgent;

  const prevErrorKeyRef = useRef<string>("");

  useEffect(() => {
    if (errors.length === 0) return;
    // Deduplicate: only notify once per unique error set
    const errorKey = errors.map((e) => `${e.file}:${e.message}`).join("|");
    if (errorKey === prevErrorKeyRef.current) return;
    prevErrorKeyRef.current = errorKey;

    const notify = onNotifyAgentRef.current;
    if (!notify) return;
    const errorMessages = errors.map((e) => `${e.file}: ${e.message}`).join("\n");
    const notification: ViewerNotification = {
      type: "compilation-error",
      message: `Compilation error in Remotion project:\n${errorMessages}\n\nPlease fix the code to restore the preview.`,
      severity: "warning",
      summary: `Build error: ${errors[0].message.slice(0, 80)}`,
    };
    notify(notification);
  }, [errors]);

  // ── Render ──────────────────────────────────────────────────────────────

  // Error state
  if (errors.length > 0) {
    return (
      <div className="flex flex-col h-full" style={{ background: "var(--cc-bg, #09090b)" }}>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full">
            <div className="text-red-400 text-sm font-medium mb-3">Compilation Error</div>
            {errors.map((err, i) => (
              <div key={i} className="mb-2">
                <div className="text-xs font-mono mb-1" style={{ color: "var(--cc-text-secondary)" }}>
                  {err.file}{err.line ? `:${err.line}` : ""}
                </div>
                <pre className="text-xs p-3 rounded overflow-auto"
                  style={{ background: "var(--cc-bg-tertiary)", color: "var(--cc-text)" }}>
                  {err.message}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (compositions.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center" style={{ background: "var(--cc-bg, #09090b)", color: "var(--cc-text-secondary)" }}>
        <div className="text-center max-w-md">
          <div className="text-lg font-medium mb-2" style={{ color: "var(--cc-text)" }}>No Compositions</div>
          <p className="text-sm">
            Define compositions in <code className="px-1 py-0.5 rounded" style={{ background: "var(--cc-bg-tertiary)" }}>src/Root.tsx</code> using{" "}
            <code className="px-1 py-0.5 rounded" style={{ background: "var(--cc-bg-tertiary)" }}>&lt;Composition&gt;</code> to see a preview.
          </p>
        </div>
      </div>
    );
  }

  if (!activeComp || !ActiveComponent) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "var(--cc-bg, #09090b)", color: "var(--cc-text-secondary)" }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--cc-bg, #09090b)" }}>
      {/* Info bar — resolution + duration + export (composition switching is in TopBar) */}
      <div className="flex items-center justify-between px-3 h-7 shrink-0"
        style={{ background: "#000" }}>
        <span className="text-[10px] font-mono" style={{ color: "var(--cc-text-tertiary, #52525b)" }}>
          {activeComp.width}×{activeComp.height} · {activeComp.fps}fps · {(activeComp.durationInFrames / activeComp.fps).toFixed(1)}s
        </span>
        <button
          onClick={() => {
            const base = getApiBase();
            const compId = activeComp?.id;
            window.open(`${base}/export/remotion${compId ? `?composition=${encodeURIComponent(compId)}` : ""}`, "_blank");
          }}
          className="flex items-center gap-1 px-2 h-5 rounded text-[10px] font-medium transition-colors cursor-pointer"
          style={{ color: "var(--cc-text-tertiary, #52525b)", background: "transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cc-text, #fafafa)"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-tertiary, #52525b)"; e.currentTarget.style.background = "transparent"; }}
          title="Export video — open export page"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
            <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export
        </button>
      </div>

      {/* Player canvas */}
      <PlayerCanvas
        comp={activeComp}
        ActiveComponent={ActiveComponent}
        playerRef={playerRef}
        playbackRate={playbackRate}
        loop={loop}
        inFrame={inFrame}
        outFrame={outFrame}
        onRuntimeError={(error) => {
          effectiveOnNotifyAgent?.({
            type: "runtime-error",
            message: `Runtime error in composition "${activeComp.id}":\n${error.message}\n\nPlease fix the component code.`,
            severity: "warning",
            summary: `Runtime error: ${error.message.slice(0, 80)}`,
          });
        }}
      />

      {/* Playback controls — always shown (including replay mode, readonly only hides range editing) */}
      <RemotionControls
          playerRef={playerRef}
          frame={frame}
          durationInFrames={activeComp.durationInFrames}
          fps={activeComp.fps}
          playing={playing}
          playbackRate={playbackRate}
          loop={loop}
          inFrame={inFrame}
          outFrame={outFrame}
          onPlayPause={() => playerRef.current?.toggle()}
          onSeek={(f) => playerRef.current?.seekTo(f)}
          onRateChange={setPlaybackRate}
          onLoopToggle={() => setLoop((l) => !l)}
          onSetIn={() => {
            setInFrame(frame);
            // If in-point is after out-point, clear out-point
            if (outFrame !== null && frame >= outFrame) setOutFrame(null);
          }}
          onSetOut={() => {
            setOutFrame(frame);
            // If out-point is before in-point, clear in-point
            if (inFrame !== null && frame <= inFrame) setInFrame(null);
          }}
          onClearRange={() => { setInFrame(null); setOutFrame(null); setLoop(false); }}
        />
    </div>
  );
}
