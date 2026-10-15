import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { chmodSync, mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { loadProjectManifest, writeProjectManifest } from "../../core/project-loader.js";
import type { CollaborationAuthority, LocalCollaborationBinding, LocalCollaborationRoom } from "../../core/types/collaboration-workspace.js";

export const collaborationStateDir = (projectRoot: string) => join(projectRoot, ".pneuma", "collaboration");
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function parseCollaborationAuthority(value: unknown): CollaborationAuthority {
  if (!value || typeof value !== "object") throw new Error("Choose a collaboration authority.");
  const input = value as CollaborationAuthority;
  if (input.kind !== "lan" && input.kind !== "cloud") throw new Error("Unknown collaboration authority placement.");
  const url = new URL(input.origin);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !["http:", "https:"].includes(url.protocol)
    || input.kind === "cloud" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Use an HTTP(S) authority origin; cloud authorities require HTTPS outside loopback development.");
  }
  if (input.publicKey !== undefined && (input.kind !== "lan" || typeof input.publicKey !== "string" || !/^[A-Za-z0-9+/]{32,256}={0,2}$/.test(input.publicKey)))
    throw new Error("Invalid pinned LAN authority identity.");
  return { kind: input.kind, origin: url.origin, ...(input.publicKey ? { publicKey: input.publicKey } : {}) };
}

async function readOptional(path: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read collaboration state: ${error instanceof SyntaxError ? "invalid JSON" : "filesystem read failed"}`);
  }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

/** SQLite's OS lock releases on process death; stale PID files cannot strand setup. */
export function acquireCollaborationLease(path: string, busyMessage: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  chmodSync(path, 0o600);
  try { db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); }
  catch (error) {
    db.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new Error(busyMessage);
    throw error;
  }
  let released = false;
  return () => { if (!released) { released = true; try { db.exec("ROLLBACK"); } finally { db.close(); } } };
}

/** Prevent two private Session processes from minting competing Project bindings. */
export async function withCollaborationSetupLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
  const release = acquireCollaborationLease(join(collaborationStateDir(projectRoot), "setup-lease.sqlite"),
    "Another Session is configuring this project's collaboration. Retry when it finishes.");
  try { return await action(); } finally { release(); }
}

export async function ensurePortableProjectId(projectRoot: string, requestedId?: string): Promise<string> {
  if (requestedId !== undefined && !ID.test(requestedId)) throw new Error("Invalid shared project ID.");
  const manifest = await loadProjectManifest(projectRoot);
  if (!manifest) throw new Error("Collaboration belongs to a Pneuma Project. Create or open a Project first.");
  if (manifest.id && requestedId && manifest.id !== requestedId) {
    const existing = await readLocalCollaborationBinding(projectRoot);
    if (existing) throw new Error("This local project already belongs to a different shared project.");
  }
  const id = requestedId ?? manifest.id ?? crypto.randomUUID();
  if (manifest.id !== id) await writeProjectManifest(projectRoot, { ...manifest, id });
  return id;
}

export async function readLocalCollaborationBinding(projectRoot: string): Promise<LocalCollaborationBinding | null> {
  const raw = await readOptional(join(collaborationStateDir(projectRoot), "local.json"));
  if (raw === null) return null;
  const value = raw as LocalCollaborationBinding;
  if (value.version !== 1 || !ID.test(value.projectId) || !value.workspace || !ID.test(value.workspace.id)
    || value.workspace.projectId !== value.projectId || !ID.test(value.workspace.ownerId)
    || value.workspace.placement !== "local" || typeof value.workspace.name !== "string"
    || typeof value.memberToken !== "string" || value.memberToken.length < 16 || typeof value.memberName !== "string") {
    throw new Error("Local collaboration binding is invalid; reconnect this Project explicitly.");
  }
  return { ...value, authority: parseCollaborationAuthority(value.authority) };
}

export async function writeLocalCollaborationBinding(projectRoot: string, value: LocalCollaborationBinding): Promise<void> {
  await writePrivateJson(join(collaborationStateDir(projectRoot), "local.json"), value);
}

export async function readLocalCollaborationRoom(stateDir: string): Promise<LocalCollaborationRoom | null> {
  const raw = await readOptional(join(stateDir, "collaboration-room.json"));
  if (raw === null) return null;
  const value = raw as LocalCollaborationRoom;
  if (value.version !== 1 || ![value.projectId, value.workspaceId, value.modeInstanceId, value.roomId].every((id) => typeof id === "string" && ID.test(id))
    || typeof value.publisherToken !== "string" || value.publisherToken.length < 16
    || typeof value.title !== "string" || typeof value.enabled !== "boolean"
    || value.contentSet !== null && typeof value.contentSet !== "string"
    || value.activeFile !== null && typeof value.activeFile !== "string") throw new Error("Session collaboration attachment is invalid.");
  return value;
}

export async function writeLocalCollaborationRoom(stateDir: string, room: LocalCollaborationRoom): Promise<void> {
  await writePrivateJson(join(stateDir, "collaboration-room.json"), room);
}
