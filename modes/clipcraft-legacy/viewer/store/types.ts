import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import type { Storyboard, StoryboardV2, AnyStoryboard, ProjectConfig, Scene, AssetGraph, GraphNode, SlotBinding, Clip } from "../../types.js";

// ── Asset File ────────────────────────────────────────────────────────────────

export interface AssetFile {
  /** Workspace-relative path */
  path: string;
  /** Filename only */
  name: string;
  /** Classified media type */
  type: "image" | "video" | "audio" | "unknown";
}

export type LayerType = "caption" | "video" | "audio" | "bgm";

// ── State ─────────────────────────────────────────────────────────────────────

export interface ClipCraftState {
  // Data (parsed from files)
  project: ProjectConfig;
  storyboard: AnyStoryboard;
  graph: AssetGraph;

  // Assets (derived from file list, grouped by assets/ subdirectory)
  assets: Record<string, AssetFile[]>;

  // UI state
  selectedSceneId: string | null;
  activePanel: "assets" | "script";
  captionsEnabled: boolean;

  // Playback state
  playback: {
    playing: boolean;
    currentSceneIndex: number;
    currentTime: number;
    globalTime: number;
  };

  // Async state
  uploading: boolean;

  // Cache busting
  imageVersion: number;

  // 3D timeline mode
  timelineMode: "collapsed" | "overview" | "dive";
  diveLayer: LayerType | null;
  focusedLayer: LayerType | null;

  // Dive-in canvas
  diveFocusedNodeId: string | null;

  // Shared timeline zoom (synced between collapsed timeline + 3D overview)
  timelineZoom: {
    pixelsPerSecond: number;
    scrollLeft: number;
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type ClipCraftAction =
  // Scene
  | { type: "SELECT_SCENE"; sceneId: string | null }

  // UI
  | { type: "SET_PANEL"; panel: "assets" | "script" }
  | { type: "TOGGLE_CAPTIONS" }

  // Playback
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; globalTime: number }
  | { type: "SCENE_ENDED" }
  | { type: "UPDATE_TIME"; currentTime: number }

  // Async
  | { type: "SET_UPLOADING"; uploading: boolean }

  // Data (triggered by file changes from pneuma)
  | { type: "SYNC_FILES"; files: ViewerFileContent[]; imageVersion: number }

  // Assets (from /api/files/tree scan — covers binary files not in pneuma's files array)
  | { type: "SYNC_ASSETS"; assets: Record<string, AssetFile[]>; imageVersion: number }

  // 3D Timeline
  | { type: "SET_TIMELINE_MODE"; mode: "collapsed" | "overview" | "dive" }
  | { type: "SET_DIVE_LAYER"; layer: LayerType | null }
  | { type: "SET_FOCUSED_LAYER"; layer: LayerType | null }

  // Dive-in canvas
  | { type: "SET_DIVE_FOCUSED_NODE"; nodeId: string | null }
  | { type: "UPDATE_SLOT_BINDING"; clipId: string; slot: "visual" | "audio" | "caption"; selectedNodeId: string }
  | { type: "UPDATE_BGM_BINDING"; selectedNodeId: string }

  // Timeline zoom (shared)
  | { type: "SET_TIMELINE_ZOOM"; pixelsPerSecond: number; scrollLeft: number }

  // Dive-in direct edits
  | { type: "UPDATE_SCENE_CAPTION"; sceneId: string; caption: string }
  | { type: "UPDATE_BGM_CONFIG"; config: Partial<{ volume: number; fadeIn: number; fadeOut: number }> };
