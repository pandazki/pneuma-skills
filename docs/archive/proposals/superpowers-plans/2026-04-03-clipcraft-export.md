# ClipCraft Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side ffmpeg export that assembles video clips + TTS + BGM into a single mp4 with optional subtitle burn-in and progress tracking.

**Architecture:** `server/ffmpeg.ts` builds ffmpeg commands from storyboard data and spawns the process via `Bun.spawn`. Three API routes handle export lifecycle (start, status, download). A React `ExportPanel` component in the viewer controls bar manages the UI flow.

**Tech Stack:** ffmpeg (system binary), Bun.spawn, Hono routes, React

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `server/ffmpeg.ts` | ffmpeg detection, command building, execution with progress parsing |
| **Modify:** `server/index.ts` | Register 3 export API routes |
| **Create:** `modes/clipcraft/viewer/ExportPanel.tsx` | Export button, options, progress, download UI |
| **Modify:** `modes/clipcraft/viewer/VideoPreview.tsx` | Add ExportPanel to controls bar |

---

### Task 1: Create `server/ffmpeg.ts` — ffmpeg detection + command builder + execution

**Files:**
- Create: `server/ffmpeg.ts`

- [ ] **Step 1: Create the ffmpeg module**

Create `server/ffmpeg.ts` with the full implementation:

```ts
// server/ffmpeg.ts
import { join, resolve } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import type { Storyboard, Scene, ProjectConfig, BGMConfig } from "../modes/clipcraft/types.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExportOptions {
  workspace: string;
  storyboard: Storyboard;
  project: ProjectConfig;
  quality: "preview" | "final";
  subtitles: boolean;
  onProgress: (progress: number) => void;
}

export interface ExportResult {
  outputPath: string;
}

interface InputEntry {
  args: string[];       // ffmpeg input args (e.g. ["-i", "path"] or ["-loop", "1", "-t", "4", "-i", "path"])
  index: number;        // input index in ffmpeg command
  type: "video" | "tts" | "bgm";
  sceneId?: string;
  sceneStart?: number;  // cumulative start time in seconds
}

const QUALITY_PRESETS = {
  preview: { crf: "28", preset: "fast" },
  final:   { crf: "18", preset: "medium" },
} as const;

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

// ── Detection ───────────────────────────────────────────────────────────────

export async function detectFfmpeg(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** Check if a video file has an audio track using ffprobe. */
async function hasAudioTrack(filePath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      ["ffprobe", "-v", "quiet", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().includes("audio");
  } catch {
    return false;
  }
}

// ── SRT Generation ──────────────────────────────────────────────────────────

function generateSrt(scenes: Scene[]): string {
  const lines: string[] = [];
  let idx = 1;
  let cumulative = 0;

  for (const scene of scenes) {
    if (scene.caption) {
      const start = formatSrtTime(cumulative);
      const end = formatSrtTime(cumulative + scene.duration);
      lines.push(`${idx}`, `${start} --> ${end}`, scene.caption, "");
      idx++;
    }
    cumulative += scene.duration;
  }

  return lines.join("\n");
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function pad2(n: number): string { return n.toString().padStart(2, "0"); }
function pad3(n: number): string { return n.toString().padStart(3, "0"); }

// ── Progress Parsing ────────────────────────────────────────────────────────

const TIME_RE = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

function parseProgress(line: string, totalDuration: number): number | null {
  const m = TIME_RE.exec(line);
  if (!m) return null;
  const seconds = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
  return Math.min(1, seconds / Math.max(totalDuration, 0.1));
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportVideo(options: ExportOptions): Promise<ExportResult> {
  const { workspace, storyboard, project, quality, subtitles, onProgress } = options;

  const sortedScenes = [...storyboard.scenes].sort((a, b) => a.order - b.order);
  const readyScenes = sortedScenes.filter(
    (s) => s.visual?.status === "ready" && s.visual.source,
  );

  if (readyScenes.length === 0) {
    throw new Error("No ready video scenes to export");
  }

  const { width, height } = project.resolution;
  const fps = project.fps;
  const totalDuration = sortedScenes.reduce((sum, s) => sum + s.duration, 0);
  const bgm = storyboard.bgm as BGMConfig | null;
  const preset = QUALITY_PRESETS[quality];

  // Ensure export directory exists
  const exportDir = join(workspace, "export");
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
  const outputPath = join(exportDir, "output.mp4");

  // ── Build inputs ────────────────────────────────────────────────────────

  const inputs: InputEntry[] = [];
  let inputIdx = 0;
  let cumulative = 0;

  // Video inputs
  for (const scene of sortedScenes) {
    const src = scene.visual?.source;
    if (!src || scene.visual?.status !== "ready") continue;

    const absPath = join(workspace, src);
    const isVideo = VIDEO_EXT_RE.test(src);

    if (isVideo) {
      inputs.push({ args: ["-i", absPath], index: inputIdx++, type: "video", sceneId: scene.id, sceneStart: cumulative });
    } else {
      // Image → video: loop for scene duration
      inputs.push({
        args: ["-loop", "1", "-t", String(scene.duration), "-framerate", String(fps), "-i", absPath],
        index: inputIdx++, type: "video", sceneId: scene.id, sceneStart: cumulative,
      });
    }
    cumulative += scene.duration;
  }

  // TTS inputs
  cumulative = 0;
  for (const scene of sortedScenes) {
    if (scene.audio?.status === "ready" && scene.audio.source) {
      const absPath = join(workspace, scene.audio.source);
      inputs.push({ args: ["-i", absPath], index: inputIdx++, type: "tts", sceneId: scene.id, sceneStart: cumulative });
    }
    cumulative += scene.duration;
  }

  // BGM input
  let bgmInput: InputEntry | null = null;
  if (bgm?.source) {
    const absPath = join(workspace, bgm.source);
    bgmInput = { args: ["-i", absPath], index: inputIdx++, type: "bgm" };
    inputs.push(bgmInput);
  }

  // ── Check video audio tracks ────────────────────────────────────────────

  const videoInputs = inputs.filter((i) => i.type === "video");
  const videoHasAudio: boolean[] = [];
  for (const vi of videoInputs) {
    // Get the file path (last element of args)
    const filePath = vi.args[vi.args.length - 1];
    const isVideo = VIDEO_EXT_RE.test(filePath);
    videoHasAudio.push(isVideo ? await hasAudioTrack(filePath) : false);
  }

  const ttsInputs = inputs.filter((i) => i.type === "tts");
  const hasAnyAudio = videoHasAudio.some(Boolean) || ttsInputs.length > 0 || bgmInput !== null;

  // ── Build filter_complex ────────────────────────────────────────────────

  const filters: string[] = [];
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

  // 1. Scale + label each video input
  for (let i = 0; i < videoInputs.length; i++) {
    filters.push(`[${videoInputs[i].index}:v]${scaleFilter}[v${i}]`);
  }

  // 2. Concat all video streams
  const vLabels = videoInputs.map((_, i) => `[v${i}]`).join("");
  filters.push(`${vLabels}concat=n=${videoInputs.length}:v=1:a=0[vout]`);

  // 3. Subtitle burn-in (optional)
  let videoOutputLabel = "[vout]";
  let srtPath: string | null = null;
  if (subtitles) {
    const srtContent = generateSrt(sortedScenes);
    if (srtContent.trim()) {
      srtPath = join(exportDir, "subtitles.srt");
      writeFileSync(srtPath, srtContent, "utf-8");
      // Escape path for ffmpeg subtitles filter (colons and backslashes)
      const escapedPath = srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
      filters.push(`[vout]subtitles='${escapedPath}':force_style='FontSize=24,FontName=Inter,Outline=2,Shadow=1,MarginV=40'[vsub]`);
      videoOutputLabel = "[vsub]";
    }
  }

  // 4. Audio mixing
  let audioOutputLabel: string | null = null;

  if (hasAnyAudio) {
    const audioStreams: string[] = [];

    // Video original audio — concat if multiple
    const videoAudioIndices = videoInputs.filter((_, i) => videoHasAudio[i]);
    if (videoAudioIndices.length > 0) {
      if (videoAudioIndices.length === 1) {
        audioStreams.push(`[${videoAudioIndices[0].index}:a]`);
      } else {
        const vaLabels = videoAudioIndices.map((vi) => `[${vi.index}:a]`).join("");
        filters.push(`${vaLabels}concat=n=${videoAudioIndices.length}:v=0:a=1[va]`);
        audioStreams.push("[va]");
      }
    }

    // TTS — position each at its scene start time using adelay
    for (let i = 0; i < ttsInputs.length; i++) {
      const delayMs = Math.round((ttsInputs[i].sceneStart ?? 0) * 1000);
      if (delayMs > 0) {
        filters.push(`[${ttsInputs[i].index}:a]adelay=${delayMs}|${delayMs}[tts${i}]`);
        audioStreams.push(`[tts${i}]`);
      } else {
        audioStreams.push(`[${ttsInputs[i].index}:a]`);
      }
    }

    // BGM — volume + fade
    if (bgmInput) {
      const vol = bgm?.volume ?? 0.5;
      const fadeIn = bgm?.fadeIn ?? 0;
      const fadeOut = bgm?.fadeOut ?? 0;

      const bgmFilters: string[] = [];
      bgmFilters.push(`volume=${vol}`);
      if (fadeIn > 0) bgmFilters.push(`afade=t=in:d=${fadeIn}`);
      if (fadeOut > 0) {
        const fadeOutStart = Math.max(0, totalDuration - fadeOut);
        bgmFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      }
      // Trim BGM to total duration
      bgmFilters.push(`atrim=0:${totalDuration}`);

      filters.push(`[${bgmInput.index}:a]${bgmFilters.join(",")}[bgm]`);
      audioStreams.push("[bgm]");
    }

    // Mix all audio streams
    if (audioStreams.length === 1) {
      audioOutputLabel = audioStreams[0];
    } else if (audioStreams.length > 1) {
      filters.push(`${audioStreams.join("")}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=0[aout]`);
      audioOutputLabel = "[aout]";
    }
  }

  // ── Assemble ffmpeg args ────────────────────────────────────────────────

  const args: string[] = ["ffmpeg", "-y"]; // -y to overwrite

  // Add all inputs
  for (const input of inputs) {
    args.push(...input.args);
  }

  // filter_complex
  if (filters.length > 0) {
    args.push("-filter_complex", filters.join(";"));
  }

  // Output mapping
  args.push("-map", videoOutputLabel);
  if (audioOutputLabel) {
    args.push("-map", audioOutputLabel);
  }

  // Encoding settings
  args.push("-c:v", "libx264", "-crf", preset.crf, "-preset", preset.preset);
  if (audioOutputLabel) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push("-movflags", "+faststart");
  args.push(outputPath);

  // ── Execute ─────────────────────────────────────────────────────────────

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: workspace,
  });

  // Parse stderr for progress
  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let stderrText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    stderrText += chunk;

    // ffmpeg writes progress on \r-terminated lines
    const lines = chunk.split(/[\r\n]+/);
    for (const line of lines) {
      const progress = parseProgress(line, totalDuration);
      if (progress !== null) {
        onProgress(progress);
      }
    }
  }

  const exitCode = await proc.exited;

  // Cleanup temp SRT
  if (srtPath) {
    try { unlinkSync(srtPath); } catch {}
  }

  if (exitCode !== 0) {
    // Extract last meaningful error line from stderr
    const errorLines = stderrText.split("\n").filter((l) => l.trim()).slice(-5);
    throw new Error(`ffmpeg exited with code ${exitCode}: ${errorLines.join("\n")}`);
  }

  onProgress(1);
  return { outputPath };
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun run build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add server/ffmpeg.ts
git commit -m "feat(clipcraft): add server/ffmpeg.ts — export command builder + execution

Builds ffmpeg filter_complex from storyboard data: video concat with
scale/pad, TTS positioning via adelay, BGM volume/fade, optional SRT
subtitles. Progress parsing from stderr. Handles image scenes, missing
audio tracks, and edge cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Register export API routes in `server/index.ts`

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add import and export state**

At the top of `server/index.ts`, add the import alongside existing imports:

```ts
import { detectFfmpeg, exportVideo, type ExportOptions } from "./ffmpeg.js";
```

- [ ] **Step 2: Add export routes after the manual refresh route**

After the `/api/refresh` route block (around line 1628), add:

```ts
  // ── Video export (ClipCraft) ────────────────────────────────────────────
  interface ExportJob {
    id: string;
    status: "running" | "done" | "error";
    progress: number;
    output?: string;
    error?: string;
  }
  let currentExport: ExportJob | null = null;

  app.post("/api/export", async (c) => {
    // Only one export at a time
    if (currentExport?.status === "running") {
      return c.json({ exportId: currentExport.id });
    }

    // Check ffmpeg
    const hasFfmpeg = await detectFfmpeg();
    if (!hasFfmpeg) {
      return c.json({ error: "ffmpeg not found. Install it: brew install ffmpeg" }, 400);
    }

    // Read storyboard + project from workspace
    const { readFileSync } = await import("fs");
    let storyboard, projectConfig;
    try {
      storyboard = JSON.parse(readFileSync(join(workspace, "storyboard.json"), "utf-8"));
      projectConfig = JSON.parse(readFileSync(join(workspace, "project.json"), "utf-8"));
    } catch (err) {
      return c.json({ error: "Failed to read storyboard.json or project.json" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const quality = body.quality === "final" ? "final" : "preview";
    const subtitles = body.subtitles === true;

    const exportId = `export-${Date.now()}`;
    currentExport = { id: exportId, status: "running", progress: 0 };

    // Run async — don't await
    exportVideo({
      workspace,
      storyboard,
      project: projectConfig,
      quality,
      subtitles,
      onProgress: (p) => {
        if (currentExport) currentExport.progress = p;
      },
    })
      .then((result) => {
        if (currentExport?.id === exportId) {
          currentExport.status = "done";
          currentExport.progress = 1;
          currentExport.output = result.outputPath.replace(workspace + "/", "");
        }
      })
      .catch((err) => {
        if (currentExport?.id === exportId) {
          currentExport.status = "error";
          currentExport.error = err.message;
        }
      });

    return c.json({ exportId });
  });

  app.get("/api/export/:id/status", (c) => {
    const id = c.req.param("id");
    if (!currentExport || currentExport.id !== id) {
      return c.json({ status: "error", error: "Export not found" }, 404);
    }
    return c.json({
      status: currentExport.status,
      progress: currentExport.progress,
      output: currentExport.output,
      error: currentExport.error,
    });
  });

  app.get("/api/export/:id/download", async (c) => {
    const id = c.req.param("id");
    if (!currentExport || currentExport.id !== id || currentExport.status !== "done" || !currentExport.output) {
      return c.json({ error: "Export not ready" }, 404);
    }
    const filePath = join(workspace, currentExport.output);
    const file = Bun.file(filePath);
    if (!await file.exists()) {
      return c.json({ error: "Output file not found" }, 404);
    }
    const fileName = currentExport.output.split("/").pop() ?? "output.mp4";
    return new Response(file.stream(), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(file.size),
      },
    });
  });
```

- [ ] **Step 3: Verify build**

Run: `bun run build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(clipcraft): register export API routes

POST /api/export — start async ffmpeg export job
GET /api/export/:id/status — poll progress (0-1)
GET /api/export/:id/download — stream output mp4

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create `ExportPanel.tsx` frontend component

**Files:**
- Create: `modes/clipcraft/viewer/ExportPanel.tsx`

- [ ] **Step 1: Create the ExportPanel component**

Create `modes/clipcraft/viewer/ExportPanel.tsx`:

```tsx
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

  // ── Idle: just the Export button ──────────────────────────────────────
  if (state === "idle") {
    return (
      <button
        onClick={() => setState("options")}
        style={{
          background: "none", border: "1px solid #3f3f46", borderRadius: 4,
          color: "#71717a", cursor: "pointer", padding: "2px 8px", fontSize: 11,
        }}
      >
        Export
      </button>
    );
  }

  // ── Options panel ─────────────────────────────────────────────────────
  if (state === "options") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Quality toggle */}
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

        {/* Subtitles checkbox */}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#71717a", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={subtitles}
            onChange={(e) => setSubtitles(e.target.checked)}
            style={{ accentColor: "#f97316" }}
          />
          Subs
        </label>

        {/* Start */}
        <button
          onClick={startExport}
          style={{
            background: "#f97316", border: "none", borderRadius: 4,
            color: "#fff", cursor: "pointer", padding: "2px 10px", fontSize: 11, fontWeight: 600,
          }}
        >
          Go
        </button>

        {/* Cancel */}
        <button
          onClick={() => setState("idle")}
          style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", fontSize: 11 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Running: progress bar ─────────────────────────────────────────────
  if (state === "running") {
    const pct = Math.round(progress * 100);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
        <div style={{
          flex: 1, height: 6, background: "#27272a", borderRadius: 3, overflow: "hidden",
        }}>
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

  // ── Done: download button ─────────────────────────────────────────────
  if (state === "done") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={handleDownload}
          style={{
            background: "#16a34a", border: "none", borderRadius: 4,
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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "#ef4444" }}>{error ?? "Export failed"}</span>
      <button
        onClick={() => setState("options")}
        style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 11 }}
      >
        Retry
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build 2>&1 | tail -5`
Expected: build succeeds (component not yet imported, but should compile)

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/ExportPanel.tsx
git commit -m "feat(clipcraft): add ExportPanel component

5 states: idle (button) → options (quality + subtitles) → running
(progress bar) → done (download) → error (retry). Polls /api/export
status every 500ms during export.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Integrate ExportPanel into VideoPreview

**Files:**
- Modify: `modes/clipcraft/viewer/VideoPreview.tsx`

- [ ] **Step 1: Add import and component**

In `modes/clipcraft/viewer/VideoPreview.tsx`, add import at top:

```ts
import { ExportPanel } from "./ExportPanel.js";
```

Then in the controls bar, replace the existing `<RefreshButton />` line with:

```tsx
        <RefreshButton />
        <ExportPanel />
```

This places the Export panel next to the Refresh button in the controls bar.

- [ ] **Step 2: Verify build and test**

Run: `bun run build 2>&1 | tail -5`
Expected: build succeeds

Manual test:
1. `bun run dev clipcraft` — open a project with video scenes
2. Click "Export" in controls bar → options panel appears
3. Select quality, toggle subtitles, click "Go"
4. Progress bar should animate
5. On completion → "Download" button appears
6. Click Download → mp4 file downloads

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/VideoPreview.tsx
git commit -m "feat(clipcraft): wire ExportPanel into VideoPreview controls bar

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
