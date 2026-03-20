import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

export interface ReplaySlice {
  replayMode: boolean;
  replayMessages: any[];
  replayCheckpoints: any[];
  currentSeq: number;
  activeCheckpointHash: string | null;
  playbackSpeed: number;
  isPlaying: boolean;
  replayMetadata: {
    title: string;
    mode: string;
    totalTurns: number;
    duration: number;
  } | null;
  replaySummary: any | null;

  enterReplayMode: (data: {
    messages: any[];
    checkpoints: any[];
    metadata: ReplaySlice["replayMetadata"];
    summary: any;
  }) => void;
  exitReplayMode: () => void;
  setCurrentSeq: (seq: number) => void;
  setActiveCheckpoint: (hash: string | null) => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export const createReplaySlice: StateCreator<AppState, [], [], ReplaySlice> = (set) => ({
  replayMode: false,
  replayMessages: [],
  replayCheckpoints: [],
  currentSeq: 0,
  activeCheckpointHash: null,
  playbackSpeed: 1,
  isPlaying: false,
  replayMetadata: null,
  replaySummary: null,

  enterReplayMode: (data) =>
    set({
      replayMode: true,
      replayMessages: data.messages,
      replayCheckpoints: data.checkpoints,
      replayMetadata: data.metadata,
      replaySummary: data.summary,
      currentSeq: 0,
      activeCheckpointHash: null,
      isPlaying: false,
    }),

  exitReplayMode: () =>
    set({
      replayMode: false,
      replayMessages: [],
      replayCheckpoints: [],
      replayMetadata: null,
      replaySummary: null,
      currentSeq: 0,
      activeCheckpointHash: null,
      isPlaying: false,
    }),

  setCurrentSeq: (seq) => set({ currentSeq: seq }),
  setActiveCheckpoint: (hash) => set({ activeCheckpointHash: hash }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
});
