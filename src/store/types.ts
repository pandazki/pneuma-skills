import type { SelectionContext } from "../types.js";

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

export interface AnsweredQuestion {
  toolUseId: string;
  pairs: { question: string; answer: string }[];
}

export interface CronJob {
  id: string;
  cron: string;
  humanSchedule: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt?: number;
}

export type ElementSelection = SelectionContext;

// Re-export ProcessItem from its source
export type { ProcessItem } from "../components/ProcessPanel.js";

// Slice interfaces — imported by each slice and combined into AppState
export type { UiSlice } from "./ui-slice.js";
export type { SessionSlice } from "./session-slice.js";
export type { AgentDataSlice } from "./agent-data-slice.js";
export type { ChatSlice } from "./chat-slice.js";
export type { ModeSlice } from "./mode-slice.js";
export type { ViewerSlice } from "./viewer-slice.js";
export type { WorkspaceSlice } from "./workspace-slice.js";
export type { ReplaySlice } from "./replay-slice.js";
export type { PluginSlice } from "./plugin-slice.js";
export type { ProjectSlice } from "./project-slice.js";

import type { UiSlice } from "./ui-slice.js";
import type { SessionSlice } from "./session-slice.js";
import type { AgentDataSlice } from "./agent-data-slice.js";
import type { ChatSlice } from "./chat-slice.js";
import type { ModeSlice } from "./mode-slice.js";
import type { ViewerSlice } from "./viewer-slice.js";
import type { WorkspaceSlice } from "./workspace-slice.js";
import type { ReplaySlice } from "./replay-slice.js";
import type { PluginSlice } from "./plugin-slice.js";
import type { ProjectSlice } from "./project-slice.js";

export type AppState = UiSlice & SessionSlice & AgentDataSlice & ChatSlice & ModeSlice & ViewerSlice & WorkspaceSlice & ReplaySlice & PluginSlice & ProjectSlice;
