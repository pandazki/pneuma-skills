// server/ffmpeg.ts — ffmpeg export module for ClipCraft

import { join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import type {
  Storyboard,
  Scene,
  ProjectConfig,
  BGMConfig,
} from "../modes/clipcraft-legacy/types.js";

export interface ExportOptions {
  workspace: string;
  storyboard: Storyboard;
  project: ProjectConfig;
  quality: "preview" | "final";
  subtitles: boolean;
  onProgress: (progress: number) => void; // 0-1
}

export interface ExportResult {
  outputPath: string;
}

// ---------------------------------------------------------------------------
// Detect ffmpeg availability
// ---------------------------------------------------------------------------

export async function detectFfmpeg(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Detect audio tracks via ffprobe
// ---------------------------------------------------------------------------

async function hasAudioTrack(filePath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        "ffprobe",
        "-v",
        "quiet",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().length > 0;
  } catch {
    // ffprobe not available — assume no audio
    return false;
  }
}

// ---------------------------------------------------------------------------
// SRT generation
// ---------------------------------------------------------------------------

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function generateSrt(scenes: Scene[]): string {
  const entries: string[] = [];
  let offset = 0;
  let index = 1;

  for (const scene of scenes) {
    // Coerce caption: agent may write {text, style} object instead of string
    const caption = typeof scene.caption === "string"
      ? scene.caption
      : (scene.caption as any)?.text ?? null;

    if (caption) {
      const start = formatSrtTime(offset);
      const end = formatSrtTime(offset + scene.duration);
      entries.push(`${index}\n${start} --> ${end}\n${caption}`);
      index++;
    }
    offset += scene.duration;
  }

  return entries.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Escape SRT path for ffmpeg subtitles filter
// ---------------------------------------------------------------------------

function escapeSrtPath(p: string): string {
  // ffmpeg subtitles filter requires escaping : \ ' and []
  return p
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\\\\\''")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ---------------------------------------------------------------------------
// Export video
// ---------------------------------------------------------------------------

export async function exportVideo(
  options: ExportOptions,
): Promise<ExportResult> {
  const { workspace, storyboard, project, quality, subtitles, onProgress } =
    options;
  const { width, height } = project.resolution;
  const fps = project.fps;

  // Filter to ready scenes only
  const readyScenes = storyboard.scenes
    .filter(
      (s) => s.visual && s.visual.status === "ready" && s.visual.source,
    )
    .sort((a, b) => a.order - b.order);

  if (readyScenes.length === 0) {
    throw new Error("No ready scenes to export");
  }

  // Quality presets
  const crf = quality === "preview" ? 28 : 18;
  const preset = quality === "preview" ? "fast" : "medium";

  // Total duration for progress calculation
  const totalDuration = readyScenes.reduce((sum, s) => sum + s.duration, 0);

  // Prepare output directory
  const exportDir = join(workspace, "export");
  mkdirSync(exportDir, { recursive: true });
  const outputPath = join(exportDir, "output.mp4");

  // Generate SRT if needed
  let srtPath: string | null = null;
  if (subtitles && readyScenes.some((s) => s.caption)) {
    srtPath = join(exportDir, "subtitles.srt");
    await Bun.write(srtPath, generateSrt(readyScenes));
  }

  // -------------------------------------------------------------------------
  // Build ffmpeg args
  // -------------------------------------------------------------------------

  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  // Map: inputIndex → scene index (for referencing)
  const videoInputIndices: number[] = [];

  // Detect audio tracks for video inputs
  const videoHasAudio: boolean[] = [];

  // --- Video inputs ---
  for (let i = 0; i < readyScenes.length; i++) {
    const scene = readyScenes[i];
    const source = join(workspace, scene.visual!.source!);

    if (scene.visual!.type === "image") {
      inputArgs.push(
        "-loop",
        "1",
        "-t",
        String(scene.duration),
        "-framerate",
        String(fps),
        "-i",
        source,
      );
      videoHasAudio.push(false);
    } else {
      inputArgs.push("-i", source);
      videoHasAudio.push(await hasAudioTrack(source));
    }
    videoInputIndices.push(inputIndex);
    inputIndex++;
  }

  // --- TTS audio inputs ---
  const ttsInputIndices: { inputIdx: number; sceneIdx: number }[] = [];
  let ttsOffset = 0;
  for (let i = 0; i < readyScenes.length; i++) {
    const scene = readyScenes[i];
    if (
      scene.audio &&
      scene.audio.status === "ready" &&
      scene.audio.source
    ) {
      inputArgs.push("-i", join(workspace, scene.audio.source));
      ttsInputIndices.push({ inputIdx: inputIndex, sceneIdx: i });
      inputIndex++;
    }
    if (i < readyScenes.length - 1) {
      ttsOffset += readyScenes[i].duration;
    }
  }

  // --- BGM input ---
  let bgmInputIndex = -1;
  const bgm = storyboard.bgm;
  if (bgm && bgm.source) {
    inputArgs.push("-i", join(workspace, bgm.source));
    bgmInputIndex = inputIndex;
    inputIndex++;
  }

  // -------------------------------------------------------------------------
  // filter_complex
  // -------------------------------------------------------------------------

  // 1. Scale each video input
  for (let i = 0; i < readyScenes.length; i++) {
    const idx = videoInputIndices[i];
    filterParts.push(
      `[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`,
    );
  }

  // 2. Concat all video streams
  let videoLabel: string;
  if (readyScenes.length === 1) {
    videoLabel = "v0";
  } else {
    const concatInputs = readyScenes.map((_, i) => `[v${i}]`).join("");
    filterParts.push(
      `${concatInputs}concat=n=${readyScenes.length}:v=1:a=0[vout]`,
    );
    videoLabel = "vout";
  }

  // 3. Optional subtitle burn-in
  if (srtPath && subtitles) {
    const escaped = escapeSrtPath(srtPath);
    const marginV =
      project.style.captionPosition === "top"
        ? 40
        : project.style.captionPosition === "center"
          ? Math.floor(height / 2 - 20)
          : 40;
    const alignment =
      project.style.captionPosition === "top"
        ? 6
        : project.style.captionPosition === "center"
          ? 5
          : 2;
    filterParts.push(
      `[${videoLabel}]subtitles='${escaped}':force_style='FontSize=42,FontName=${project.style.captionFont || "Inter"},Outline=3,Shadow=2,MarginV=${marginV},Alignment=${alignment},Bold=1'[vsub]`,
    );
    videoLabel = "vsub";
  }

  // 4. Video original audio concat (only videos with audio)
  const videoAudioIndices: number[] = [];
  for (let i = 0; i < readyScenes.length; i++) {
    if (videoHasAudio[i]) {
      videoAudioIndices.push(videoInputIndices[i]);
    }
  }

  let hasVideoAudio = false;
  if (videoAudioIndices.length > 0) {
    if (videoAudioIndices.length === 1) {
      filterParts.push(`[${videoAudioIndices[0]}:a]acopy[va]`);
    } else {
      const vaInputs = videoAudioIndices.map((idx) => `[${idx}:a]`).join("");
      filterParts.push(
        `${vaInputs}concat=n=${videoAudioIndices.length}:v=0:a=1[va]`,
      );
    }
    hasVideoAudio = true;
  }

  // 5. TTS positioning via adelay
  let sceneOffsets = 0;
  const sceneStartTimes: number[] = [];
  for (const scene of readyScenes) {
    sceneStartTimes.push(sceneOffsets);
    sceneOffsets += scene.duration;
  }

  const ttsLabels: string[] = [];
  for (const { inputIdx, sceneIdx } of ttsInputIndices) {
    const delayMs = Math.round(sceneStartTimes[sceneIdx] * 1000);
    const label = `tts${ttsLabels.length}`;
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
    ttsLabels.push(label);
  }

  // 6. BGM processing
  let bgmLabel: string | null = null;
  if (bgmInputIndex >= 0 && bgm) {
    const vol = bgm.volume ?? 0.5;
    const fadeIn = bgm.fadeIn ?? 0;
    const fadeOut = bgm.fadeOut ?? 0;
    const fadeOutStart = Math.max(0, totalDuration - fadeOut);

    let bgmFilter = `[${bgmInputIndex}:a]volume=${vol}`;
    if (fadeIn > 0) {
      bgmFilter += `,afade=t=in:d=${fadeIn}`;
    }
    if (fadeOut > 0) {
      bgmFilter += `,afade=t=out:st=${fadeOutStart}:d=${fadeOut}`;
    }
    bgmFilter += `,atrim=0:${totalDuration}[bgm]`;
    filterParts.push(bgmFilter);
    bgmLabel = "bgm";
  }

  // 7. Mix all audio
  const audioMixInputs: string[] = [];
  if (hasVideoAudio) audioMixInputs.push("[va]");
  for (const label of ttsLabels) audioMixInputs.push(`[${label}]`);
  if (bgmLabel) audioMixInputs.push(`[${bgmLabel}]`);

  let audioLabel: string | null = null;
  if (audioMixInputs.length === 1) {
    // Single audio source — use it directly
    audioLabel = audioMixInputs[0].slice(1, -1); // strip brackets
  } else if (audioMixInputs.length > 1) {
    filterParts.push(
      `${audioMixInputs.join("")}amix=inputs=${audioMixInputs.length}:duration=first:dropout_transition=0[aout]`,
    );
    audioLabel = "aout";
  }

  // -------------------------------------------------------------------------
  // Assemble final ffmpeg command
  // -------------------------------------------------------------------------

  const args: string[] = ["ffmpeg", "-y", ...inputArgs];

  if (filterParts.length > 0) {
    args.push("-filter_complex", filterParts.join(";\n"));
  }

  // Output mapping
  args.push("-map", `[${videoLabel}]`);
  if (audioLabel) {
    args.push("-map", `[${audioLabel}]`);
  }

  // Encoding
  args.push("-c:v", "libx264", "-crf", String(crf), "-preset", preset);
  if (audioLabel) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push("-movflags", "+faststart", outputPath);

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: workspace,
  });

  // Parse stderr for progress
  const progressRegex = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;
  const decoder = new TextDecoder();

  const reader = proc.stderr.getReader();
  let stderrBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      stderrBuffer += decoder.decode(value, { stream: true });

      // Parse latest progress from buffer
      const lines = stderrBuffer.split("\r");
      for (const line of lines) {
        const match = progressRegex.exec(line);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const seconds = parseInt(match[3], 10);
          const centis = parseInt(match[4], 10);
          const currentTime =
            hours * 3600 + minutes * 60 + seconds + centis / 100;
          const progress = Math.min(currentTime / totalDuration, 1);
          onProgress(progress);
        }
      }
      // Keep only the last partial line
      stderrBuffer = lines[lines.length - 1] || "";
    }
  } catch {
    // Stream may close abruptly on error
  }

  const exitCode = await proc.exited;

  // Cleanup temp SRT
  if (srtPath) {
    try {
      unlinkSync(srtPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}`);
  }

  onProgress(1);

  return { outputPath };
}
