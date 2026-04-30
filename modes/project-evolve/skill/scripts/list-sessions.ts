#!/usr/bin/env bun
/**
 * list-sessions.ts — List available Claude Code sessions with metadata.
 *
 * Usage:
 *   bun list-sessions.ts [--since 2026-03-01] [--project <pattern>] [--limit 20]
 *
 * Output: NDJSON, one session per line, sorted by modification time (newest first).
 */

import {
  listProjectDirs,
  listSessionFiles,
  decodeProjectName,
  streamJsonl,
  isUserTextMessage,
  parseCommonArgs,
} from "./_shared.ts";

const args = parseCommonArgs();
const sinceDate = args.since ? new Date(args.since as string) : null;
const projectFilter = (args.project as string) ?? null;
const limit = args.limit ? parseInt(args.limit as string, 10) : 0;

async function main() {
  const projectDirs = await listProjectDirs(projectFilter);
  const allSessions: any[] = [];

  for (const dir of projectDirs) {
    const sessions = await listSessionFiles(dir);
    for (const s of sessions) {
      if (sinceDate && s.mtime < sinceDate) continue;
      allSessions.push({
        projectDir: dir,
        projectName: decodeProjectName(dir),
        ...s,
      });
    }
  }

  allSessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const toProcess = limit > 0 ? allSessions.slice(0, limit) : allSessions;

  for (const session of toProcess) {
    let userMsgCount = 0;
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let sessionId: string | null = null;

    await streamJsonl(session.path, (obj) => {
      if (!sessionId && obj.sessionId) sessionId = obj.sessionId;
      if (obj.timestamp) {
        if (!firstTimestamp) firstTimestamp = obj.timestamp;
        lastTimestamp = obj.timestamp;
      }
      if (isUserTextMessage(obj)) userMsgCount++;
    });

    const result: any = {
      session_id: sessionId ?? session.file.replace(".jsonl", ""),
      project: session.projectName,
      project_dir: session.projectDir,
      path: session.path,
      modified: session.mtime.toISOString(),
      size_kb: Math.round(session.size / 1024),
      user_msg_count: userMsgCount,
    };
    if (firstTimestamp) result.time_start = firstTimestamp;
    if (lastTimestamp) result.time_end = lastTimestamp;

    console.log(JSON.stringify(result));
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
