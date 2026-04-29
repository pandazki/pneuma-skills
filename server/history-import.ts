// server/history-import.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import type { SharedHistoryPackage } from "../core/types/shared-history.js";
import type { BrowserIncomingMessage } from "./session-types.js";

export interface ImportedPackage {
  manifest: SharedHistoryPackage;
  messages: BrowserIncomingMessage[];
  hasBundle: boolean;
  importDir: string;
  extractCheckpointFiles: (hash: string, outDir: string) => Promise<void>;
}

/** Load a replay package from a tar.gz file or an already-extracted directory */
export async function importHistory(pathOrDir: string, importDir?: string): Promise<ImportedPackage> {
  let dir: string;
  const { statSync: stat } = await import("node:fs");

  if (stat(pathOrDir).isDirectory()) {
    // Already extracted directory (e.g. .pneuma/replay/)
    dir = pathOrDir;
  } else {
    // tar.gz file — extract it
    dir = importDir ?? mkdtempSync(join(tmpdir(), "pneuma-import-"));
    mkdirSync(dir, { recursive: true });
    await Bun.spawn(["tar", "xzf", pathOrDir, "-C", dir], { stdout: "ignore", stderr: "ignore" }).exited;
  }

  // Read manifest
  const manifest: SharedHistoryPackage = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));

  // Read messages from JSONL
  const messagesContent = readFileSync(join(dir, "messages.jsonl"), "utf-8");
  const messages: BrowserIncomingMessage[] = messagesContent
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // Check for bundle
  const bundlePath = join(dir, "repo.bundle");
  const hasBundle = existsSync(bundlePath);

  // Clone bundle to a local bare repo for checkout operations
  let repoDir: string | null = null;
  if (hasBundle) {
    repoDir = join(dir, ".shadow-repo");
    await Bun.spawn(
      ["git", "clone", "--bare", bundlePath, repoDir],
      { stdout: "ignore", stderr: "ignore" },
    ).exited;
  }

  return {
    manifest,
    messages,
    hasBundle,
    importDir: dir,
    extractCheckpointFiles: async (hash: string, outDir: string) => {
      if (!repoDir) throw new Error("No bundle available for checkpoint extraction");
      mkdirSync(outDir, { recursive: true });
      const archive = Bun.spawn(
        ["git", `--git-dir=${repoDir}`, "archive", hash],
        { stdout: "pipe", stderr: "ignore" },
      );
      const extract = Bun.spawn(
        ["tar", "x", "-C", outDir],
        { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" },
      );
      await extract.exited;
    },
  };
}

/**
 * @param pkg - Imported replay package
 * @param targetWorkspace - Where to extract checkpoint files
 * @param options - Optional stateDir override; defaults to `<targetWorkspace>/.pneuma`
 */
export async function restoreWorkspaceFromHistory(
  pkg: ImportedPackage,
  targetWorkspace: string,
  options: { stateDir?: string } = {},
): Promise<void> {
  const { manifest, hasBundle } = pkg;
  const stateDir = options.stateDir ?? join(targetWorkspace, ".pneuma");

  // 1. Extract last checkpoint's files to workspace
  if (hasBundle && manifest.checkpoints.length > 0) {
    const lastCheckpoint = manifest.checkpoints[manifest.checkpoints.length - 1];
    await pkg.extractCheckpointFiles(lastCheckpoint.hash, targetWorkspace);
  }

  // 2. Create state directory
  mkdirSync(stateDir, { recursive: true });

  // 3. Write resumed-context.xml from summary
  const summary = manifest.summary;
  const contextXml = `<resumed-session original-turns="${manifest.metadata.totalTurns}" original-mode="${manifest.metadata.mode}">
  <summary>
    This is a resumed session from shared history. Continue naturally from where the previous session left off.

    ## Overview
    ${summary.overview}

    ## Key Decisions
${summary.keyDecisions.map((d) => `    - ${d}`).join("\n")}

    ## Current Files
${summary.workspaceFiles.map((f) => `    - ${f.path} (${f.lines} lines)`).join("\n")}
  </summary>
  <recent-conversation>
${summary.recentConversation}
  </recent-conversation>
</resumed-session>`;

  writeFileSync(join(stateDir, "resumed-context.xml"), contextXml);

  // 4. Write session.json for the new session
  writeFileSync(join(stateDir, "session.json"), JSON.stringify({
    sessionId: crypto.randomUUID(),
    mode: manifest.metadata.mode,
    backendType: manifest.metadata.backendType,
    createdAt: Date.now(),
    resumedFrom: manifest.metadata.id,
  }));
}
