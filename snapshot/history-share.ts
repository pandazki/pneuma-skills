/**
 * History share: push (upload) and pull (download) history packages via R2.
 */

import { unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { getCredentials, uploadToR2 } from "./r2.js";
import { exportHistory } from "../server/history-export.js";

/**
 * Export history from a workspace and upload to R2.
 * Returns the public URL of the uploaded history package.
 */
export async function pushHistory(workspace: string, title?: string): Promise<string> {
  // 1. Export history to temp file
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const exportName = `history-${basename(workspace)}-${timestamp}.tar.gz`;
  const exportPath = join(tmpdir(), exportName);

  console.log("[history] Exporting history...");
  const result = await exportHistory(workspace, { output: exportPath, title });
  console.log(`[history] Exported ${result.messageCount} messages, ${result.checkpointCount} checkpoints`);

  // 2. Upload to R2
  const creds = await getCredentials();
  const key = `histories/${exportName}`;
  console.log("[history] Uploading to R2...");
  const publicUrl = await uploadToR2(exportPath, key, creds);

  // 3. Cleanup
  try { unlinkSync(exportPath); } catch {}

  console.log(`[history] Uploaded successfully!`);
  console.log(`[history] URL: ${publicUrl}`);
  console.log(`[history] To replay: pneuma history open ${publicUrl}`);

  return publicUrl;
}

/**
 * Download a history package from a URL.
 * Returns the local path of the downloaded file.
 */
export async function pullHistory(url: string, targetDir?: string): Promise<string> {
  console.log(`[history] Downloading: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const archiveName = basename(new URL(url).pathname) || "history.tar.gz";
  const downloadPath = join(targetDir ?? tmpdir(), archiveName);

  const data = await response.arrayBuffer();
  await Bun.write(downloadPath, data);

  console.log(`[history] Downloaded to: ${downloadPath}`);
  return downloadPath;
}
