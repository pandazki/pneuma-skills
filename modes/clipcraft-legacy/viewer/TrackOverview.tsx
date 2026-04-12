// modes/clipcraft/viewer/TrackOverview.tsx
import { useMemo } from "react";
import { useClipCraftState } from "./store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "./store/selectors.js";
import { useWorkspaceUrl } from "./hooks/useWorkspaceUrl.js";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const LABEL_W = 28;
const CAPTION_H = 32;
const TRACK_H = 28;
const GAP = 2;

/** Deterministic pseudo-random waveform bar heights for a seed string. */
function waveHeights(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = ((h << 5) - h + i * 7) | 0;
    out.push(0.2 + ((h >>> 0) % 100) / 100 * 0.8);
  }
  return out;
}

function FakeWaveform({ seed, bars, height, color }: { seed: string; bars: number; height: number; color: string }) {
  const hs = useMemo(() => waveHeights(seed, bars), [seed, bars]);
  return (
    <div style={{ display: "flex", alignItems: "center", height, gap: 1 }}>
      {hs.map((v, i) => (
        <div key={i} style={{ width: 2, height: Math.round(v * height), background: color, borderRadius: 1, flexShrink: 0 }} />
      ))}
    </div>
  );
}

/** Track label cell. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ width: LABEL_W, fontSize: 10, color: "#71717a", flexShrink: 0, textAlign: "center", lineHeight: 1 }}>
      {children}
    </span>
  );
}

export function TrackOverview() {
  const state = useClipCraftState();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { selectedSceneId, storyboard, playback } = state;
  const bgm = storyboard.bgm;
  const urlFn = useWorkspaceUrl();

  const dur = Math.max(totalDuration, 1);

  // Scene layout: cumulative start offset and width as percentages
  const layouts = useMemo(() => {
    let off = 0;
    return scenes.map((s) => {
      const left = (off / dur) * 100;
      const w = (s.duration / dur) * 100;
      off += s.duration;
      return { id: s.id, left, width: w };
    });
  }, [scenes, dur]);

  // Ruler ticks every 2s
  const ticks = useMemo(() => {
    const r: number[] = [];
    for (let t = 0; t <= dur; t += 2) r.push(t);
    return r;
  }, [dur]);

  if (scenes.length === 0 && !bgm) return null;

  const playheadPct = Math.min((playback.globalTime / dur) * 100, 100);

  // The "content area" is the flex:1 region next to the labels.
  // Overlays (playhead, selection highlight) are placed inside a wrapper
  // that sits above the content tracks with left=LABEL_W, right=0.

  return (
    <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "#a1a1aa" }}>
      {/* Time ruler */}
      <div style={{ position: "relative", height: 22, marginLeft: LABEL_W, marginBottom: 2 }}>
        {ticks.map((t) => {
          const pct = (t / dur) * 100;
          return (
            <div key={t} style={{ position: "absolute", left: `${pct}%`, top: 0 }}>
              <div style={{ width: 1, height: 8, background: "#3f3f46", transform: "translateX(-0.5px)" }} />
              <span style={{ fontSize: 9, color: "#52525b", position: "absolute", top: 9, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
                {formatTime(t)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tracks + overlays wrapper */}
      <div style={{ position: "relative" }}>
        {/* === Overlay layer (inside content area only) === */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W, right: 0, pointerEvents: "none", zIndex: 1 }}>
          {/* Selected scene column highlight */}
          {layouts.map(({ id, left, width }) =>
            id === selectedSceneId ? (
              <div
                key={`hl-${id}`}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  bottom: 0,
                  background: "rgba(249, 115, 22, 0.06)",
                  borderLeft: "1px solid rgba(249, 115, 22, 0.15)",
                  borderRight: "1px solid rgba(249, 115, 22, 0.15)",
                }}
              />
            ) : null,
          )}
          {/* Playhead */}
          <div
            style={{
              position: "absolute",
              left: `${playheadPct}%`,
              top: 0,
              bottom: 0,
              width: 2,
              marginLeft: -1,
              background: "#f97316",
              borderRadius: 1,
              boxShadow: "0 0 4px rgba(249, 115, 22, 0.5)",
              zIndex: 2,
            }}
          />
        </div>

        {/* Caption track */}
        <div style={{ display: "flex", alignItems: "center", height: CAPTION_H, marginBottom: GAP }}>
          <Label>Tt</Label>
          <div style={{ flex: 1, display: "flex", height: CAPTION_H - 4, gap: 1, minWidth: 0, overflow: "hidden" }}>
            {scenes.map((scene) => {
              const sel = scene.id === selectedSceneId;
              return (
                <div
                  key={scene.id}
                  style={{
                    width: `${(scene.duration / dur) * 100}%`, flexShrink: 0,
                    background: sel ? "#2d2519" : "#1a1a1e",
                    borderRadius: 3,
                    border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
                    overflow: "hidden",
                    padding: "2px 6px",
                    fontSize: 9,
                    lineHeight: `${CAPTION_H - 8}px`,
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    color: scene.caption ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
                    boxSizing: "border-box",
                  }}
                >
                  {scene.caption ?? ""}
                </div>
              );
            })}
          </div>
        </div>

        {/* Video track */}
        <div style={{ display: "flex", alignItems: "center", height: TRACK_H, marginBottom: GAP }}>
          <Label>{"\uD83C\uDFAC"}</Label>
          <div style={{ flex: 1, display: "flex", height: TRACK_H - 4, gap: 1, minWidth: 0, overflow: "hidden" }}>
            {scenes.map((scene) => {
              const status = scene.visual?.status ?? "pending";
              const sel = scene.id === selectedSceneId;
              const thumb = scene.visual?.thumbnail;
              return (
                <div
                  key={scene.id}
                  style={{
                    width: `${(scene.duration / dur) * 100}%`, flexShrink: 0,
                    background: sel ? "#1e1a14" : "#18181b",
                    borderRadius: 3,
                    border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    padding: "0 2px",
                    boxSizing: "border-box",
                  }}
                >
                  {status === "ready" && thumb ? (
                    <>
                      <img
                        src={urlFn(thumb)}
                        alt=""
                        style={{ height: TRACK_H - 8, width: TRACK_H - 8, objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
                      />
                      <img
                        src={urlFn(thumb)}
                        alt=""
                        style={{ height: TRACK_H - 8, width: TRACK_H - 8, objectFit: "cover", borderRadius: 2, flexShrink: 0, opacity: 0.7 }}
                      />
                    </>
                  ) : status === "generating" ? (
                    <span style={{ fontSize: 9, color: "#a16207", padding: "0 4px", whiteSpace: "nowrap" }}>{"\u23F3"} generating</span>
                  ) : status === "error" ? (
                    <span style={{ fontSize: 9, color: "#ef4444", padding: "0 4px", whiteSpace: "nowrap" }}>{"\u26A0"} error</span>
                  ) : (
                    <span style={{ fontSize: 9, color: "#3f3f46", padding: "0 4px" }}>&mdash;</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Audio track */}
        <div style={{ display: "flex", alignItems: "center", height: TRACK_H, marginBottom: bgm ? GAP : 0 }}>
          <Label>{"\uD83D\uDD0A"}</Label>
          <div style={{ flex: 1, display: "flex", height: TRACK_H - 4, gap: 1, minWidth: 0, overflow: "hidden" }}>
            {scenes.map((scene) => {
              const hasAudio = scene.audio?.status === "ready";
              const sel = scene.id === selectedSceneId;
              return (
                <div
                  key={scene.id}
                  style={{
                    width: `${(scene.duration / dur) * 100}%`, flexShrink: 0,
                    background: sel ? "#1a1e2a" : "#18181b",
                    borderRadius: 3,
                    border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box",
                  }}
                >
                  {hasAudio && (
                    <FakeWaveform
                      seed={scene.id}
                      bars={Math.max(8, Math.floor((scene.duration / dur) * 40))}
                      height={TRACK_H - 12}
                      color={sel ? "#38bdf8" : "#1e3a5f"}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* BGM track */}
        {bgm && (
          <div style={{ display: "flex", alignItems: "center", height: TRACK_H }}>
            <Label>{"\u266A"}</Label>
            <div
              style={{
                flex: 1,
                height: TRACK_H - 4,
                background: "#1e1033",
                borderRadius: 3,
                border: "1px solid #27272a",
                padding: "0 8px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                overflow: "hidden",
                boxSizing: "border-box",
              }}
            >
              <span style={{ fontSize: 9, color: "#a78bfa", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 500 }}>
                {"\u266A"} {bgm.title}
              </span>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <FakeWaveform seed={bgm.title || "bgm"} bars={60} height={TRACK_H - 12} color="#6d28d9" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
