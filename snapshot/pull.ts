/**
 * Snapshot pull: download from URL + extract to workspace.
 */

import { join, basename, resolve, dirname } from "node:path";
import { mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as readline from "node:readline";
import { extractArchive } from "./archive.js";
import type { SnapshotMetadata } from "./types.js";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => {
    rl.question(question, (answer) => { rl.close(); r(answer.trim()); });
  });
}

/**
 * Pull a snapshot from a URL and extract to workspace directory.
 */
export async function pull(url: string, workspace: string): Promise<void> {
  console.log(`[snapshot] Pulling from: ${url}`);
  console.log(`[snapshot] Target workspace: ${workspace}`);

  // 1. Check if workspace already exists and has files
  if (existsSync(workspace)) {
    try {
      const entries = readdirSync(workspace);
      if (entries.length > 0) {
        const answer = await ask(
          `[snapshot] Directory already exists and is not empty: ${workspace}\n` +
          `  Extracting will overwrite existing files. Continue? [y/N] `,
        );
        if (answer.toLowerCase() !== "y") {
          console.log("[snapshot] Aborted.");
          process.exit(0);
        }
      }
    } catch {}
  }

  // 2. Download the archive
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[snapshot] Download failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const archiveName = basename(new URL(url).pathname) || "snapshot.tar.gz";
  const archivePath = join(tmpdir(), archiveName);

  const data = await response.arrayBuffer();
  await Bun.write(archivePath, data);

  const sizeMB = (data.byteLength / 1024 / 1024).toFixed(2);
  console.log(`[snapshot] Downloaded: ${sizeMB} MB`);

  // 2. Extract
  mkdirSync(workspace, { recursive: true });
  console.log("[snapshot] Extracting...");
  await extractArchive(archivePath, workspace);

  // 3. Clean up temp file
  const { unlinkSync } = await import("node:fs");
  try { unlinkSync(archivePath); } catch {}

  // 4. Read snapshot metadata to determine mode
  let mode = "<mode>";
  try {
    const meta: SnapshotMetadata = JSON.parse(
      readFileSync(join(workspace, ".pneuma-snapshot.json"), "utf-8"),
    );
    mode = meta.mode;
  } catch {}

  const runCmd = `bunx pneuma-skills ${mode} --workspace ${workspace}`;
  console.log(`[snapshot] Extracted to: ${workspace}`);
  console.log(`\n  Run later with:\n    ${runCmd}`);

  // Offer to launch immediately
  if (mode !== "<mode>") {
    const answer = await ask("\nLaunch now? [Y/n] ");
    if (answer.toLowerCase() !== "n") {
      const binPath = resolve(dirname(import.meta.path), "..", "bin", "pneuma.ts");
      const proc = Bun.spawn(["bun", binPath, mode, "--workspace", workspace], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    }
  }
}
