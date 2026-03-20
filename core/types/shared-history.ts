export interface SharedHistoryPackage {
  version: 1;
  metadata: {
    id: string;
    title: string;
    description?: string;
    mode: string;
    backendType: string;
    model?: string;
    totalTurns: number;
    totalCost?: number;
    createdAt: number;
    exportedAt: number;
    duration: number;
  };
  summary: SessionSummary;
  checkpoints: ExportedCheckpoint[];
}

export interface ExportedCheckpoint {
  turn: number;
  timestamp: number;
  hash: string;
  label: string;
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
  messageSeqRange: [number, number];
}

export interface SessionSummary {
  overview: string;
  keyDecisions: string[];
  workspaceFiles: { path: string; lines: number }[];
  recentConversation: string;
}
