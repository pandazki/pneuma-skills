import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import type { Storyboard, StoryboardV2, AnyStoryboard, ProjectConfig, AssetGraph, GraphNode, SlotBinding, Clip, Scene } from "../../types.js";
import { EMPTY_GRAPH } from "../../types.js";
import type { ClipCraftState, ClipCraftAction, AssetFile } from "./types.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

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

export const initialState: ClipCraftState = {
  project: DEFAULT_PROJECT,
  storyboard: EMPTY_STORYBOARD,
  graph: EMPTY_GRAPH,
  assets: {},
  selectedSceneId: null,
  activePanel: "assets",
  captionsEnabled: true,
  playback: {
    playing: false,
    currentSceneIndex: 0,
    currentTime: 0,
    globalTime: 0,
  },
  uploading: false,
  imageVersion: 0,
  timelineMode: "collapsed",
  diveLayer: null,
  focusedLayer: null,
  diveFocusedNodeId: null,
  timelineZoom: {
    pixelsPerSecond: 0, // 0 = auto-fit on first render
    scrollLeft: 0,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a JSON file from the files array, returning fallback on missing/invalid. */
function parseJSON<T>(
  files: ViewerFileContent[],
  filename: string,
  fallback: T,
): T {
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

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "aac", "flac", "m4a"]);

/** Classify a file path into a media type by extension. */
export function classifyFileType(
  path: string,
): "image" | "video" | "audio" | "unknown" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "unknown";
}

/**
 * Group asset files by their subdirectory under assets/.
 * e.g. "assets/images/foo.png" -> group "images", "assets/clips/bar.mp4" -> group "clips"
 * Files directly under assets/ go into the "root" group.
 * .gitkeep files are excluded.
 */
export function groupAssets(
  files: ViewerFileContent[],
): Record<string, AssetFile[]> {
  const groups: Record<string, AssetFile[]> = {};

  for (const f of files) {
    if (!f.path.startsWith("assets/")) continue;

    const relative = f.path.slice("assets/".length);
    const name = relative.split("/").pop() ?? "";

    // Skip .gitkeep and empty names
    if (!name || name === ".gitkeep") continue;

    const parts = relative.split("/");
    const group = parts.length > 1 ? parts[0] : "root";

    if (!groups[group]) groups[group] = [];
    groups[group].push({
      path: f.path,
      name,
      type: classifyFileType(f.path),
    });
  }

  return groups;
}

// ── V1 → V2 Migration ────────────────────────────────────────────────────────

function migrateV1ToV2(v1: Storyboard): { converted: StoryboardV2; syntheticGraph: AssetGraph } {
  const nodes: Record<string, GraphNode> = {};
  const clips: Clip[] = [];

  for (const scene of v1.scenes) {
    let visualBinding: SlotBinding | null = null;
    let audioBinding: SlotBinding | null = null;
    let captionBinding: SlotBinding | null = null;

    if (scene.visual) {
      const nodeId = `node-${scene.id}-visual`;
      nodes[nodeId] = {
        id: nodeId,
        kind: scene.visual.type === "video" ? "video" : "image",
        status: scene.visual.status,
        parentId: null,
        source: scene.visual.source,
        prompt: scene.visual.prompt,
        model: scene.visual.model,
        createdAt: Date.now(),
        metadata: {
          ...(scene.visual.thumbnail ? { thumbnail: scene.visual.thumbnail } : {}),
          ...(scene.visual.errorMessage ? { errorMessage: scene.visual.errorMessage } : {}),
        },
      };
      visualBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    if (scene.audio) {
      const nodeId = `node-${scene.id}-audio`;
      nodes[nodeId] = {
        id: nodeId,
        kind: "audio",
        status: scene.audio.status,
        parentId: null,
        source: scene.audio.source,
        content: scene.audio.text,
        model: scene.audio.model,
        createdAt: Date.now(),
        metadata: {
          ...(scene.audio.voice ? { voice: scene.audio.voice } : {}),
          ...(scene.audio.duration != null ? { duration: scene.audio.duration } : {}),
          ...(scene.audio.errorMessage ? { errorMessage: scene.audio.errorMessage } : {}),
        },
      };
      audioBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    if (scene.caption) {
      const nodeId = `node-${scene.id}-caption`;
      nodes[nodeId] = {
        id: nodeId,
        kind: "text",
        status: "ready",
        parentId: null,
        content: typeof scene.caption === "string" ? scene.caption : (scene.caption as any)?.text ?? "",
        createdAt: Date.now(),
      };
      captionBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    clips.push({
      id: scene.id,
      order: scene.order,
      duration: scene.duration,
      visual: visualBinding,
      audio: audioBinding,
      caption: captionBinding,
      transition: scene.transition,
    });
  }

  let bgmBinding: SlotBinding | null = null;
  if (v1.bgm) {
    const nodeId = "node-bgm";
    nodes[nodeId] = {
      id: nodeId,
      kind: "audio",
      status: "ready",
      parentId: null,
      source: v1.bgm.source,
      createdAt: Date.now(),
      metadata: {
        title: v1.bgm.title,
        volume: v1.bgm.volume,
        fadeIn: v1.bgm.fadeIn,
        fadeOut: v1.bgm.fadeOut,
      },
    };
    bgmBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
  }

  return {
    converted: { version: 2, clips, bgm: bgmBinding, characterRefs: v1.characterRefs },
    syntheticGraph: { version: 1, nodes },
  };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function clipCraftReducer(
  state: ClipCraftState,
  action: ClipCraftAction,
): ClipCraftState {
  switch (action.type) {
    case "SELECT_SCENE":
      return { ...state, selectedSceneId: action.sceneId };

    case "SET_PANEL":
      return { ...state, activePanel: action.panel };

    case "TOGGLE_CAPTIONS":
      return { ...state, captionsEnabled: !state.captionsEnabled };

    case "PLAY":
      return {
        ...state,
        playback: { ...state.playback, playing: true },
      };

    case "PAUSE":
      return {
        ...state,
        playback: { ...state.playback, playing: false },
      };

    case "SEEK": {
      const sb = state.storyboard as StoryboardV2;
      const items = sb.clips ?? (sb as any).scenes ?? [];
      const sorted = [...items].sort((a: any, b: any) => a.order - b.order);
      let seekCumulative = 0;
      let seekIndex = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (action.globalTime < seekCumulative + sorted[i].duration || i === sorted.length - 1) {
          seekIndex = i;
          break;
        }
        seekCumulative += sorted[i].duration;
      }
      return {
        ...state,
        playback: {
          ...state.playback,
          globalTime: action.globalTime,
          currentSceneIndex: seekIndex,
          currentTime: action.globalTime - seekCumulative,
        },
      };
    }

    case "SCENE_ENDED": {
      const nextIndex = state.playback.currentSceneIndex + 1;
      return {
        ...state,
        playback: {
          ...state.playback,
          currentSceneIndex: nextIndex,
          currentTime: 0,
        },
      };
    }

    case "UPDATE_TIME":
      return {
        ...state,
        playback: { ...state.playback, currentTime: action.currentTime },
      };

    case "SET_UPLOADING":
      return { ...state, uploading: action.uploading };

    case "SYNC_FILES": {
      const project = parseJSON<ProjectConfig>(
        action.files,
        "project.json",
        DEFAULT_PROJECT,
      );
      const rawStoryboard = parseJSON<AnyStoryboard>(
        action.files,
        "storyboard.json",
        EMPTY_STORYBOARD,
      );
      const graph = parseJSON<AssetGraph>(
        action.files,
        "graph.json",
        EMPTY_GRAPH,
      );

      if ((rawStoryboard as StoryboardV2).version === 2) {
        return {
          ...state,
          project,
          storyboard: rawStoryboard as StoryboardV2,
          graph,
          imageVersion: action.imageVersion,
        };
      }

      // V1 legacy: migrate
      const v1 = rawStoryboard as Storyboard;
      for (const scene of v1.scenes) {
        if (scene.caption && typeof scene.caption !== "string") {
          scene.caption = (scene.caption as any).text ?? "";
        }
      }
      const { converted, syntheticGraph } = migrateV1ToV2(v1);
      const mergedGraph: AssetGraph = {
        version: 1,
        nodes: { ...graph.nodes, ...syntheticGraph.nodes },
      };

      return {
        ...state,
        project,
        storyboard: converted,
        graph: mergedGraph,
        imageVersion: action.imageVersion,
      };
    }

    case "SYNC_ASSETS":
      return {
        ...state,
        assets: action.assets,
        imageVersion: action.imageVersion,
      };

    case "SET_TIMELINE_MODE":
      return { ...state, timelineMode: action.mode };

    case "SET_DIVE_LAYER":
      return { ...state, diveLayer: action.layer };

    case "SET_FOCUSED_LAYER":
      return { ...state, focusedLayer: action.layer };

    case "SET_TIMELINE_ZOOM":
      return {
        ...state,
        timelineZoom: {
          pixelsPerSecond: action.pixelsPerSecond,
          scrollLeft: action.scrollLeft,
        },
      };

    case "UPDATE_SCENE_CAPTION": {
      const sb = state.storyboard as StoryboardV2;
      if (sb.clips) {
        const clip = sb.clips.find(c => c.id === action.sceneId);
        if (clip?.caption) {
          const nodeId = clip.caption.selectedNodeId;
          const node = state.graph.nodes[nodeId];
          if (node) {
            return {
              ...state,
              graph: {
                ...state.graph,
                nodes: {
                  ...state.graph.nodes,
                  [nodeId]: { ...node, content: action.caption },
                },
              },
            };
          }
        }
      }
      // Fallback for v1 (shouldn't happen since we always migrate, but safe)
      const v1 = state.storyboard as Storyboard;
      if (v1.scenes) {
        const scenes = v1.scenes.map(s =>
          s.id === action.sceneId ? { ...s, caption: action.caption } : s,
        );
        return { ...state, storyboard: { ...v1, scenes } };
      }
      return state;
    }

    case "UPDATE_BGM_CONFIG": {
      const sb = state.storyboard as StoryboardV2;
      if (sb.bgm) {
        const nodeId = sb.bgm.selectedNodeId;
        const node = state.graph.nodes[nodeId];
        if (node) {
          return {
            ...state,
            graph: {
              ...state.graph,
              nodes: {
                ...state.graph.nodes,
                [nodeId]: {
                  ...node,
                  metadata: { ...(node.metadata ?? {}), ...action.config },
                },
              },
            },
          };
        }
      }
      // Fallback for v1
      const v1 = state.storyboard as Storyboard;
      if (v1.bgm) {
        return { ...state, storyboard: { ...v1, bgm: { ...v1.bgm, ...action.config } } };
      }
      return state;
    }

    case "SET_DIVE_FOCUSED_NODE":
      return { ...state, diveFocusedNodeId: action.nodeId };

    case "UPDATE_SLOT_BINDING": {
      const sb = state.storyboard as StoryboardV2;
      if (!sb.clips) return state;
      const clips = sb.clips.map(c => {
        if (c.id !== action.clipId) return c;
        const binding = c[action.slot];
        if (!binding) return c;
        return { ...c, [action.slot]: { ...binding, selectedNodeId: action.selectedNodeId } };
      });
      return { ...state, storyboard: { ...sb, clips } };
    }

    case "UPDATE_BGM_BINDING": {
      const sb = state.storyboard as StoryboardV2;
      if (!sb.bgm) return state;
      return {
        ...state,
        storyboard: { ...sb, bgm: { ...sb.bgm, selectedNodeId: action.selectedNodeId } },
      };
    }

    default:
      return state;
  }
}
