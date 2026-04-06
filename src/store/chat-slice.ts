import type { StateCreator } from "zustand";
import type { ChatMessage, PermissionRequest } from "../types.js";
import type { AppState, Activity, AnsweredQuestion } from "./types.js";
import { mergeAssistantMessage } from "./helpers.js";

/** Unified pending message — user text, viewer notification, or notification with image */
export type PendingMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "notification"; notification: { type: string; message: string; severity: "info" | "warning"; summary?: string }; images?: { media_type: string; data: string }[] };

/** Tracks a file being written by the agent in real-time (from input_json_delta streaming) */
export interface StreamingFileWrite {
  path: string;
  content: string;
}

export interface ChatSlice {
  messages: ChatMessage[];
  streaming: string | null;
  streamingFileWrite: StreamingFileWrite | null;
  activity: Activity | null;
  pendingMessages: PendingMessage[];
  pendingPermissions: Map<string, PermissionRequest>;
  answeredQuestions: Map<string, AnsweredQuestion>;
  promptSuggestions: string[];
  setPromptSuggestions: (suggestions: string[]) => void;
  clearPromptSuggestions: () => void;

  appendMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (text: string | null) => void;
  setStreamingFileWrite: (fw: StreamingFileWrite | null) => void;
  setActivity: (activity: Activity | null) => void;
  addPendingMessage: (text: string) => void;
  addPendingNotification: (notification: { type: string; message: string; severity: "info" | "warning"; summary?: string }, images?: { media_type: string; data: string }[]) => string;
  removePendingMessage: (id: string) => void;
  shiftPendingMessage: () => PendingMessage | undefined;
  addPermission: (perm: PermissionRequest) => void;
  removePermission: (requestId: string) => void;
  recordAnsweredQuestion: (toolUseId: string, pairs: { question: string; answer: string }[]) => void;
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set, get) => ({
  messages: [],
  streaming: null,
  streamingFileWrite: null,
  activity: null,
  pendingMessages: [],
  pendingPermissions: new Map(),
  answeredQuestions: new Map(),
  promptSuggestions: [],
  setPromptSuggestions: (suggestions) => set({ promptSuggestions: suggestions }),
  clearPromptSuggestions: () => set({ promptSuggestions: [] }),

  appendMessage: (msg) =>
    set((s) => {
      const existingIdx = msg.id ? s.messages.findIndex((m) => m.id === msg.id) : -1;
      if (existingIdx !== -1) {
        const prev = s.messages[existingIdx];
        const merged = mergeAssistantMessage(prev, msg);
        const updated = [...s.messages];
        updated[existingIdx] = merged;
        return { messages: updated };
      }
      return { messages: [...s.messages, msg] };
    }),

  setMessages: (msgs) => set({ messages: msgs }),
  setStreaming: (text) => set({ streaming: text }),
  setStreamingFileWrite: (fw) => set({ streamingFileWrite: fw }),
  setActivity: (activity) => set({ activity }),

  addPendingMessage: (text) =>
    set((s) => ({
      pendingMessages: [...s.pendingMessages, { id: crypto.randomUUID(), kind: "user", text }],
    })),
  addPendingNotification: (notification, images) => {
    const id = crypto.randomUUID();
    set((s) => ({
      pendingMessages: [...s.pendingMessages, { id, kind: "notification", notification, images }],
    }));
    return id;
  },
  removePendingMessage: (id) =>
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((m) => m.id !== id),
    })),
  shiftPendingMessage: () => {
    const s = get();
    if (s.pendingMessages.length === 0) return undefined;
    const [first, ...rest] = s.pendingMessages;
    set({ pendingMessages: rest });
    return first;
  },

  addPermission: (perm) =>
    set((s) => {
      const next = new Map(s.pendingPermissions);
      next.set(perm.request_id, perm);
      return { pendingPermissions: next };
    }),

  removePermission: (requestId) =>
    set((s) => {
      if (!s.pendingPermissions.has(requestId)) return s;
      const next = new Map(s.pendingPermissions);
      next.delete(requestId);
      return { pendingPermissions: next };
    }),

  recordAnsweredQuestion: (toolUseId, pairs) =>
    set((s) => {
      const next = new Map(s.answeredQuestions);
      next.set(toolUseId, { toolUseId, pairs });
      return { answeredQuestions: next };
    }),
});
