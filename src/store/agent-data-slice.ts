import type { StateCreator } from "zustand";
import type { AppState, TaskItem, CronJob } from "./types.js";
import type { ProcessItem } from "../components/ProcessPanel.js";

export interface AgentDataSlice {
  tasks: TaskItem[];
  cronJobs: CronJob[];
  sessionProcesses: ProcessItem[];
  gitAvailable: boolean | null;
  changedFilesTick: number;
  imageTick: number;
  diffBase: "last-commit" | "default-branch";

  setTasks: (tasks: TaskItem[]) => void;
  addTask: (task: TaskItem) => void;
  updateTask: (taskId: string, updates: Partial<TaskItem>) => void;
  setCronJobs: (jobs: CronJob[]) => void;
  addCronJob: (job: CronJob) => void;
  removeCronJob: (id: string) => void;
  addProcess: (proc: ProcessItem) => void;
  updateProcess: (taskId: string, updates: Partial<ProcessItem>) => void;
  setGitAvailable: (available: boolean) => void;
  bumpChangedFilesTick: () => void;
  bumpImageTick: () => void;
  setDiffBase: (base: "last-commit" | "default-branch") => void;
}

export const createAgentDataSlice: StateCreator<AppState, [], [], AgentDataSlice> = (set) => ({
  tasks: [],
  cronJobs: [],
  sessionProcesses: [],
  gitAvailable: null,
  changedFilesTick: 0,
  imageTick: 0,
  diffBase: "last-commit",

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })),

  setCronJobs: (cronJobs) => set({ cronJobs }),
  addCronJob: (job) => set((s) => {
    if (s.cronJobs.some((j) => j.id === job.id)) return s;
    return { cronJobs: [...s.cronJobs, job] };
  }),
  removeCronJob: (id) => set((s) => ({ cronJobs: s.cronJobs.filter((j) => j.id !== id) })),

  addProcess: (proc) => set((s) => ({ sessionProcesses: [...s.sessionProcesses, proc] })),
  updateProcess: (taskId, updates) =>
    set((s) => ({
      sessionProcesses: s.sessionProcesses.map((p) =>
        p.taskId === taskId ? { ...p, ...updates } : p
      ),
    })),

  setGitAvailable: (gitAvailable) => set({ gitAvailable }),
  bumpChangedFilesTick: () => set((s) => ({ changedFilesTick: s.changedFilesTick + 1 })),
  bumpImageTick: () => set((s) => ({ imageTick: s.imageTick + 1 })),
  setDiffBase: (diffBase) => set({ diffBase }),
});
