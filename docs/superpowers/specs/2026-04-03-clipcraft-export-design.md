# ClipCraft Export — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Server-side ffmpeg export that assembles video clips + TTS + BGM into a single mp4 file with optional subtitle burn-in.

**Architecture:** `POST /api/export` triggers an async `Bun.spawn` ffmpeg process. A lightweight `server/ffmpeg.ts` module builds the filter_complex string from storyboard data and parses stderr for progress. Frontend polls `/api/export/:id/status` for progress updates.

**Tech Stack:** ffmpeg (system binary), Bun.spawn, Hono routes

---

## Scope

**In scope:**
- Server-side ffmpeg assembly: concat video clips + mix TTS + mix BGM
- Two quality presets: preview (fast) and final (high quality)
- Optional subtitle burn-in from scene captions
- Progress tracking via polling
- Download endpoint for the output file
- Image-to-video conversion for scenes with static images
- BGM volume + fadeIn/fadeOut
- ffmpeg availability detection with graceful error

**Out of scope:**
- Format selection (mp4 only)
- Resolution selection (uses project.json resolution)
- Browser-side export (WebCodecs — future)
- Transition effects between scenes (cut only for now; crossfade is complex in filter_complex)

---

## API

### `POST /api/export`

Starts an export job asynchronously.

**Request body:**
```json
{
  "quality": "preview" | "final",   // default: "preview"
  "subtitles": true | false          // default: false
}
```

**Response:**
```json
{ "exportId": "export-1712345678" }
```

### `GET /api/export/:id/status`

Poll for export progress.

**Response:**
```json
{
  "status": "running" | "done" | "error",
  "progress": 0.65,          // 0-1
  "output": "export/output.mp4",  // only when done
  "error": "ffmpeg not found"     // only when error
}
```

### `GET /api/export/:id/download`

Streams the output file with `Content-Disposition: attachment`.

---

## Server Module: `server/ffmpeg.ts`

### Interface

```ts
interface ExportOptions {
  workspace: string;
  storyboard: Storyboard;
  project: ProjectConfig;
  quality: "preview" | "final";
  subtitles: boolean;
  onProgress: (progress: number) => void;
}

interface ExportResult {
  outputPath: string;  // absolute path to output.mp4
}

async function detectFfmpeg(): Promise<boolean>
async function exportVideo(options: ExportOptions): Promise<ExportResult>
```

### ffmpeg Command Construction

**Inputs** (dynamic, based on storyboard):
- `-i clip1.mp4 -i clip2.mp4 ...` — video files (or `-loop 1 -t {dur} -i image.png` for stills)
- `-i tts1.wav -i tts2.wav ...` — TTS audio files (only for scenes with audio.status === "ready")
- `-i bgm.mp3` — BGM (if configured)

**filter_complex** (built dynamically):

```
# 1. Video concat — scale all to target resolution first
[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];
[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v1];
[v0][v1]concat=n=2:v=1:a=0[v];

# 2. Video original audio concat (only if videos have audio tracks)
[0:a][1:a]concat=n=2:v=0:a=1[va];

# 3. TTS positioning — adelay to scene start time (ms)
[2:a]adelay=4000|4000[tts0];

# 4. BGM processing — volume + fade
[3:a]volume=0.5,afade=t=in:d=2,afade=t=out:st=6:d=2[bgm];

# 5. Mix all audio
[va][tts0][bgm]amix=inputs=3:duration=first[a]
```

**Output:**
```
-map [v] -map [a]
-c:v libx264 -crf {18|28} -preset {medium|fast}
-c:a aac -b:a 192k
-movflags +faststart
export/output.mp4
```

### Quality Presets

| Preset | CRF | Preset | Use case |
|--------|-----|--------|----------|
| preview | 28 | fast | Quick check, ~2-5s for short videos |
| final | 18 | medium | Shareable quality |

### Image Scenes

Scenes with `visual.type === "image"` or non-video source:
```
-loop 1 -t {duration} -framerate {fps} -i image.png
```
Then scale + pad to target resolution like video scenes.

### Subtitle Burn-in

1. Generate temporary SRT file from scene captions:
```srt
1
00:00:04,000 --> 00:00:08,000
Caption text for scene 2
```

2. Add to filter_complex after video concat:
```
[v]subtitles='{srt_path}':force_style='FontSize=24,FontName=Inter,Outline=2,Shadow=1,MarginV=40'[vsub]
```

3. Use `[vsub]` instead of `[v]` for final output map.

### Progress Parsing

ffmpeg writes progress to stderr:
```
frame=  120 fps= 30 q=28.0 size=    1024kB time=00:00:04.00 bitrate=2048kbits/s speed=2.00x
```

Parse `time=HH:MM:SS.xx` with regex, divide by total duration for 0-1 progress.

### Edge Cases

| Case | Handling |
|------|----------|
| No ready video scenes | Error: "No video scenes to export" |
| Scene has no audio | Skip in audio mix; if no audio at all, output video-only |
| BGM missing volume/fadeIn/fadeOut | Defaults: volume=0.5, fadeIn=0, fadeOut=0 |
| ffmpeg not installed | `detectFfmpeg()` returns false, API returns clear error |
| Export already running | Return existing exportId (one at a time) |
| Video has no audio track | Detect with ffprobe, exclude from audio concat |
| Output file exists | Overwrite (same path each time) |

---

## Frontend Component

**Location:** Inline in VideoPreview controls bar (next to Refresh button).

**States:**
1. **Idle** — "Export" button
2. **Options** — Small inline panel: quality toggle + subtitles checkbox + "Start" button
3. **Running** — Progress bar with percentage
4. **Done** — "Download" button + "Export again" link
5. **Error** — Red message + "Retry" button

**Polling:** When status is "running", poll `/api/export/:id/status` every 500ms. Stop on "done" or "error".

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `server/ffmpeg.ts` | ffmpeg detection, command construction, execution, progress parsing |
| **Modify:** `server/index.ts` | Register export routes (POST /api/export, GET status, GET download) |
| **Create:** `modes/clipcraft/viewer/ExportPanel.tsx` | Export button + inline options + progress UI |
| **Modify:** `modes/clipcraft/viewer/VideoPreview.tsx` | Add ExportPanel to controls bar |
