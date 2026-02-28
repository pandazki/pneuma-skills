/**
 * Snapshot push: archive workspace + upload to R2.
 */

import { join, basename } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createArchive } from "./archive.js";
import { getCredentials, uploadToR2 } from "./r2.js";
import { loadModeManifest } from "../core/mode-loader.js";
import type { SnapshotMetadata } from "./types.js";

/**
 * Detect mode from .pneuma/session.json in workspace.
 */
function detectMode(workspace: string): string | null {
  try {
    const content = readFileSync(join(workspace, ".pneuma", "session.json"), "utf-8");
    const session = JSON.parse(content);
    return session.mode ?? null;
  } catch {
    return null;
  }
}

/**
 * Read project version from package.json.
 */
function getVersion(): string {
  try {
    const pkg = readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8");
    return JSON.parse(pkg).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Push a workspace snapshot to R2.
 */
export async function push(workspace: string, modeArg?: string, includeSkills?: boolean): Promise<void> {
  // 1. Determine mode
  const mode = modeArg ?? detectMode(workspace);
  if (!mode) {
    console.error(
      "[snapshot] Cannot determine mode. Either run from a workspace with .pneuma/session.json " +
      "or pass --mode <doc|slide>.",
    );
    process.exit(1);
  }

  console.log(`[snapshot] Pushing workspace: ${workspace}`);
  console.log(`[snapshot] Mode: ${mode}`);
  if (includeSkills) {
    console.log("[snapshot] Including .claude/ skills in archive");
  }

  // 2. Write snapshot metadata into workspace
  const metadata: SnapshotMetadata = {
    mode,
    version: getVersion(),
    createdAt: new Date().toISOString(),
    workspace: basename(workspace),
    ...(includeSkills ? { includeSkills: true } : {}),
  };

  const metadataPath = join(workspace, ".pneuma-snapshot.json");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log("[snapshot] Created .pneuma-snapshot.json");

  // 3. Load manifest to find sensitive param names
  let sensitiveKeys: string[] = [];
  try {
    const manifest = await loadModeManifest(mode);
    sensitiveKeys = (manifest.init?.params ?? [])
      .filter((p) => p.sensitive)
      .map((p) => p.name);
    if (sensitiveKeys.length > 0) {
      console.log(`[snapshot] Stripping sensitive config keys: ${sensitiveKeys.join(", ")}`);
    }
  } catch {}

  // 4. Create archive
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").replace(/\.\d+Z/, "").slice(0, 15);
  const archiveName = `${mode}-${basename(workspace)}-${timestamp}.tar.gz`;
  const archivePath = join(tmpdir(), archiveName);

  console.log(`[snapshot] Creating archive: ${archiveName}`);
  await createArchive(workspace, archivePath, { includeSkills, sensitiveKeys });

  const file = Bun.file(archivePath);
  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[snapshot] Archive size: ${sizeMB} MB`);

  // 4. Get credentials and upload
  const creds = await getCredentials();
  const key = `snapshots/${archiveName}`;

  console.log("[snapshot] Uploading to R2...");
  const publicUrl = await uploadToR2(archivePath, key, creds);

  // 5. Clean up temp file and metadata in workspace
  const { unlinkSync } = await import("node:fs");
  try { unlinkSync(archivePath); } catch {}
  try { unlinkSync(metadataPath); } catch {}

  console.log(`\n[snapshot] Uploaded successfully!`);
  console.log(`[snapshot] URL: ${publicUrl}`);
  console.log(`\n  Pull with:\n    bunx pneuma-skills snapshot pull ${publicUrl} --workspace /tmp/pneuma-slide`);
}
