import { useState } from "react";
import { useStore } from "../store/index";
import { startPlayback, stopPlayback, seekTo } from "../replay-engine";
import { getApiBase } from "../utils/api";

export function ReplayPlayer() {
  const {
    replayMode, replayMessages, replayMetadata,
    currentSeq, playbackSpeed, isPlaying,
    replayCheckpoints,
  } = useStore();

  if (!replayMode || !replayMetadata) return null;

  const totalMessages = replayMessages.length;
  const rawProgress = totalMessages > 1 ? Math.min(1, currentSeq / (totalMessages - 1)) : 0;
  const progress = rawProgress;

  // Checkpoint dots at Edit/Write message positions
  const checkpointPositions = (() => {
    const editIndices: number[] = [];
    for (let i = 0; i < replayMessages.length; i++) {
      const m = replayMessages[i] as any;
      if (m.type === "assistant" && m.message?.content?.some((b: any) =>
        b.type === "tool_use" && (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit")
      )) {
        editIndices.push(i);
      }
    }
    return replayCheckpoints.map((cp: any, idx: number) => {
      const editIdx = idx < editIndices.length ? editIndices[idx] : editIndices[editIndices.length - 1];
      const position = editIdx !== undefined && totalMessages > 1
        ? editIdx / (totalMessages - 1)
        : (idx + 1) / (replayCheckpoints.length + 1);
      return {
        hash: cp.hash,
        position: Math.max(0, Math.min(1, position)),
        label: cp.label || `Step ${idx + 1}`,
      };
    });
  })();

  const prevTurn = () => {
    for (let i = currentSeq - 1; i >= 0; i--) {
      if (replayMessages[i].type === "user_message") { seekTo(i); return; }
    }
    seekTo(0);
  };

  const nextTurn = () => {
    for (let i = currentSeq + 1; i < totalMessages; i++) {
      if (replayMessages[i].type === "user_message") { seekTo(i); return; }
    }
    seekTo(totalMessages - 1);
  };

  const speeds = [1, 2, 4, 8];
  const nextSpeed = () => {
    const idx = speeds.indexOf(playbackSpeed);
    useStore.getState().setPlaybackSpeed(speeds[(idx + 1) % speeds.length]);
  };

  return (
    <div className="border-t border-cc-border bg-cc-surface overflow-hidden shrink-0 w-full">
      {/* Progress bar */}
      <div className="px-4 h-6 flex items-center min-w-0">
        <div
          className="relative flex-1 h-6 flex items-center cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seekTo(Math.round(x * (totalMessages - 1)));
          }}
        >
          <div className="absolute inset-x-0 h-1 rounded-full bg-cc-border" />
          <div className="absolute h-1 rounded-full bg-cc-primary" style={{ left: 0, width: `${progress * 100}%` }} />
          {checkpointPositions.map((cp: any) => (
            <div
              key={cp.hash}
              className="absolute w-2 h-2 rounded-full bg-cc-primary/60 border border-cc-primary -translate-x-1/2 -translate-y-1/2 top-1/2 hover:scale-150 transition-transform z-10"
              style={{ left: `${cp.position * 100}%` }}
              title={cp.label}
            />
          ))}
          <div
            className="absolute w-3 h-3 rounded-full bg-cc-primary shadow-[0_0_8px_rgba(249,115,22,0.4)] -translate-x-1/2 -translate-y-1/2 top-1/2 z-20"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 pb-2 text-xs min-w-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={prevTurn} className="w-6 h-6 flex items-center justify-center rounded hover:bg-cc-hover text-cc-muted transition-colors cursor-pointer" title="Previous turn">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M13 13V3L8 8zm-5 0V3L3 8z" /></svg>
          </button>
          <button
            onClick={() => isPlaying ? stopPlayback() : startPlayback()}
            title={isPlaying ? "Pause replay" : "Play replay"}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-cc-primary text-white hover:brightness-110 transition-all cursor-pointer"
          >
            {isPlaying ? (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M5 3h2v10H5zm4 0h2v10H9z" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M4 2l10 6-10 6z" /></svg>
            )}
          </button>
          <button onClick={nextTurn} className="w-6 h-6 flex items-center justify-center rounded hover:bg-cc-hover text-cc-muted transition-colors cursor-pointer" title="Next turn">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M3 3l5 5-5 5zm5 0l5 5-5 5z" /></svg>
          </button>
        </div>

        <button onClick={nextSpeed} title="Change playback speed" className="px-2 py-1 rounded-full border border-cc-border text-cc-muted hover:text-cc-fg hover:border-cc-muted transition-colors cursor-pointer tabular-nums text-[10px] font-medium">
          {playbackSpeed}x
        </button>

        <div className="flex-1 min-w-0" />
        <span className="text-cc-muted/60 text-[10px] truncate shrink min-w-0">{replayMetadata.title}</span>
        <ContinueWorkButton />
      </div>
    </div>
  );
}

function ContinueWorkButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      stopPlayback();
      const resp = await fetch(`${getApiBase()}/api/replay/continue`, { method: "POST" });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      // Reload page without replay param — cleanest transition to normal session.
      // The agent was launched by the server callback; page loads as normal session.
      const url = new URL(window.location.href);
      url.searchParams.delete("replay");
      window.location.href = url.toString();
    } catch (err: any) {
      console.error("[continue-work]", err);
      setError(err.message || "Continue failed");
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleContinue}
      disabled={loading}
      title={error || "Switch to normal editing mode and continue working"}
      className="ml-2 px-4 py-1.5 rounded-lg bg-cc-primary text-white text-xs font-medium hover:brightness-110 transition-all whitespace-nowrap disabled:opacity-50 cursor-pointer"
    >
      {loading ? "Starting..." : error ? `Retry (${error})` : "Continue Work"}
    </button>
  );
}
