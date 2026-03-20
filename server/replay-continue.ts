import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initShadowGit } from "./shadow-git.js";
import type { SessionSummary } from "../core/types/shared-history.js";

interface ContinueOptions {
  originalMode: string;
  summary: SessionSummary;
  backendType?: string;
}

/**
 * Prepare workspace for Continue Work transition:
 * 1. Clear replay-era checkpoint and history data
 * 2. Write resumed-context.xml for skill installer injection
 * 3. Re-initialize shadow-git (current files become initial commit)
 * 4. Update session.json with resumedFrom marker
 */
export async function prepareWorkspaceForContinue(
  workspace: string,
  options: ContinueOptions,
): Promise<void> {
  const pneumaDir = join(workspace, ".pneuma");
  mkdirSync(pneumaDir, { recursive: true });

  // 1. Clear old checkpoint index and history
  writeFileSync(join(pneumaDir, "checkpoints.jsonl"), "");
  writeFileSync(join(pneumaDir, "history.json"), "[]");

  // 2. Remove old shadow.git so initShadowGit creates fresh one
  const shadowGitDir = join(pneumaDir, "shadow.git");
  if (existsSync(shadowGitDir)) {
    rmSync(shadowGitDir, { recursive: true, force: true });
  }

  // 3. Remove replay temp dirs
  const replayCheckout = join(pneumaDir, "replay-checkout");
  if (existsSync(replayCheckout)) {
    rmSync(replayCheckout, { recursive: true, force: true });
  }
  const replayDir = join(pneumaDir, "replay");
  if (existsSync(replayDir)) {
    rmSync(replayDir, { recursive: true, force: true });
  }

  // 4. Re-initialize shadow-git (current workspace files = initial commit)
  await initShadowGit(workspace);

  // 5. Write resumed-context.xml for skill-installer injection
  const contextXml = buildResumedContextXml(options.summary, options.originalMode);
  writeFileSync(join(pneumaDir, "resumed-context.xml"), contextXml, "utf-8");

  // 6. Update session.json with resumedFrom marker
  const sessionPath = join(pneumaDir, "session.json");
  if (existsSync(sessionPath)) {
    const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
    session.resumedFrom = {
      timestamp: Date.now(),
      originalMode: options.originalMode,
    };
    // Clear replay-era session ID so a fresh one is created
    delete session.agentSessionId;
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }
}

function buildResumedContextXml(summary: SessionSummary, mode: string): string {
  const keyDecisions = summary.keyDecisions.length > 0
    ? summary.keyDecisions.map((d) => `- ${d}`).join("\n    ")
    : "- No key decisions recorded";

  const workspaceFiles = summary.workspaceFiles.length > 0
    ? summary.workspaceFiles.map((f) => `- ${f.path} (${f.lines} lines)`).join("\n    ")
    : "- No files recorded";

  return `<resumed-session original-mode="${mode}">
  <summary>
    This is a resumed work session. The following is a summary of the previous work.
    Continue naturally from where the previous session left off.

    ## Overview
    ${summary.overview}

    ## Key Decisions
    ${keyDecisions}

    ## Current Files
    ${workspaceFiles}
  </summary>

  <recent-conversation>
    ${summary.recentConversation || "No recent conversation recorded."}
  </recent-conversation>
</resumed-session>`;
}
