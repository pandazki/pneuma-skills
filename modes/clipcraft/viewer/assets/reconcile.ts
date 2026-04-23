/**
 * Pure reconciliation of the workspace `assets/` directory listing
 * against the in-memory `project.json.assets[]` registry. No I/O here;
 * the caller fetches the filesystem listing (e.g. from the server
 * `/api/assets/fs-listing` route) and hands the registry view in.
 *
 * URIs are compared literally (byte-for-byte) — callers are expected
 * to normalize both sides to workspace-relative forward-slash paths.
 */

export interface FsEntry {
  /** Workspace-relative path with forward slashes, e.g. "assets/video/foo.mp4". */
  uri: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
}

export interface RegisteredEntry {
  assetId: string;
  uri: string;
}

export interface RegisteredReconciled extends RegisteredEntry {
  size: number;
  mtime: number;
}

export interface ReconcileReport {
  registered: RegisteredReconciled[];
  orphaned: FsEntry[];
  missing: RegisteredEntry[];
}

export function reconcileAssets(
  fsList: FsEntry[],
  registered: RegisteredEntry[],
): ReconcileReport {
  const fsByUri = new Map<string, FsEntry>();
  for (const entry of fsList) fsByUri.set(entry.uri, entry);

  const registeredUris = new Set<string>();
  const registeredOut: RegisteredReconciled[] = [];
  const missing: RegisteredEntry[] = [];

  for (const entry of registered) {
    registeredUris.add(entry.uri);
    const fs = fsByUri.get(entry.uri);
    if (fs) {
      registeredOut.push({ ...entry, size: fs.size, mtime: fs.mtime });
    } else {
      missing.push(entry);
    }
  }

  const orphaned: FsEntry[] = [];
  for (const entry of fsList) {
    if (!registeredUris.has(entry.uri)) orphaned.push(entry);
  }

  return { registered: registeredOut, orphaned, missing };
}
