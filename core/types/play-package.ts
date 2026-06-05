import type { SharedHistoryPackage } from "./shared-history.js";

/**
 * On-disk / on-R2 layout of a **materialized play package** consumed by the
 * hosted static player. Unlike the tar.gz history package (which ships a git
 * bundle and is unpacked by a Bun server), this is a fully static, browser-
 * fetchable directory:
 *
 *   plays/<id>/
 *     play.json                 # PlayPackageIndex (this type)
 *     messages.jsonl            # sanitized message stream (same as history export)
 *     checkpoints/<hash>.json   # CheckpointManifest per checkpoint
 *     blobs/<gitBlobSha>        # raw file bytes, content-addressed + deduped
 *
 * The player fetches play.json once, then per active checkpoint fetches
 * checkpoints/<hash>.json and resolves each file's bytes from blobs/<sha>.
 * Git blob ids are reused as the content-address key — identical file content
 * across checkpoints stores one blob.
 */
export interface PlayPackageIndex {
  playFormat: 1;
  id: string;
  mode: string;
  /**
   * Whether the hosted player can render this mode. False for modes that
   * require the local client (clipcraft, mode-maker, custom modes, …) — the
   * player shows an "open in local client" fallback instead.
   */
  supported: boolean;
  manifest: SharedHistoryPackage;
  /** tar.gz history-package URL for the "open in local client" badge (pneuma://import/<url>). */
  importUrl?: string;
}

export interface PlayFileEntry {
  /** Workspace-relative path (e.g. "site/index.html", "assets/hero.webp"). */
  path: string;
  /** Git blob object id — content-addressed dedup key; basename of blobs/<sha>. */
  blob: string;
  /** Byte size of the file. */
  size: number;
}

export interface CheckpointManifest {
  /** Turn index of this checkpoint. */
  turn: number;
  /** Git short hash — matches ExportedCheckpoint.hash; the player checks out by this. */
  hash: string;
  /** Every file present in the workspace at this checkpoint. */
  files: PlayFileEntry[];
}
