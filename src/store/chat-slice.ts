import type { StateCreator } from "zustand";
import type { ChatMessage, PermissionRequest, Annotation } from "../types.js";
import type { AppState, Activity, AnsweredQuestion, ElementSelection } from "./types.js";
import { mergeAssistantMessage } from "./helpers.js";
import { isPneumaMarkerOnly } from "../../core/utils/pneuma-markers.js";

export interface PendingUserPayload {
  text: string;
  selection?: ElementSelection | null;
  images?: { media_type: string; data: string }[];
  files?: { name: string; media_type: string; data: string; size: number }[];
  annotations?: Annotation[];
}

/** Unified pending message — user text, viewer notification, or notification with image */
export type PendingMessage =
  | ({ id: string; kind: "user" } & PendingUserPayload)
  | { id: string; kind: "notification"; notification: { type: string; message: string; severity: "info" | "warning"; summary?: string; replaces?: string[] }; images?: { media_type: string; data: string }[] };

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
  addPendingMessage: (payload: PendingUserPayload) => void;
  addPendingNotification: (notification: { type: string; message: string; severity: "info" | "warning"; summary?: string; replaces?: string[] }, images?: { media_type: string; data: string }[]) => string;
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
      // Resume-induced duplicate guard — Claude Code 2.x re-emits the last
      // assistant message on `--resume` and Pneuma also redispatches an
      // `<pneuma:env reason="opened">` envelope on every session reopen,
      // so the chat shows the same greeting twice (once from history,
      // once from the live re-emit). Walk back over `<pneuma:*>` markers,
      // system events, and the env-tag user message; if the previous
      // *real* assistant turn has the same trimmed text, overwrite it.
      if (msg.role === "assistant" && s.messages.length > 0) {
        const newText = (msg.content || "").trim();
        if (newText.length > 0) {
          let lastAssistantIdx = -1;
          let blockedByMeaningfulInput = false;
          for (let i = s.messages.length - 1; i >= 0; i--) {
            const m = s.messages[i];
            if (m.role === "assistant") { lastAssistantIdx = i; break; }
            if (m.role === "user") {
              const c = (m.content || "").trim();
              if (!isPneumaMarkerOnly(c) && c.length > 0) {
                blockedByMeaningfulInput = true;
                break;
              }
            }
          }
          if (!blockedByMeaningfulInput && lastAssistantIdx !== -1) {
            const last = s.messages[lastAssistantIdx];
            if ((last.content || "").trim() === newText) {
              const updated = [...s.messages];
              updated[lastAssistantIdx] = mergeAssistantMessage(last, msg);
              // Drop everything between the deduped assistant and now —
              // those are stale env / system markers from the same resume.
              const trimmed = updated.slice(0, lastAssistantIdx + 1);
              return { messages: trimmed };
            }
          }
        }
      }
      return { messages: [...s.messages, msg] };
    }),

  setMessages: (msgs) => set({ messages: msgs }),
  setStreaming: (text) => set({ streaming: text }),
  setStreamingFileWrite: (fw) => set({ streamingFileWrite: fw }),
  setActivity: (activity) => set({ activity }),

  addPendingMessage: (payload) =>
    set((s) => ({
      pendingMessages: [...s.pendingMessages, { id: crypto.randomUUID(), kind: "user", ...payload }],
    })),
  addPendingNotification: (notification, images) => {
    const id = crypto.randomUUID();
    set((s) => {
      // If the notification names types to replace, remove any queued
      // notifications of those types first. Lets a viewer cancel its own
      // earlier warnings when the underlying condition has been resolved
      // (e.g. Remotion clearing a stale "compilation-error" after a
      // successful recompile).
      let pending = s.pendingMessages;
      const replaceTypes = notification.replaces;
      if (replaceTypes && replaceTypes.length > 0) {
        const remove = new Set(replaceTypes);
        pending = pending.filter(
          (m) => m.kind !== "notification" || !remove.has(m.notification.type),
        );
      }
      // Clear-only signal: info-severity with `replaces` is purely a
      // cancellation marker — never queue it (and therefore never send
      // it to the agent on flush).
      const isClearOnly =
        notification.severity === "info" && !!replaceTypes && replaceTypes.length > 0;
      if (isClearOnly) {
        return { pendingMessages: pending };
      }
      return { pendingMessages: [...pending, { id, kind: "notification", notification, images }] };
    });
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
