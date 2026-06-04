// server/play-export.ts
//
// Materialize a session into a static, browser-fetchable "play package" for the
// hosted player. Reuses the same manifest/messages assembly as the tar.gz
// history export, then walks each checkpoint's git tree to write a
// content-addressed blob store + per-checkpoint file manifests.

import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildHistoryArtifacts } from "./history-export.js";
import { listCheckpointTree, readCheckpointBlob } from "./shadow-git.js";
import { isModeWebPlayable } from "../core/player-support.js";
import type { CheckpointManifest, PlayFileEntry, PlayPackageIndex } from "../core/types/play-package.js";

interface MaterializeOptions {
  output?: string;
  title?: string;
  description?: string;
  stateDir?: string;
  /** tar.gz history-package URL for the local-client badge. */
  importUrl?: string;
}

export interface MaterializeResult {
  /** Local staging directory containing the full play package. */
  dir: string;
  index: PlayPackageIndex;
  checkpointCount: number;
  blobCount: number;
  totalBytes: number;
}

/**
 * Build a play package under a staging directory. Caller is responsible for
 * uploading (`uploadPlayPackage`) and cleaning up the directory.
 */
export async function materializePlayPackage(
  workspace: string,
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const { manifest, messagesJsonl } = await buildHistoryArtifacts(workspace, {
    title: options.title,
    description: options.description,
    stateDir: options.stateDir,
  });

  const dir = options.output ?? mkdtempSync(join(tmpdir(), "pneuma-play-"));
  mkdirSync(join(dir, "checkpoints"), { recursive: true });
  mkdirSync(join(dir, "blobs"), { recursive: true });

  // Walk each checkpoint's tree; collect file manifests + unique blobs.
  const seenBlobs = new Set<string>();
  let blobCount = 0;
  let totalBytes = 0;

  for (const cp of manifest.checkpoints) {
    if (!cp.hash) continue; // skip checkpoints without a resolvable hash
    const tree = await listCheckpointTree(workspace, cp.hash, options.stateDir);
    const files: PlayFileEntry[] = tree.map((t) => ({ path: t.path, blob: t.blob, size: t.size }));

    const cpManifest: CheckpointManifest = { turn: cp.turn, hash: cp.hash, files };
    writeFileSync(join(dir, "checkpoints", `${cp.hash}.json`), JSON.stringify(cpManifest));

    for (const t of tree) {
      if (seenBlobs.has(t.blob)) continue;
      seenBlobs.add(t.blob);
      const bytes = await readCheckpointBlob(workspace, t.blob, options.stateDir);
      writeFileSync(join(dir, "blobs", t.blob), bytes);
      blobCount++;
      totalBytes += bytes.byteLength;
    }
  }

  const index: PlayPackageIndex = {
    playFormat: 1,
    id: manifest.metadata.id,
    mode: manifest.metadata.mode,
    supported: isModeWebPlayable(manifest.metadata.mode),
    manifest,
    importUrl: options.importUrl,
  };
  writeFileSync(join(dir, "play.json"), JSON.stringify(index));
  writeFileSync(join(dir, "messages.jsonl"), messagesJsonl);

  return { dir, index, checkpointCount: manifest.checkpoints.length, blobCount, totalBytes };
}

interface S3Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function contentTypeFor(name: string): string {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".jsonl")) return "application/x-ndjson";
  // blobs/* — the player's service worker sets the real type by extension on
  // serve; a direct fetch gets a generic type, which is fine.
  return "application/octet-stream";
}

function walkFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(root, full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Upload a materialized play package directory to R2 under `plays/<id>/`.
 * Uploads concurrently with a small pool. Returns the public base URL of the
 * package directory.
 */
export async function uploadPlayPackage(
  localDir: string,
  id: string,
  s3: S3Config,
  publicUrl: string,
): Promise<string> {
  const client = new Bun.S3Client({
    endpoint: `https://${s3.accountId}.r2.cloudflarestorage.com`,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    bucket: s3.bucket,
  });

  const files = walkFiles(localDir);
  const prefix = `plays/${id}`;
  const concurrency = 8;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (full) => {
        const rel = relative(localDir, full).split("\\").join("/");
        const key = `${prefix}/${rel}`;
        const body = await Bun.file(full).arrayBuffer();
        await client.file(key).write(body, { type: contentTypeFor(rel) });
      }),
    );
  }

  return `${publicUrl}/${prefix}`;
}
