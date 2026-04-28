// server/history-export.ts
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { tmpdir } from "node:os";
import { listCheckpoints, createBundle, isShadowGitAvailable } from "./shadow-git.js";
import { generateSummary } from "./history-summary.js";
import type { SharedHistoryPackage, ExportedCheckpoint } from "../core/types/shared-history.js";
import type { BrowserIncomingMessage } from "./session-types.js";

interface ExportOptions {
  output?: string;
  title?: string;
  description?: string;
  /**
   * Per-session state directory. Defaults to `<workspace>/.pneuma` (legacy 2.x);
   * project sessions pass `<projectRoot>/.pneuma/sessions/<id>`.
   */
  stateDir?: string;
}

interface ExportResult {
  outputPath: string;
  messageCount: number;
  checkpointCount: number;
}

export async function exportHistory(workspace: string, options: ExportOptions = {}): Promise<ExportResult> {
  const stateDir = options.stateDir ?? join(workspace, ".pneuma");

  // 1. Read session metadata
  const sessionPath = join(stateDir, "session.json");
  const session = JSON.parse(readFileSync(sessionPath, "utf-8"));

  // 2. Read history
  const historyPath = join(stateDir, "history.json");
  const messages: BrowserIncomingMessage[] = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf-8"))
    : [];

  // 3. Read checkpoints
  const checkpoints = await listCheckpoints(workspace, options.stateDir);

  // 4. Build checkpoint index with message seq ranges
  const exportedCheckpoints: ExportedCheckpoint[] = buildCheckpointIndex(messages, checkpoints);

  // 5. Scan workspace files for summary
  const workspaceFiles = scanWorkspaceFiles(workspace);

  // 6. Generate summary
  const summary = generateSummary(messages, workspaceFiles);

  // 7. Build manifest
  const id = `${session.mode}-${basename(workspace)}-${Date.now()}`;
  const timestamps = messages
    .filter((m: any) => m.timestamp)
    .map((m: any) => m.timestamp);

  const manifest: SharedHistoryPackage = {
    version: 1,
    metadata: {
      id,
      title: options.title ?? `${session.mode} session`,
      description: options.description,
      mode: session.mode,
      backendType: session.backendType,
      totalTurns: messages.filter((m) => m.type === "result").length,
      createdAt: session.createdAt,
      exportedAt: Date.now(),
      duration: timestamps.length >= 2 ? timestamps[timestamps.length - 1] - timestamps[0] : 0,
    },
    summary,
    checkpoints: exportedCheckpoints,
  };

  // 8. Create staging directory
  const stageDir = mkdtempSync(join(tmpdir(), "pneuma-export-"));
  mkdirSync(stageDir, { recursive: true });

  // Write manifest
  writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Write messages as JSONL (sanitize workspace paths)
  const workspacePrefix = workspace.endsWith("/") ? workspace : workspace + "/";
  const messagesJsonl = messages
    .map((m) => JSON.stringify(m).replaceAll(workspacePrefix, ""))
    .join("\n");
  writeFileSync(join(stageDir, "messages.jsonl"), messagesJsonl);

  // Create git bundle if shadow git available
  if (isShadowGitAvailable(workspace) && checkpoints.length > 0) {
    await createBundle(workspace, join(stageDir, "repo.bundle"));
  }

  // 9. tar.gz the staging directory
  const outputPath = options.output ?? join(workspace, `${id}.tar.gz`);
  await Bun.spawn(
    ["tar", "czf", outputPath, "-C", stageDir, "."],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;

  // Cleanup staging
  await Bun.spawn(["rm", "-rf", stageDir]).exited;

  return { outputPath, messageCount: messages.length, checkpointCount: checkpoints.length };
}

function buildCheckpointIndex(
  messages: BrowserIncomingMessage[],
  checkpoints: Array<{ turn: number; ts: number; hash: string }>,
): ExportedCheckpoint[] {
  // Find all "result" message indices — each result marks the end of a turn
  const resultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "result") {
      resultIndices.push(i);
    }
  }

  // Sort checkpoints by timestamp to ensure order
  const sortedCps = [...checkpoints].sort((a, b) => a.ts - b.ts);

  return sortedCps.map((cp, cpIdx) => {
    // Map each checkpoint to a result message by order:
    // Checkpoint 0 → result 0, checkpoint 1 → result 1, etc.
    // If there are more checkpoints than results, spread them evenly
    let endIdx: number;
    if (resultIndices.length > 0) {
      const resultIdx = Math.min(cpIdx, resultIndices.length - 1);
      endIdx = resultIndices[resultIdx];
    } else {
      // No result messages — distribute evenly across message count
      endIdx = Math.round(((cpIdx + 1) / sortedCps.length) * (messages.length - 1));
    }

    // Find the user_message that started this turn
    let startIdx = 0;
    for (let j = endIdx - 1; j >= 0; j--) {
      if (messages[j].type === "user_message") {
        startIdx = j;
        break;
      }
    }

    return {
      turn: cp.turn,
      timestamp: cp.ts,
      hash: cp.hash,
      label: `Step ${cpIdx + 1}`,
      filesChanged: 0,
      filesAdded: 0,
      filesDeleted: 0,
      messageSeqRange: [startIdx, endIdx] as [number, number],
    };
  });
}

function scanWorkspaceFiles(workspace: string): { path: string; lines: number }[] {
  const results: { path: string; lines: number }[] = [];
  const ignore = new Set([".pneuma", "node_modules", ".git", ".claude", ".agents", "dist", ".DS_Store"]);

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (ignore.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && stat.size < 1_000_000) {
        try {
          const content = readFileSync(full, "utf-8");
          const lines = content.split("\n").length;
          results.push({ path: relative(workspace, full), lines });
        } catch { /* skip binary */ }
      }
    }
  }

  try { walk(workspace); } catch { /* empty workspace */ }
  return results;
}
