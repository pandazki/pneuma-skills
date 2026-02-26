import { create } from "zustand";
import type { SessionState, PermissionRequest, ChatMessage, FileContent, SelectionContext } from "./types.js";

export interface Activity {
  phase: "thinking" | "responding" | "tool";
  toolName?: string;
  startedAt: number;
}

export type ElementSelection = SelectionContext;

interface AppState {
  // Session
  session: SessionState | null;
  sessionId: string | null;

  // Connection
  connectionStatus: "connecting" | "connected" | "disconnected";
  cliConnected: boolean;
  sessionStatus: "idle" | "running" | "compacting" | null;

  // Messages
  messages: ChatMessage[];
  streaming: string | null;

  // Activity indicator
  activity: Activity | null;

  // Permissions
  pendingPermissions: Map<string, PermissionRequest>;

  // Content (markdown files)
  files: FileContent[];

  // Tab
  activeTab: "chat" | "editor" | "diff" | "terminal" | "processes";

  // Diff
  changedFilesTick: number;
  diffBase: "last-commit" | "default-branch";

  // Processes
  sessionProcesses: import("./components/ProcessPanel.js").ProcessItem[];

  // Terminal
  terminalId: string | null;

  // Element selection
  selection: ElementSelection | null;
  previewMode: "view" | "edit" | "select";

  // Actions — session
  setSession: (session: SessionState) => void;
  updateSession: (updates: Partial<SessionState>) => void;
  setSessionId: (id: string) => void;

  // Actions — connection
  setConnectionStatus: (status: "connecting" | "connected" | "disconnected") => void;
  setCliConnected: (connected: boolean) => void;
  setSessionStatus: (status: "idle" | "running" | "compacting" | null) => void;

  // Actions — messages
  appendMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (text: string | null) => void;

  // Actions — activity
  setActivity: (activity: Activity | null) => void;

  // Actions — permissions
  addPermission: (perm: PermissionRequest) => void;
  removePermission: (requestId: string) => void;

  // Actions — tab
  setActiveTab: (tab: "chat" | "editor" | "diff" | "terminal" | "processes") => void;

  // Actions — diff
  bumpChangedFilesTick: () => void;
  setDiffBase: (base: "last-commit" | "default-branch") => void;

  // Actions — processes
  addProcess: (proc: import("./components/ProcessPanel.js").ProcessItem) => void;
  updateProcess: (taskId: string, updates: Partial<import("./components/ProcessPanel.js").ProcessItem>) => void;

  // Actions — terminal
  setTerminalId: (id: string | null) => void;

  // Actions — selection
  setSelection: (s: ElementSelection | null) => void;
  setPreviewMode: (mode: "view" | "edit" | "select") => void;

  // Actions — content
  setFiles: (files: FileContent[]) => void;
  updateFiles: (updates: FileContent[]) => void;
}

let idCounter = 0;
export function nextId(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

export const useStore = create<AppState>((set) => ({
  session: null,
  sessionId: null,
  connectionStatus: "disconnected",
  cliConnected: false,
  sessionStatus: null,
  messages: [],
  streaming: null,
  activity: null,
  pendingPermissions: new Map(),
  files: [],
  activeTab: "chat",
  changedFilesTick: 0,
  diffBase: "last-commit",
  sessionProcesses: [],
  terminalId: null,
  selection: null,
  previewMode: "view",

  setSession: (session) => set({ session }),
  updateSession: (updates) =>
    set((s) => ({
      session: s.session ? { ...s.session, ...updates } : null,
    })),
  setSessionId: (id) => set({ sessionId: id }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCliConnected: (connected) => set({ cliConnected: connected }),
  setSessionStatus: (status) => set({ sessionStatus: status }),

  appendMessage: (msg) =>
    set((s) => {
      // Deduplicate by id
      if (msg.id && s.messages.some((m) => m.id === msg.id)) return s;
      return { messages: [...s.messages, msg] };
    }),

  setMessages: (msgs) => set({ messages: msgs }),

  setStreaming: (text) => set({ streaming: text }),

  setActivity: (activity) => set({ activity }),

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

  setActiveTab: (activeTab) => set({ activeTab }),

  bumpChangedFilesTick: () => set((s) => ({ changedFilesTick: s.changedFilesTick + 1 })),
  setDiffBase: (diffBase) => set({ diffBase }),

  addProcess: (proc) => set((s) => ({ sessionProcesses: [...s.sessionProcesses, proc] })),
  updateProcess: (taskId, updates) =>
    set((s) => ({
      sessionProcesses: s.sessionProcesses.map((p) =>
        p.taskId === taskId ? { ...p, ...updates } : p
      ),
    })),

  setTerminalId: (terminalId) => set({ terminalId }),

  setSelection: (selection) => set({ selection }),
  setPreviewMode: (previewMode) => set({ previewMode, ...(previewMode !== "select" ? { selection: null } : {}) }),

  setFiles: (files) => set({ files }),
  updateFiles: (updates) =>
    set((s) => {
      const fileMap = new Map(s.files.map((f) => [f.path, f]));
      for (const u of updates) {
        fileMap.set(u.path, u);
      }
      return { files: Array.from(fileMap.values()) };
    }),
}));
