import { create } from "zustand";
import type { SessionState, PermissionRequest, ChatMessage, FileContent, SelectionContext, ContentBlock } from "./types.js";
import type { ViewerContract } from "../core/types/viewer-contract.js";

export interface Activity {
  phase: "thinking" | "responding" | "tool";
  toolName?: string;
  startedAt: number;
}

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blockedBy?: string[];
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
  /** True from user message send until result received — controls input disable */
  turnInProgress: boolean;

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
  activeTab: "chat" | "editor" | "diff" | "terminal" | "processes" | "context";

  // Git / Diff
  gitAvailable: boolean | null; // null = not yet checked
  changedFilesTick: number;
  imageTick: number;
  diffBase: "last-commit" | "default-branch";

  // Processes
  sessionProcesses: import("./components/ProcessPanel.js").ProcessItem[];

  // Tasks
  tasks: TaskItem[];

  // Terminal
  terminalId: string | null;

  // Element selection
  selection: ElementSelection | null;
  previewMode: "view" | "edit" | "select";
  /** Currently viewed file path (e.g. current slide), independent of element selection */
  activeFile: string | null;

  // Mode viewer (loaded dynamically via mode-loader)
  modeViewer: ViewerContract | null;

  // Init params (immutable per session, from mode manifest)
  initParams: Record<string, number | string>;

  // Actions — session
  setSession: (session: SessionState) => void;
  updateSession: (updates: Partial<SessionState>) => void;
  setSessionId: (id: string) => void;

  // Actions — connection
  setConnectionStatus: (status: "connecting" | "connected" | "disconnected") => void;
  setCliConnected: (connected: boolean) => void;
  setSessionStatus: (status: "idle" | "running" | "compacting" | null) => void;
  setTurnInProgress: (v: boolean) => void;

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
  setActiveTab: (tab: "chat" | "editor" | "diff" | "terminal" | "processes" | "context") => void;

  // Actions — git / diff
  setGitAvailable: (available: boolean) => void;
  bumpChangedFilesTick: () => void;
  bumpImageTick: () => void;
  setDiffBase: (base: "last-commit" | "default-branch") => void;

  // Actions — processes
  addProcess: (proc: import("./components/ProcessPanel.js").ProcessItem) => void;
  updateProcess: (taskId: string, updates: Partial<import("./components/ProcessPanel.js").ProcessItem>) => void;

  // Actions — tasks
  setTasks: (tasks: TaskItem[]) => void;
  addTask: (task: TaskItem) => void;
  updateTask: (taskId: string, updates: Partial<TaskItem>) => void;

  // Actions — terminal
  setTerminalId: (id: string | null) => void;

  // Actions — selection
  setSelection: (s: ElementSelection | null) => void;
  setPreviewMode: (mode: "view" | "edit" | "select") => void;
  setActiveFile: (file: string | null) => void;

  // Actions — mode viewer
  setModeViewer: (viewer: ViewerContract) => void;

  // Actions — init params
  setInitParams: (params: Record<string, number | string>) => void;

  // Actions — content
  setFiles: (files: FileContent[]) => void;
  updateFiles: (updates: FileContent[]) => void;
}

let idCounter = 0;
export function nextId(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

/** Merge content blocks from two assistant messages, deduplicating by JSON identity. */
function mergeContentBlocks(prev?: ContentBlock[], next?: ContentBlock[]): ContentBlock[] | undefined {
  const prevBlocks = prev || [];
  const nextBlocks = next || [];
  if (prevBlocks.length === 0 && nextBlocks.length === 0) return undefined;
  const merged: ContentBlock[] = [];
  const seen = new Set<string>();
  for (const block of prevBlocks) {
    const key = JSON.stringify(block);
    if (!seen.has(key)) { seen.add(key); merged.push(block); }
  }
  for (const block of nextBlocks) {
    const key = JSON.stringify(block);
    if (!seen.has(key)) { seen.add(key); merged.push(block); }
  }
  return merged;
}

function extractTextContent(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "thinking") return b.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Merge two assistant messages with the same id — combines content blocks. */
function mergeAssistantMessage(prev: ChatMessage, incoming: ChatMessage): ChatMessage {
  const mergedBlocks = mergeContentBlocks(prev.contentBlocks, incoming.contentBlocks);
  const content = mergedBlocks?.length ? extractTextContent(mergedBlocks) : (incoming.content || prev.content);
  return {
    ...prev,
    ...incoming,
    content,
    contentBlocks: mergedBlocks,
    timestamp: prev.timestamp ?? incoming.timestamp,
  };
}

export const useStore = create<AppState>((set) => ({
  session: null,
  sessionId: null,
  connectionStatus: "disconnected",
  cliConnected: false,
  sessionStatus: null,
  turnInProgress: false,
  messages: [],
  streaming: null,
  activity: null,
  pendingPermissions: new Map(),
  files: [],
  activeTab: "chat",
  gitAvailable: null,
  changedFilesTick: 0,
  imageTick: 0,
  diffBase: "last-commit",
  sessionProcesses: [],
  tasks: [],
  terminalId: null,
  selection: null,
  previewMode: "view",
  activeFile: null,
  modeViewer: null,
  initParams: {},

  setSession: (session) => set({ session }),
  updateSession: (updates) =>
    set((s) => ({
      session: s.session ? { ...s.session, ...updates } : null,
    })),
  setSessionId: (id) => set({ sessionId: id }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCliConnected: (connected) => set({ cliConnected: connected }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setTurnInProgress: (v) => set({ turnInProgress: v }),

  appendMessage: (msg) =>
    set((s) => {
      const existingIdx = msg.id ? s.messages.findIndex((m) => m.id === msg.id) : -1;
      if (existingIdx !== -1) {
        // Same id → merge content blocks (CLI sends thinking then text as separate messages)
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

  setGitAvailable: (gitAvailable) => set({ gitAvailable }),
  bumpChangedFilesTick: () => set((s) => ({ changedFilesTick: s.changedFilesTick + 1 })),
  bumpImageTick: () => set((s) => ({ imageTick: s.imageTick + 1 })),
  setDiffBase: (diffBase) => set({ diffBase }),

  addProcess: (proc) => set((s) => ({ sessionProcesses: [...s.sessionProcesses, proc] })),
  updateProcess: (taskId, updates) =>
    set((s) => ({
      sessionProcesses: s.sessionProcesses.map((p) =>
        p.taskId === taskId ? { ...p, ...updates } : p
      ),
    })),

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })),

  setTerminalId: (terminalId) => set({ terminalId }),

  setSelection: (selection) => set({ selection }),
  setPreviewMode: (previewMode) => set({ previewMode, ...(previewMode !== "select" ? { selection: null } : {}) }),
  setActiveFile: (activeFile) => set({ activeFile }),

  setModeViewer: (modeViewer) => set({ modeViewer }),

  setInitParams: (initParams) => set({ initParams }),

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
