# ClipCraft Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a new pneuma mode "clipcraft" for AI-orchestrated video production with storyboard-based workflow, timeline viewer, and pluggable MCP generation tools.

**Architecture:** Storyboard-First approach — agent writes `storyboard.json` describing scenes with typed slots (visual/audio/caption/bgm), calls MCP tools to generate assets, and the viewer renders a video preview + scene strip + track overview. Four MCP servers handle image generation, video generation, TTS, and BGM.

**Tech Stack:** TypeScript, React 19, Zustand (via pneuma store), Hono server, MCP stdio servers (Node.js scripts), fal.ai + OpenAI TTS APIs

**Spec:** `docs/superpowers/specs/2026-04-01-clipcraft-mode-design.md`

---

## File Structure

### New Files

```
modes/clipcraft/
├── manifest.ts                    # ModeManifest — skill, viewer, init, mcpServers config
├── pneuma-mode.ts                 # ModeDefinition — binds manifest + viewer
├── types.ts                       # Shared types: Storyboard, Scene, Visual, Audio, etc.
├── viewer/
│   ├── ClipCraftPreview.tsx        # Root viewer component (layout + state)
│   ├── VideoPreview.tsx            # Video preview player (top zone)
│   ├── SceneStrip.tsx              # Horizontal scene cards (middle zone)
│   ├── TrackOverview.tsx           # Simplified multi-track display (bottom zone)
│   ├── SceneCard.tsx               # Individual scene card component
│   └── useStoryboard.ts           # Hook: parse storyboard.json from files
├── skill/
│   ├── SKILL.md                   # Main skill file
│   └── rules/
│       ├── storyboard-protocol.md  # How to read/write storyboard.json
│       ├── scene-generation.md     # Scene generation strategies
│       ├── character-consistency.md # Character reference management
│       └── error-recovery.md       # Degradation strategies
├── seed/
│   └── default/
│       ├── project.json            # Default project metadata
│       ├── storyboard.json         # Empty storyboard template
│       └── assets/                 # Empty asset directories
│           ├── reference/.gitkeep
│           ├── images/.gitkeep
│           ├── clips/.gitkeep
│           ├── audio/.gitkeep
│           └── bgm/.gitkeep
└── scripts/
    ├── clipcraft-imagegen.mjs      # MCP server: image generation
    ├── clipcraft-videogen.mjs      # MCP server: video generation (stub)
    ├── clipcraft-tts.mjs           # MCP server: text-to-speech
    └── clipcraft-bgm.mjs           # MCP server: BGM search (stub)
```

### Modified Files

```
core/mode-loader.ts                # Add clipcraft to builtinModes registry
CLAUDE.md                          # Add clipcraft to builtin modes list
```

---

## Task 1: Types and Data Model

**Files:**
- Create: `modes/clipcraft/types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// modes/clipcraft/types.ts

/** Asset generation status lifecycle */
export type AssetStatus = "pending" | "generating" | "ready" | "error";

/** Transition between scenes */
export interface SceneTransition {
  type: "cut" | "crossfade" | "fade-to-black";
  duration: number; // seconds
}

/** Visual slot — image or video clip */
export interface SceneVisual {
  type: "image" | "video";
  status: AssetStatus;
  source?: string; // relative path to asset file
  prompt?: string;
  model?: string;
  thumbnail?: string; // relative path to thumbnail
  errorMessage?: string;
}

/** Audio slot — TTS voiceover */
export interface SceneAudio {
  type: "tts";
  status: AssetStatus;
  text: string;
  voice?: string; // voice ID
  source?: string;
  model?: string;
  duration?: number; // seconds, computed after generation
  errorMessage?: string;
}

/** A single scene in the storyboard */
export interface Scene {
  id: string;
  order: number;
  duration: number; // seconds
  visual: SceneVisual | null;
  audio: SceneAudio | null;
  caption: string | null;
  transition: SceneTransition;
}

/** Background music config */
export interface BGMConfig {
  source: string;
  title: string;
  volume: number; // 0.0 - 1.0
  fadeIn: number; // seconds
  fadeOut: number;
}

/** Character reference for consistency */
export interface CharacterRef {
  id: string;
  name: string;
  referenceSheet?: string; // path to reference image
  description: string;
}

/** The storyboard — root data model */
export interface Storyboard {
  version: number;
  scenes: Scene[];
  bgm: BGMConfig | null;
  characterRefs: CharacterRef[];
}

/** Project metadata */
export interface ProjectConfig {
  title: string;
  aspectRatio: string; // "16:9", "9:16", "1:1"
  resolution: { width: number; height: number };
  fps: number;
  style: {
    captionFont: string;
    captionPosition: "top" | "bottom" | "center";
    captionStyle: "outline" | "background" | "plain";
  };
}

/** Aspect ratio presets */
export const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
};
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/types.ts
git commit -m "feat(clipcraft): add shared types for storyboard data model"
```

---

## Task 2: Manifest

**Files:**
- Create: `modes/clipcraft/manifest.ts`

- [ ] **Step 1: Create the manifest**

```typescript
// modes/clipcraft/manifest.ts
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const clipcraftManifest: ModeManifest = {
  name: "clipcraft",
  version: "0.1.0",
  displayName: "ClipCraft",
  description: "AI-orchestrated video production — describe your vision, generate clips, assemble on a timeline",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/><line x1="2" y1="14" x2="22" y2="14" opacity="0.3"/></svg>`,
  inspiredBy: {
    name: "medeo.app",
    url: "https://medeo.app",
  },
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user produce videos together — you orchestrate AI generation, the user sees results in a live storyboard viewer.

This is **ClipCraft Mode**: AI-orchestrated video production with storyboard-based workflow.

For the full workflow, storyboard protocol, scene generation patterns, and error recovery strategies, consult the \`pneuma-clipcraft\` skill. Read it before your first generation in a new conversation.

### Architecture
- \`project.json\` — Project metadata (title, aspect ratio, resolution, style)
- \`storyboard.json\` — Scene sequence (the source of truth)
- \`assets/\` — Generated assets organized by type (reference/, images/, clips/, audio/, bgm/)

### Core Rules
- Always update \`storyboard.json\` after generating — write placeholder with \`"status": "generating"\` first, then update when done
- Each scene has typed slots: \`visual\` (image/video), \`audio\` (TTS), \`caption\` (text), \`transition\`
- Use \`characterRefs\` to maintain character consistency across scenes
- When user asks to change one scene, only regenerate that scene's slot — don't rebuild the whole storyboard
- Do not ask for confirmation on simple generations — just do them
- Default aspect ratio: {{aspectRatio}}

### Storyboard Protocol
1. Read current \`storyboard.json\`
2. Add/update scene with \`status: "generating"\` (viewer shows spinner)
3. Call MCP tool to generate asset
4. On success: update \`status: "ready"\` + \`source\` path + \`thumbnail\`
5. On failure: update \`status: "error"\` + \`errorMessage\`, attempt fallback strategy

### Available MCP Tools
{{#imageGenEnabled}}
- **clipcraft-imagegen**: \`generate_image\`, \`edit_image\` — Image generation via {{imageProvider}}
{{/imageGenEnabled}}
{{#videoGenEnabled}}
- **clipcraft-videogen**: \`generate_video_from_text\`, \`generate_video_from_image\` — Video generation via {{videoProvider}}
{{/videoGenEnabled}}
{{#ttsEnabled}}
- **clipcraft-tts**: \`generate_speech\`, \`list_voices\` — Text-to-speech via {{ttsProvider}}
{{/ttsEnabled}}
{{#bgmEnabled}}
- **clipcraft-bgm**: \`search_music\`, \`download_track\` — Background music search
{{/bgmEnabled}}

### Viewer Capabilities
The viewer provides these agent-callable actions:
- \`play-preview\` — Start playback
- \`pause-preview\` — Pause playback
- \`select-scene\` — Navigate to a specific scene (\`params: { sceneId: string }\`)
- \`set-aspect-ratio\` — Change aspect ratio (\`params: { ratio: string }\`)

### Constraints
- Do not modify \`.claude/\`, \`.pneuma/\`, or \`node_modules/\`
- Save all generated assets under \`assets/\` with descriptive filenames
- Keep \`storyboard.json\` as the single source of truth
- Scene IDs must be stable (format: \`scene-NNN\`)`,
    envMapping: {
      IMAGE_PROVIDER: "imageProvider",
      IMAGE_API_KEY: "imageApiKey",
      VIDEO_PROVIDER: "videoProvider",
      VIDEO_API_KEY: "videoApiKey",
      TTS_PROVIDER: "ttsProvider",
      TTS_API_KEY: "ttsApiKey",
      BGM_PROVIDER: "bgmProvider",
      BGM_API_KEY: "bgmApiKey",
    },
    mcpServers: [
      {
        name: "clipcraft-imagegen",
        command: "node",
        args: ["scripts/clipcraft-imagegen.mjs"],
        env: {
          PROVIDER: "{{imageProvider}}",
          API_KEY: "{{imageApiKey}}",
        },
      },
      {
        name: "clipcraft-videogen",
        command: "node",
        args: ["scripts/clipcraft-videogen.mjs"],
        env: {
          PROVIDER: "{{videoProvider}}",
          API_KEY: "{{videoApiKey}}",
        },
      },
      {
        name: "clipcraft-tts",
        command: "node",
        args: ["scripts/clipcraft-tts.mjs"],
        env: {
          PROVIDER: "{{ttsProvider}}",
          API_KEY: "{{ttsApiKey}}",
        },
      },
      {
        name: "clipcraft-bgm",
        command: "node",
        args: ["scripts/clipcraft-bgm.mjs"],
        env: {
          PROVIDER: "{{bgmProvider}}",
          API_KEY: "{{bgmApiKey}}",
        },
      },
    ],
  },

  viewer: {
    watchPatterns: [
      "project.json",
      "storyboard.json",
      "assets/**/*",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "export/**",
      "scripts/**",
    ],
    serveDir: ".",
  },

  viewerApi: {
    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "play-preview",
        label: "Play",
        category: "ui",
        agentInvocable: true,
        description: "Start video preview playback",
      },
      {
        id: "pause-preview",
        label: "Pause",
        category: "ui",
        agentInvocable: true,
        description: "Pause video preview playback",
      },
      {
        id: "select-scene",
        label: "Select Scene",
        category: "navigate",
        agentInvocable: true,
        params: {
          sceneId: { type: "string", description: "Scene ID to select", required: true },
        },
        description: "Navigate to and select a specific scene",
      },
      {
        id: "set-aspect-ratio",
        label: "Set Aspect Ratio",
        category: "ui",
        agentInvocable: true,
        params: {
          ratio: { type: "string", description: "Aspect ratio: 16:9, 9:16, or 1:1", required: true },
        },
        description: "Change the preview aspect ratio",
      },
    ],
    commands: [
      { id: "regenerate-scene", label: "Regenerate Scene", description: "Regenerate the selected scene's visual" },
      { id: "add-scene-after", label: "Add Scene After", description: "Insert a new scene after the selected one" },
      { id: "remove-scene", label: "Remove Scene", description: "Delete the selected scene" },
      { id: "regenerate-audio", label: "Regenerate Audio", description: "Re-generate TTS for the selected scene" },
    ],
    locatorDescription: 'Navigate to scene: data=\'{"scene":"scene-001"}\'. Auto-play from scene: data=\'{"scene":"scene-001","autoplay":true}\'.',
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="ClipCraft" backend="claude-code">New ClipCraft session started. The viewer is ready — describe your video idea and I'll orchestrate the production pipeline.</system-info>`,
  },

  init: {
    contentCheckPattern: "storyboard.json",
    seedFiles: {
      "modes/clipcraft/seed/default/": "./",
    },
    params: [
      { name: "aspectRatio", label: "Default aspect ratio", description: "16:9, 9:16, or 1:1", type: "string", defaultValue: "16:9" },
      { name: "imageProvider", label: "Image generation provider", description: "fal, openrouter, or replicate", type: "string", defaultValue: "fal" },
      { name: "imageApiKey", label: "Image provider API key", type: "string", defaultValue: "", sensitive: true },
      { name: "videoProvider", label: "Video generation provider", description: "fal, replicate, or none", type: "string", defaultValue: "fal" },
      { name: "videoApiKey", label: "Video provider API key", type: "string", defaultValue: "", sensitive: true },
      { name: "ttsProvider", label: "TTS provider", description: "openai, elevenlabs, or none", type: "string", defaultValue: "openai" },
      { name: "ttsApiKey", label: "TTS API key", type: "string", defaultValue: "", sensitive: true },
      { name: "bgmProvider", label: "BGM provider", description: "freesound or none", type: "string", defaultValue: "freesound" },
      { name: "bgmApiKey", label: "BGM API key", type: "string", defaultValue: "", sensitive: true },
    ],
    deriveParams: (params: Record<string, number | string>) => ({
      ...params,
      imageGenEnabled: params.imageApiKey ? "true" : "",
      videoGenEnabled: params.videoApiKey ? "true" : "",
      ttsEnabled: params.ttsApiKey ? "true" : "",
      bgmEnabled: params.bgmApiKey ? "true" : "",
    }),
  },

  evolution: {
    directive:
      "Extract the user's video style preferences: pacing, shot composition, color grading, music taste, narration style, transition preferences, aspect ratio patterns, and content themes.",
  },
};

export default clipcraftManifest;
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/manifest.ts
git commit -m "feat(clipcraft): add mode manifest with MCP server declarations"
```

---

## Task 3: Seed Files

**Files:**
- Create: `modes/clipcraft/seed/default/project.json`
- Create: `modes/clipcraft/seed/default/storyboard.json`
- Create: `modes/clipcraft/seed/default/assets/reference/.gitkeep`
- Create: `modes/clipcraft/seed/default/assets/images/.gitkeep`
- Create: `modes/clipcraft/seed/default/assets/clips/.gitkeep`
- Create: `modes/clipcraft/seed/default/assets/audio/.gitkeep`
- Create: `modes/clipcraft/seed/default/assets/bgm/.gitkeep`

- [ ] **Step 1: Create project.json seed**

```json
{
  "title": "Untitled Video",
  "aspectRatio": "{{aspectRatio}}",
  "resolution": { "width": 1920, "height": 1080 },
  "fps": 30,
  "style": {
    "captionFont": "Inter",
    "captionPosition": "bottom",
    "captionStyle": "outline"
  }
}
```

- [ ] **Step 2: Create storyboard.json seed**

```json
{
  "version": 1,
  "scenes": [],
  "bgm": null,
  "characterRefs": []
}
```

- [ ] **Step 3: Create .gitkeep files for asset directories**

Create empty `.gitkeep` files in each asset subdirectory.

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/seed/
git commit -m "feat(clipcraft): add seed files for new workspace initialization"
```

---

## Task 4: Storyboard Hook

**Files:**
- Create: `modes/clipcraft/viewer/useStoryboard.ts`

- [ ] **Step 1: Create the useStoryboard hook**

This hook parses storyboard.json and project.json from the viewer's file list.

```typescript
// modes/clipcraft/viewer/useStoryboard.ts
import { useMemo } from "react";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import type { Storyboard, ProjectConfig } from "../types.js";

const DEFAULT_PROJECT: ProjectConfig = {
  title: "Untitled Video",
  aspectRatio: "16:9",
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  style: {
    captionFont: "Inter",
    captionPosition: "bottom",
    captionStyle: "outline",
  },
};

const EMPTY_STORYBOARD: Storyboard = {
  version: 1,
  scenes: [],
  bgm: null,
  characterRefs: [],
};

function parseJSON<T>(files: ViewerFileContent[], filename: string, fallback: T): T {
  const file = files.find(
    (f) => f.path === filename || f.path.endsWith(`/${filename}`),
  );
  if (!file) return fallback;
  try {
    return JSON.parse(file.content) as T;
  } catch {
    return fallback;
  }
}

export function useStoryboard(files: ViewerFileContent[]) {
  const project = useMemo(
    () => parseJSON<ProjectConfig>(files, "project.json", DEFAULT_PROJECT),
    [files],
  );

  const storyboard = useMemo(
    () => parseJSON<Storyboard>(files, "storyboard.json", EMPTY_STORYBOARD),
    [files],
  );

  const sortedScenes = useMemo(
    () => [...storyboard.scenes].sort((a, b) => a.order - b.order),
    [storyboard],
  );

  const totalDuration = useMemo(
    () => sortedScenes.reduce((sum, s) => sum + s.duration, 0),
    [sortedScenes],
  );

  return { project, storyboard, sortedScenes, totalDuration };
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/viewer/useStoryboard.ts
git commit -m "feat(clipcraft): add useStoryboard hook for parsing project data"
```

---

## Task 5: SceneCard Component

**Files:**
- Create: `modes/clipcraft/viewer/SceneCard.tsx`

- [ ] **Step 1: Create SceneCard**

```tsx
// modes/clipcraft/viewer/SceneCard.tsx
import type { Scene } from "../types.js";

interface SceneCardProps {
  scene: Scene;
  index: number;
  isSelected: boolean;
  onSelect: (sceneId: string) => void;
  /** Base URL for serving workspace assets (e.g. http://localhost:17007) */
  assetBaseUrl: string;
}

export function SceneCard({ scene, index, isSelected, onSelect, assetBaseUrl }: SceneCardProps) {
  const status = scene.visual?.status ?? "pending";

  return (
    <div
      onClick={() => onSelect(scene.id)}
      style={{
        flex: "0 0 160px",
        height: "100%",
        borderRadius: 8,
        overflow: "hidden",
        border: isSelected ? "2px solid #f97316" : "2px solid transparent",
        background: "#18181b",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.15s",
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          background: "#0a0a0a",
        }}
      >
        {status === "ready" && scene.visual?.thumbnail ? (
          <img
            src={`${assetBaseUrl}/${scene.visual.thumbnail}`}
            alt={`Scene ${index + 1}`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : status === "generating" ? (
          <div style={{ color: "#a1a1aa", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>⏳</div>
            Generating...
          </div>
        ) : status === "error" ? (
          <div style={{ color: "#ef4444", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>⚠️</div>
            Error
          </div>
        ) : (
          <div style={{ color: "#71717a", fontSize: 12, textAlign: "center", padding: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>🎬</div>
            Pending
          </div>
        )}

        {/* Duration badge */}
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 4,
            background: "rgba(0,0,0,0.7)",
            color: "#e4e4e7",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          {scene.duration.toFixed(1)}s
        </div>
      </div>

      {/* Scene label */}
      <div
        style={{
          padding: "4px 8px",
          fontSize: 11,
          color: "#a1a1aa",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Scene {index + 1}
        {scene.caption ? ` — ${scene.caption.slice(0, 30)}` : ""}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/viewer/SceneCard.tsx
git commit -m "feat(clipcraft): add SceneCard component with status indicators"
```

---

## Task 6: VideoPreview Component

**Files:**
- Create: `modes/clipcraft/viewer/VideoPreview.tsx`

- [ ] **Step 1: Create VideoPreview**

For the MVP, this shows the selected scene's thumbnail/video or a placeholder. Full playback sequencing is a stretch goal.

```tsx
// modes/clipcraft/viewer/VideoPreview.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import type { Scene, ProjectConfig } from "../types.js";
import { ASPECT_RATIOS } from "../types.js";

interface VideoPreviewProps {
  scenes: Scene[];
  selectedSceneId: string | null;
  project: ProjectConfig;
  totalDuration: number;
  assetBaseUrl: string;
  onAspectRatioChange?: (ratio: string) => void;
}

export function VideoPreview({
  scenes,
  selectedSceneId,
  project,
  totalDuration,
  assetBaseUrl,
  onAspectRatioChange,
}: VideoPreviewProps) {
  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? scenes[0] ?? null;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Aspect ratio dimensions for preview sizing
  const ar = ASPECT_RATIOS[project.aspectRatio] ?? ASPECT_RATIOS["16:9"];
  const aspectRatio = ar.width / ar.height;

  // Simple sequential playback: advance to next scene when video ends
  const activeScene = isPlaying ? scenes[currentSceneIndex] : selectedScene;

  const handleVideoEnd = useCallback(() => {
    if (currentSceneIndex < scenes.length - 1) {
      setCurrentSceneIndex((i) => i + 1);
    } else {
      setIsPlaying(false);
      setCurrentSceneIndex(0);
    }
  }, [currentSceneIndex, scenes.length]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      videoRef.current?.pause();
    } else {
      setIsPlaying(true);
      const idx = selectedScene ? scenes.indexOf(selectedScene) : 0;
      setCurrentSceneIndex(Math.max(0, idx));
    }
  }, [isPlaying, selectedScene, scenes]);

  // Auto-play video when scene changes during playback
  useEffect(() => {
    if (isPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [isPlaying, currentSceneIndex]);

  const renderVisual = () => {
    if (!activeScene) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#71717a" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎬</div>
            <div>No scenes yet — describe your video idea to get started</div>
          </div>
        </div>
      );
    }

    const visual = activeScene.visual;
    if (!visual || visual.status === "pending") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#71717a" }}>
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14 }}>{visual?.prompt ?? "Waiting for content..."}</div>
          </div>
        </div>
      );
    }

    if (visual.status === "generating") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#a1a1aa" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8, animation: "spin 2s linear infinite" }}>⏳</div>
            <div style={{ fontSize: 13 }}>Generating...</div>
            {visual.prompt && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7, maxWidth: 300 }}>{visual.prompt}</div>}
          </div>
        </div>
      );
    }

    if (visual.status === "error") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#ef4444" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 13 }}>{visual.errorMessage ?? "Generation failed"}</div>
          </div>
        </div>
      );
    }

    // Ready state
    if (visual.type === "video" && visual.source) {
      return (
        <video
          ref={videoRef}
          src={`${assetBaseUrl}/${visual.source}`}
          onEnded={handleVideoEnd}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          playsInline
        />
      );
    }

    if (visual.source) {
      const src = visual.thumbnail ?? visual.source;
      return (
        <img
          src={`${assetBaseUrl}/${src}`}
          alt={`Scene ${activeScene.id}`}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      );
    }

    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#09090b" }}>
      {/* Preview area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspectRatio}`,
            background: "#0a0a0a",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {renderVisual()}
        </div>
      </div>

      {/* Controls bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderTop: "1px solid #27272a",
          fontSize: 12,
          color: "#a1a1aa",
        }}
      >
        <button
          onClick={togglePlay}
          style={{
            background: "none",
            border: "none",
            color: "#e4e4e7",
            cursor: "pointer",
            fontSize: 18,
            padding: 0,
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <span style={{ fontFamily: "monospace" }}>
          {totalDuration.toFixed(1)}s
        </span>

        <div style={{ flex: 1 }} />

        {/* Aspect ratio selector */}
        {["16:9", "9:16", "1:1"].map((ratio) => (
          <button
            key={ratio}
            onClick={() => onAspectRatioChange?.(ratio)}
            style={{
              background: project.aspectRatio === ratio ? "#27272a" : "none",
              border: "1px solid #3f3f46",
              borderRadius: 4,
              color: project.aspectRatio === ratio ? "#f97316" : "#71717a",
              cursor: "pointer",
              padding: "2px 8px",
              fontSize: 11,
            }}
          >
            {ratio}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/viewer/VideoPreview.tsx
git commit -m "feat(clipcraft): add VideoPreview component with playback controls"
```

---

## Task 7: SceneStrip Component

**Files:**
- Create: `modes/clipcraft/viewer/SceneStrip.tsx`

- [ ] **Step 1: Create SceneStrip**

```tsx
// modes/clipcraft/viewer/SceneStrip.tsx
import type { Scene } from "../types.js";
import { SceneCard } from "./SceneCard.js";

interface SceneStripProps {
  scenes: Scene[];
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  assetBaseUrl: string;
}

export function SceneStrip({ scenes, selectedSceneId, onSelectScene, assetBaseUrl }: SceneStripProps) {
  if (scenes.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#52525b",
          fontSize: 13,
        }}
      >
        No scenes yet — the agent will add them as it generates your video
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 12px",
        height: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        alignItems: "stretch",
      }}
    >
      {scenes.map((scene, i) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          index={i}
          isSelected={scene.id === selectedSceneId}
          onSelect={onSelectScene}
          assetBaseUrl={assetBaseUrl}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/viewer/SceneStrip.tsx
git commit -m "feat(clipcraft): add SceneStrip horizontal scroll component"
```

---

## Task 8: TrackOverview Component

**Files:**
- Create: `modes/clipcraft/viewer/TrackOverview.tsx`

- [ ] **Step 1: Create TrackOverview**

```tsx
// modes/clipcraft/viewer/TrackOverview.tsx
import type { Scene, BGMConfig } from "../types.js";

interface TrackOverviewProps {
  scenes: Scene[];
  bgm: BGMConfig | null;
  totalDuration: number;
  selectedSceneId: string | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function TrackOverview({ scenes, bgm, totalDuration, selectedSceneId }: TrackOverviewProps) {
  if (scenes.length === 0 && !bgm) return null;

  const duration = Math.max(totalDuration, 1);

  return (
    <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "#a1a1aa" }}>
      {/* Time ruler */}
      <div style={{ display: "flex", position: "relative", height: 16, borderBottom: "1px solid #27272a", marginBottom: 4 }}>
        {Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, i) => i * 5).map((t) => (
          <span
            key={t}
            style={{
              position: "absolute",
              left: `${(t / duration) * 100}%`,
              fontSize: 9,
              color: "#52525b",
              transform: "translateX(-50%)",
            }}
          >
            {formatTime(t)}
          </span>
        ))}
      </div>

      {/* Caption track */}
      <div style={{ display: "flex", alignItems: "center", height: 20, gap: 1 }}>
        <span style={{ width: 24, fontSize: 10, color: "#71717a", flexShrink: 0 }}>Tt</span>
        <div style={{ flex: 1, display: "flex", height: 16, gap: 1 }}>
          {scenes.map((scene) => (
            <div
              key={scene.id}
              style={{
                flex: `0 0 ${(scene.duration / duration) * 100}%`,
                background: scene.id === selectedSceneId ? "#3f3f46" : "#27272a",
                borderRadius: 2,
                overflow: "hidden",
                padding: "0 4px",
                fontSize: 9,
                lineHeight: "16px",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                color: scene.caption ? "#a1a1aa" : "#3f3f46",
              }}
            >
              {scene.caption ?? ""}
            </div>
          ))}
        </div>
      </div>

      {/* Video track */}
      <div style={{ display: "flex", alignItems: "center", height: 20, gap: 1 }}>
        <span style={{ width: 24, fontSize: 10, color: "#71717a", flexShrink: 0 }}>🎬</span>
        <div style={{ flex: 1, display: "flex", height: 16, gap: 1 }}>
          {scenes.map((scene) => {
            const status = scene.visual?.status ?? "pending";
            const colors: Record<string, string> = {
              pending: "#1c1c1e",
              generating: "#422006",
              ready: "#14532d",
              error: "#450a0a",
            };
            return (
              <div
                key={scene.id}
                style={{
                  flex: `0 0 ${(scene.duration / duration) * 100}%`,
                  background: colors[status] ?? "#27272a",
                  borderRadius: 2,
                  border: scene.id === selectedSceneId ? "1px solid #f97316" : "1px solid transparent",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Audio track */}
      <div style={{ display: "flex", alignItems: "center", height: 20, gap: 1 }}>
        <span style={{ width: 24, fontSize: 10, color: "#71717a", flexShrink: 0 }}>🔊</span>
        <div style={{ flex: 1, display: "flex", height: 16, gap: 1 }}>
          {scenes.map((scene) => {
            const hasAudio = scene.audio?.status === "ready";
            return (
              <div
                key={scene.id}
                style={{
                  flex: `0 0 ${(scene.duration / duration) * 100}%`,
                  background: hasAudio ? "#1e3a5f" : "#1c1c1e",
                  borderRadius: 2,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* BGM track */}
      {bgm && (
        <div style={{ display: "flex", alignItems: "center", height: 20 }}>
          <span style={{ width: 24, fontSize: 10, color: "#71717a", flexShrink: 0 }}>♪</span>
          <div
            style={{
              flex: 1,
              height: 16,
              background: "#2e1065",
              borderRadius: 2,
              padding: "0 6px",
              fontSize: 9,
              lineHeight: "16px",
              color: "#a78bfa",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {bgm.title}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/clipcraft/viewer/TrackOverview.tsx
git commit -m "feat(clipcraft): add TrackOverview multi-track display"
```

---

## Task 9: Root Viewer (ClipCraftPreview) + pneuma-mode.ts

**Files:**
- Create: `modes/clipcraft/viewer/ClipCraftPreview.tsx`
- Create: `modes/clipcraft/pneuma-mode.ts`

- [ ] **Step 1: Create ClipCraftPreview**

```tsx
// modes/clipcraft/viewer/ClipCraftPreview.tsx
import { useState, useCallback, useEffect } from "react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useStoryboard } from "./useStoryboard.js";
import { VideoPreview } from "./VideoPreview.js";
import { SceneStrip } from "./SceneStrip.js";
import { TrackOverview } from "./TrackOverview.js";

export default function ClipCraftPreview({
  files,
  selection,
  onSelect,
  actionRequest,
  onActionResult,
  navigateRequest,
  onNavigateComplete,
  onNotifyAgent,
  commands,
  initParams,
}: ViewerPreviewProps) {
  const { project, storyboard, sortedScenes, totalDuration } = useStoryboard(files);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  // Determine asset base URL from current page location
  const assetBaseUrl = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
    : "";

  // Handle scene selection → send context to agent
  const handleSelectScene = useCallback(
    (sceneId: string) => {
      setSelectedSceneId(sceneId);
      const scene = sortedScenes.find((s) => s.id === sceneId);
      if (scene && onSelect) {
        onSelect({
          type: "scene",
          content: JSON.stringify(scene, null, 2),
          file: "storyboard.json",
          label: `Scene ${sortedScenes.indexOf(scene) + 1}${scene.caption ? `: ${scene.caption.slice(0, 50)}` : ""}`,
        });
      }
    },
    [sortedScenes, onSelect],
  );

  // Handle locator navigation requests
  useEffect(() => {
    if (navigateRequest?.data?.scene) {
      const sceneId = navigateRequest.data.scene as string;
      setSelectedSceneId(sceneId);
      onNavigateComplete?.();
    }
  }, [navigateRequest, onNavigateComplete]);

  // Handle action requests from agent
  useEffect(() => {
    if (!actionRequest) return;
    const { requestId, actionId, params } = actionRequest;

    switch (actionId) {
      case "select-scene":
        if (params?.sceneId) {
          setSelectedSceneId(params.sceneId as string);
          onActionResult?.(requestId, { success: true });
        } else {
          onActionResult?.(requestId, { success: false, message: "Missing sceneId" });
        }
        break;
      case "play-preview":
      case "pause-preview":
        // Handled by VideoPreview internally via state
        onActionResult?.(requestId, { success: true });
        break;
      case "set-aspect-ratio":
        // This would need to write to project.json — for now acknowledge
        onActionResult?.(requestId, { success: true, message: "Aspect ratio change acknowledged — update project.json" });
        break;
      default:
        onActionResult?.(requestId, { success: false, message: `Unknown action: ${actionId}` });
    }
  }, [actionRequest, onActionResult]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#09090b",
        color: "#e4e4e7",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Zone 1: Video Preview */}
      <div style={{ flex: "1 1 50%", minHeight: 0, borderBottom: "1px solid #27272a" }}>
        <VideoPreview
          scenes={sortedScenes}
          selectedSceneId={selectedSceneId}
          project={project}
          totalDuration={totalDuration}
          assetBaseUrl={assetBaseUrl}
        />
      </div>

      {/* Zone 2: Scene Strip */}
      <div style={{ flex: "0 0 140px", borderBottom: "1px solid #27272a" }}>
        <SceneStrip
          scenes={sortedScenes}
          selectedSceneId={selectedSceneId}
          onSelectScene={handleSelectScene}
          assetBaseUrl={assetBaseUrl}
        />
      </div>

      {/* Zone 3: Track Overview */}
      <div style={{ flex: "0 0 auto", minHeight: 0 }}>
        <TrackOverview
          scenes={sortedScenes}
          bgm={storyboard.bgm}
          totalDuration={totalDuration}
          selectedSceneId={selectedSceneId}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create pneuma-mode.ts**

```typescript
// modes/clipcraft/pneuma-mode.ts
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import ClipCraftPreview from "./viewer/ClipCraftPreview.js";
import clipcraftManifest from "./manifest.js";
import type { Storyboard, ProjectConfig } from "./types.js";

function parseJSON<T>(files: ViewerFileContent[], filename: string): T | null {
  const file = files.find(
    (f) => f.path === filename || f.path.endsWith(`/${filename}`),
  );
  if (!file) return null;
  try {
    return JSON.parse(file.content) as T;
  } catch {
    return null;
  }
}

const clipcraftMode: ModeDefinition = {
  manifest: clipcraftManifest,

  viewer: {
    PreviewComponent: ClipCraftPreview,

    workspace: {
      type: "single",
      multiFile: true,
      ordered: true,
      hasActiveFile: false,
    },

    actions: clipcraftManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const storyboard = parseJSON<Storyboard>(files, "storyboard.json");
      const project = parseJSON<ProjectConfig>(files, "project.json");

      // Scene selected
      if (selection?.type === "scene" && selection.content) {
        const attrs = [`mode="clipcraft"`, `file="storyboard.json"`];
        return `<viewer-context ${attrs.join(" ")}>\nSelected scene:\n${selection.content}\n</viewer-context>`;
      }

      // No selection — project overview
      if (storyboard) {
        const lines: string[] = [];
        if (project) lines.push(`Project: "${project.title}" (${project.aspectRatio})`);
        lines.push(`Scenes: ${storyboard.scenes.length}`);

        const ready = storyboard.scenes.filter((s) => s.visual?.status === "ready").length;
        const generating = storyboard.scenes.filter((s) => s.visual?.status === "generating").length;
        const pending = storyboard.scenes.filter((s) => !s.visual || s.visual.status === "pending").length;
        const errored = storyboard.scenes.filter((s) => s.visual?.status === "error").length;

        if (ready) lines.push(`Ready: ${ready}`);
        if (generating) lines.push(`Generating: ${generating}`);
        if (pending) lines.push(`Pending: ${pending}`);
        if (errored) lines.push(`Errors: ${errored}`);

        if (storyboard.bgm) lines.push(`BGM: "${storyboard.bgm.title}"`);
        if (storyboard.characterRefs.length) {
          lines.push(`Characters: ${storyboard.characterRefs.map((c) => c.name).join(", ")}`);
        }

        const totalDur = storyboard.scenes.reduce((s, sc) => s + sc.duration, 0);
        lines.push(`Total duration: ${totalDur.toFixed(1)}s`);

        return `<viewer-context mode="clipcraft">\n${lines.join("\n")}\n</viewer-context>`;
      }

      return "";
    },

    updateStrategy: "full-reload",

    locatorDescription:
      'Navigate to scene: data=\'{"scene":"scene-001"}\'. Auto-play from scene: data=\'{"scene":"scene-001","autoplay":true}\'.',
  },
};

export default clipcraftMode;
```

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/ClipCraftPreview.tsx modes/clipcraft/pneuma-mode.ts
git commit -m "feat(clipcraft): add root viewer component and mode definition"
```

---

## Task 10: Agent Skill Files

**Files:**
- Create: `modes/clipcraft/skill/SKILL.md`
- Create: `modes/clipcraft/skill/rules/storyboard-protocol.md`
- Create: `modes/clipcraft/skill/rules/scene-generation.md`
- Create: `modes/clipcraft/skill/rules/character-consistency.md`
- Create: `modes/clipcraft/skill/rules/error-recovery.md`

- [ ] **Step 1: Create SKILL.md**

Main skill file with metadata and core guidance. Full content for the agent to learn the ClipCraft workflow.

- [ ] **Step 2: Create rules/**

One rule file per topic:
- `storyboard-protocol.md` — exact JSON structure, read/write protocol, status lifecycle
- `scene-generation.md` — strategies for image vs video, prompt crafting, aspect ratio handling
- `character-consistency.md` — reference sheet generation, using characterRefs in prompts
- `error-recovery.md` — fallback chains, content moderation workarounds, provider switching

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/skill/
git commit -m "feat(clipcraft): add agent skill files with workflow rules"
```

---

## Task 11: MCP Server Scripts

**Files:**
- Create: `modes/clipcraft/scripts/clipcraft-imagegen.mjs`
- Create: `modes/clipcraft/scripts/clipcraft-videogen.mjs`
- Create: `modes/clipcraft/scripts/clipcraft-tts.mjs`
- Create: `modes/clipcraft/scripts/clipcraft-bgm.mjs`

- [ ] **Step 1: Create clipcraft-imagegen.mjs**

Full MCP stdio server implementing `generate_image` and `edit_image` tools. Supports fal.ai provider (Flux model). Uses the MCP SDK protocol: reads JSON-RPC from stdin, writes to stdout.

- [ ] **Step 2: Create clipcraft-tts.mjs**

Full MCP stdio server implementing `generate_speech` and `list_voices`. Supports OpenAI TTS provider.

- [ ] **Step 3: Create clipcraft-videogen.mjs (stub)**

Stub MCP server that returns helpful error messages suggesting the user configure a video provider. Implements `generate_video_from_text` and `generate_video_from_image` tool schemas but returns stub results.

- [ ] **Step 4: Create clipcraft-bgm.mjs (stub)**

Stub MCP server for `search_music` and `download_track`. Returns placeholder results.

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/scripts/
git commit -m "feat(clipcraft): add MCP server scripts for generation tools"
```

---

## Task 12: Register Mode + Update CLAUDE.md

**Files:**
- Modify: `core/mode-loader.ts:91` (add clipcraft entry after gridboard)
- Modify: `CLAUDE.md:11` (add clipcraft to builtin modes list)
- Modify: `CLAUDE.md:91` (add clipcraft to modes directory listing)
- Modify: `CLAUDE.md:166` (add clipcraft to builtin table)

- [ ] **Step 1: Add clipcraft to mode-loader.ts**

After the gridboard entry (line ~98), add:

```typescript
  clipcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft/pneuma-mode.js").then((m) => m.default),
  },
```

- [ ] **Step 2: Update CLAUDE.md builtin modes list**

Add `clipcraft` to the three locations:
- Line 11: `**Builtin Modes:** ... , \`clipcraft\``
- Line 91: `├── modes/{...,clipcraft,...}/`
- Line 166: add row to builtin table

- [ ] **Step 3: Commit**

```bash
git add core/mode-loader.ts CLAUDE.md
git commit -m "feat(clipcraft): register as builtin mode"
```

---

## Task 13: Integration Test — Launch and Render

- [ ] **Step 1: Verify the mode launches**

```bash
cd /tmp/clipcraft-test
bun run --cwd /Users/pandazki/Codes/pneuma-skills dev clipcraft --workspace . --no-open --no-prompt --skip-skill
```

Expected: Server starts, seed files are copied, no TypeScript errors.

- [ ] **Step 2: Verify viewer renders**

Open the dev server URL in a browser. Should see the empty state:
- Video preview shows "No scenes yet" placeholder
- Scene strip shows "No scenes yet" message
- No track overview (empty)

- [ ] **Step 3: Test with sample storyboard**

Write a `storyboard.json` with 2-3 scenes (using placeholder thumbnails) and verify the viewer updates.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(clipcraft): integration test fixes"
```
