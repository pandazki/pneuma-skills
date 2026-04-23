// modes/clipcraft/viewer/ExportPanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";

type ExportState = "idle" | "options" | "running" | "done" | "error";

export function ExportPanel() {
  const [state, setState] = useState<ExportState>("idle");
  const [quality, setQuality] = useState<"preview" | "final">("preview");
  const [subtitles, setSubtitles] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll export status
  useEffect(() => {
    if (state !== "running" || !exportId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/export/${exportId}/status`);
        const data = await res.json();
        setProgress(data.progress ?? 0);

        if (data.status === "done") {
          setState("done");
          setOutput(data.output);
          stopPolling();
        } else if (data.status === "error") {
          setState("error");
          setError(data.error ?? "Export failed");
          stopPolling();
        }
      } catch {
        setState("error");
        setError("Connection lost");
        stopPolling();
      }
    }, 500);

    return stopPolling;
  }, [state, exportId, stopPolling]);

  const startExport = useCallback(async () => {
    setState("running");
    setProgress(0);
    setError(null);
    setOutput(null);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality, subtitles }),
      });
      const data = await res.json();
      if (data.error) {
        setState("error");
        setError(data.error);
        return;
      }
      setExportId(data.exportId);
    } catch {
      setState("error");
      setError("Failed to start export");
    }
  }, [quality, subtitles]);

  const handleDownload = useCallback(() => {
    if (exportId) {
      window.open(`/api/export/${exportId}/download`, "_blank");
    }
  }, [exportId]);

  // ── Idle: small icon button ─────────────────────────────────────────
  if (state === "idle") {
    return (
      <button
        onClick={() => setState("options")}
        title="Export video"
        style={{
          background: "rgba(39,39,42,0.8)", border: "1px solid #3f3f46", borderRadius: 6,
          color: "#a1a1aa", cursor: "pointer", padding: "5px 8px", fontSize: 13,
          lineHeight: 1, display: "flex", alignItems: "center", gap: 4,
          backdropFilter: "blur(8px)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    );
  }

  const panelStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    background: "rgba(24,24,27,0.9)", backdropFilter: "blur(8px)",
    border: "1px solid #3f3f46", borderRadius: 6, padding: "4px 8px",
  };

  // ── Options ───────────────────────────────────────────────────────────
  if (state === "options") {
    return (
      <div style={panelStyle}>
        <div style={{ display: "flex", border: "1px solid #3f3f46", borderRadius: 4, overflow: "hidden" }}>
          {(["preview", "final"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              style={{
                background: quality === q ? "#27272a" : "none",
                border: "none", color: quality === q ? "#f97316" : "#71717a",
                cursor: "pointer", padding: "2px 8px", fontSize: 11,
              }}
            >
              {q === "preview" ? "Preview" : "Final"}
            </button>
          ))}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#71717a", cursor: "pointer" }}>
          <input
            type="checkbox" checked={subtitles}
            onChange={(e) => setSubtitles(e.target.checked)}
            style={{ accentColor: "#f97316" }}
          />
          Subs
        </label>

        <button
          onClick={startExport}
          style={{
            background: "#f97316", border: "none", borderRadius: 4,
            color: "#fff", cursor: "pointer", padding: "2px 10px", fontSize: 11, fontWeight: 600,
          }}
        >
          Go
        </button>

        <button
          onClick={() => setState("idle")}
          style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", fontSize: 11 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Running ───────────────────────────────────────────────────────────
  if (state === "running") {
    const pct = Math.round(progress * 100);
    return (
      <div style={{ ...panelStyle, minWidth: 140 }}>
        <div style={{ flex: 1, height: 6, background: "#27272a", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            width: `${pct}%`, height: "100%", background: "#f97316", borderRadius: 3,
            transition: "width 0.3s ease",
          }} />
        </div>
        <span style={{ fontSize: 11, color: "#a1a1aa", fontFamily: "monospace", minWidth: 32 }}>
          {pct}%
        </span>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────
  if (state === "done") {
    return (
      <div style={panelStyle}>
        <button
          onClick={handleDownload}
          style={{
            background: "#f97316", border: "none", borderRadius: 4,
            color: "#fff", cursor: "pointer", padding: "2px 10px", fontSize: 11, fontWeight: 600,
          }}
        >
          Download
        </button>
        <button
          onClick={() => setState("options")}
          style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", fontSize: 11 }}
        >
          Again
        </button>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────
  return (
    <div style={panelStyle}>
      <span style={{ fontSize: 11, color: "#ef4444", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {error ?? "Export failed"}
      </span>
      <button
        onClick={() => setState("options")}
        style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 11 }}
      >
        Retry
      </button>
    </div>
  );
}
