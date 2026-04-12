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

// ── Domain Model v2 ─────────────────────────────────────────────────────────

/** A node in the asset generation graph. */
export interface GraphNode {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  status: AssetStatus;
  parentId: string | null;
  source?: string;
  content?: string;
  prompt?: string;
  model?: string;
  params?: Record<string, unknown>;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** The project-wide asset graph — all generated artifacts and their lineage. */
export interface AssetGraph {
  version: 1;
  nodes: Record<string, GraphNode>;
}

/** Pointer from a timeline slot into the asset graph. */
export interface SlotBinding {
  rootNodeId: string;
  selectedNodeId: string;
}

/** A clip in the timeline (replaces Scene in v2). */
export interface Clip {
  id: string;
  order: number;
  duration: number;
  visual: SlotBinding | null;
  audio: SlotBinding | null;
  caption: SlotBinding | null;
  transition: SceneTransition;
}

/** Storyboard v2 — timeline with slot bindings. */
export interface StoryboardV2 {
  version: 2;
  clips: Clip[];
  bgm: SlotBinding | null;
  characterRefs: CharacterRef[];
}

/** Union type for storyboard — v1 (legacy) or v2. */
export type AnyStoryboard = Storyboard | StoryboardV2;

/** Empty defaults for v2 structures. */
export const EMPTY_GRAPH: AssetGraph = { version: 1, nodes: {} };
export const EMPTY_STORYBOARD_V2: StoryboardV2 = { version: 2, clips: [], bgm: null, characterRefs: [] };
