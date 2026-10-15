import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_LIMITS, type ContentSnapshot, type PublishedFile } from "./content.js";

export type { MemberRecord, RoomRecord } from "../../core/collaboration/authority-domain.js";
import { retainedCollaborationRevisions } from "../../core/collaboration/authority-domain.js";
import type { CollaborationReference } from "../../core/types/collaboration-reference.js";
import type { ProjectData } from "../../core/collaboration/authority-domain.js";
import type { CollaborationPublicationProjection } from "../../core/types/collaboration-publication.js";
export type DurableState = ProjectData;

/** SQLite owns accepted metadata, operation receipts and immutable resource revisions. */
export class CollaborationStore {
  readonly db: Database;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.db = new Database(join(stateDir, "collaboration.sqlite"), { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (
        actor TEXT NOT NULL, op_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(actor, op_id)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        room_id TEXT NOT NULL, revision INTEGER NOT NULL, manifest TEXT NOT NULL, projection TEXT,
        PRIMARY KEY(room_id, revision)
      );
      CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (hash TEXT PRIMARY KEY, size INTEGER NOT NULL);
    `);
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(snapshots)").all();
    if (!columns.some((column) => column.name === "projection")) this.db.exec("ALTER TABLE snapshots ADD COLUMN projection TEXT");
  }

  load(): DurableState | null {
    const row = this.db.query<{ value: string }, []>("SELECT value FROM state WHERE id=1").get();
    return row ? JSON.parse(row.value) as DurableState : null;
  }

  save(state: DurableState): void {
    this.db.query("INSERT OR REPLACE INTO state(id,value) VALUES(1,?)").run(JSON.stringify(state));
  }

  receipt(actor: string, opId: string): { fingerprint: string; result: unknown } | null {
    const row = this.db.query<{ fingerprint: string; result: string }, [string, string]>(
      "SELECT fingerprint,result FROM operations WHERE actor=? AND op_id=?",
    ).get(actor, opId);
    return row ? { fingerprint: row.fingerprint, result: JSON.parse(row.result) } : null;
  }

  record(actor: string, opId: string, fingerprint: string, result: unknown): void {
    this.db.query("INSERT INTO operations(actor,op_id,fingerprint,result) VALUES(?,?,?,?)")
      .run(actor, opId, fingerprint, JSON.stringify(result));
  }

  receiptCount(): number {
    return this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operations").get()!.count;
  }

  snapshot(roomId: string, revision: number, snapshot: ContentSnapshot, projection?: CollaborationPublicationProjection): void {
    const insert = this.db.query("INSERT OR IGNORE INTO blobs(hash,bytes) VALUES(?,?)");
    for (const [digest, bytes] of snapshot.blobs) insert.run(digest, bytes);
    this.db.query("INSERT INTO snapshots(room_id,revision,manifest,projection) VALUES(?,?,?,?)")
      .run(roomId, revision, JSON.stringify(snapshot.files), projection ? JSON.stringify(projection) : null);
    this.prune(roomId, this.load()?.references ?? []);
    // The bounded experiment retains eight manifests per room and their reachable blobs.
    this.db.exec(`DELETE FROM blobs WHERE hash NOT IN (
      SELECT json_extract(entry.value, '$.hash') FROM snapshots, json_each(snapshots.manifest) AS entry
      UNION SELECT hash FROM uploads
    )`);
  }

  prune(roomId: string, references: CollaborationReference[]): void {
    const revisions = this.db.query<{ revision: number }, [string]>("SELECT revision FROM snapshots WHERE room_id=? ORDER BY revision DESC").all(roomId).map((row) => row.revision);
    const retained = retainedCollaborationRevisions(revisions, references, roomId);
    const remove = this.db.query("DELETE FROM snapshots WHERE room_id=? AND revision=?");
    for (const revision of revisions) if (!retained.has(revision)) remove.run(roomId, revision);
  }

  file(roomId: string, revision: number, path: string): { file: PublishedFile; bytes: Uint8Array } | null {
    const row = this.db.query<{ manifest: string }, [string, number]>(
      "SELECT manifest FROM snapshots WHERE room_id=? AND revision=?",
    ).get(roomId, revision);
    if (!row) return null;
    const file = (JSON.parse(row.manifest) as PublishedFile[]).find((entry) => entry.path === path);
    if (!file) return null;
    const blob = this.db.query<{ bytes: Uint8Array }, [string]>("SELECT bytes FROM blobs WHERE hash=?").get(file.hash);
    return blob ? { file, bytes: blob.bytes } : null;
  }

  manifest(roomId: string, revision: number): { files: PublishedFile[]; projection?: CollaborationPublicationProjection } | null {
    const row = this.db.query<{ manifest: string; projection: string | null }, [string, number]>("SELECT manifest,projection FROM snapshots WHERE room_id=? AND revision=?").get(roomId, revision);
    return row ? { files: JSON.parse(row.manifest), ...(row.projection ? { projection: JSON.parse(row.projection) } : {}) } : null;
  }

  upload(hash: string, bytes: Uint8Array): void {
    this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO blobs(hash,bytes) VALUES(?,?)").run(hash, bytes);
      this.db.query("INSERT OR IGNORE INTO uploads(hash,size) VALUES(?,?)").run(hash, bytes.length);
    })();
  }
  uploaded(hash: string): Uint8Array | null {
    return this.db.query<{ bytes: Uint8Array }, [string]>("SELECT blobs.bytes FROM blobs JOIN uploads USING(hash) WHERE hash=?").get(hash)?.bytes ?? null;
  }
  uploadUsage(): { count: number; size: number } {
    return this.db.query<{ count: number; size: number }, []>("SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS size FROM uploads").get()!;
  }

  close(): void { this.db.close(); }
}
