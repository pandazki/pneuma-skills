import type { Hono } from "hono";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { canWriteCollaboration, type CollaborationProjectState } from "../../core/types/collaboration.js";
import { COLLABORATION_ASSET_TYPES, COLLABORATION_CONTENT_LIMITS, isCollaborationPublicPath, type CollaborationPublishedFile } from "../../core/types/collaboration-publication.js";
import type { CollaborationResolvedReference } from "../../core/types/collaboration-reference.js";
import type { CollaborationReferenceImportReceipt } from "../../core/types/collaboration-reference-import.js";
import { isViewerViewState } from "../../core/types/viewer-collaboration.js";
import { collaborationAuthorityBase, type LocalCollaborationBinding } from "../../core/types/collaboration-workspace.js";
import { isContained } from "../utils.js";
import { acquireCollaborationLease, readLocalCollaborationBinding, writePrivateJson } from "./local-state.js";

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ATTRIBUTION = ".pneuma-import.json"; // All dot-paths are excluded by isCollaborationPublicPath.
class ImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
interface ReferenceImportOptions { projectRoot?: string; workspace: string; stateDir: string }
interface ImportOperation { version: 1; receipt: CollaborationReferenceImportReceipt }
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const encodedPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new ImportError(message, status);
}
function checkedPath(root: string, relative: string): string {
  const path = resolve(root, relative);
  ensure(isContained(path, root), "The import path escapes this private workspace.");
  return path;
}
async function optionalJson(path: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ImportError("The local import receipt cannot be read. Restore it before retrying.", 409);
  }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Validate the complete manifest before any resource request or workspace file write. */
function manifestFiles(input: unknown): CollaborationPublishedFile[] {
  ensure(Array.isArray(input) && input.length > 0 && input.length <= COLLABORATION_CONTENT_LIMITS.files, "The pinned publication has an invalid file count.", 502);
  const names = new Map<string, "file" | "directory">();
  let total = 0;
  const files: CollaborationPublishedFile[] = [];
  for (const value of input) {
    const file = value as CollaborationPublishedFile;
    ensure(file && typeof file.path === "string" && isCollaborationPublicPath(file.path)
      && !/[\x00-\x1f\x7f:]/.test(file.path) && file.path.split("/").every((part) => !/[. ]$/.test(part))
      && typeof file.hash === "string" && /^[a-f0-9]{64}$/.test(file.hash) && Number.isSafeInteger(file.size) && file.size >= 0
      && file.size <= COLLABORATION_CONTENT_LIMITS.fileBytes
      && COLLABORATION_ASSET_TYPES[extname(file.path).toLowerCase()] === file.type,
    "The pinned publication contains a private, invalid or oversized file.", 502);
    const parts = file.path.normalize("NFC").toLowerCase().split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      ensure(names.get(parent) !== "file", "The pinned publication contains conflicting file paths.", 502);
      names.set(parent, "directory");
    }
    const key = parts.join("/");
    ensure(!names.has(key), "The pinned publication contains duplicate or conflicting file paths.", 502);
    names.set(key, "file");
    total += file.size;
    ensure(total <= COLLABORATION_CONTENT_LIMITS.roomBytes, "The pinned publication exceeds the total copy limit.", 502);
    files.push({ path: file.path, hash: file.hash, size: file.size, type: file.type });
  }
  return files;
}

/** Bounded streaming reads also reject transfer bodies larger than their declared manifest size. */
async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  const length = response.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new ImportError("The source response exceeds its authorized size.", 502);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const output = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      ensure(size <= limit, "The source response exceeds its authorized size.", 502);
      output.set(result.value, size - result.value.byteLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ImportError) throw error;
    throw new ImportError("The publication transfer was interrupted. No partial copy was imported; retry with the same request ID.", 502);
  }
  finally { reader.releaseLock(); }
  return output.slice(0, size);
}
async function fetchResponse(url: string, headers: Record<string, string>): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ImportError("The publication source is unavailable. No partial copy was imported; retry with the same request ID.", 502); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImportError(`The publication source refused access (${response.status}). No partial copy was imported.`, [401, 403, 404, 409, 410, 423].includes(response.status) ? response.status : 502);
  }
  return response;
}
async function authorityJson<T>(binding: LocalCollaborationBinding, path: string): Promise<T> {
  const response = await fetchResponse(collaborationAuthorityBase(binding.authority, binding.projectId) + path, { Authorization: `Bearer ${binding.memberToken}` });
  try { return JSON.parse(new TextDecoder().decode(await bytes(response, COLLABORATION_CONTENT_LIMITS.projectionBytes + 512 * 1024))) as T; }
  catch (failure) { if (failure instanceof ImportError) throw failure; throw new ImportError("The collaboration authority returned invalid metadata.", 502); }
}

function receipt(value: unknown, binding: LocalCollaborationBinding, referenceId: string): CollaborationReferenceImportReceipt {
  const item = value as CollaborationReferenceImportReceipt;
  ensure(item?.kind === "local-copy" && item.referenceId === referenceId && typeof item.requestId === "string" && ID.test(item.requestId)
    && item.destinationWorkspaceId === binding.workspace.id && Number.isSafeInteger(item.publicationRevision) && item.publicationRevision > 0
    && item.source?.projectId === binding.projectId && typeof item.source.workspaceId === "string" && ID.test(item.source.workspaceId)
    && typeof item.source.roomId === "string" && ID.test(item.source.roomId)
    && item.source.publicationRevision === item.publicationRevision && isViewerViewState({ address: item.source.address })
    && typeof item.label === "string" && item.label.length <= 200 && Number.isFinite(item.importedAt)
    && item.path === `imports/${referenceId}-r${item.publicationRevision}` && item.attributionPath === `${item.path}/${ATTRIBUTION}`,
  "The existing import receipt belongs to another operation or workspace.", 409);
  const files = manifestFiles(item.files);
  ensure(JSON.stringify(item.paths) === JSON.stringify([...files.map((file) => `${item.path}/${file.path}`), item.attributionPath]), "The existing import receipt contains invalid paths.", 409);
  return item;
}
function sourceRoot(binding: LocalCollaborationBinding, resolved: CollaborationResolvedReference, files: CollaborationPublishedFile[]): URL {
  const source = resolved.reference.source;
  const room = resolved.room;
  ensure(room?.id === source.roomId && room.workspaceId === source.workspaceId && room.revision === source.publicationRevision
    && resolved.publication?.revision === source.publicationRevision && typeof room.page === "string"
    && isCollaborationPublicPath(room.page) && files.some((file) => file.path === room.page), "The resolved publication does not match its pinned reference.", 502);
  let url: URL;
  try { url = new URL(resolved.pageUrl, collaborationAuthorityBase(binding.authority, binding.projectId) + "/"); }
  catch { throw new ImportError("The resolved publication resource URL is invalid.", 502); }
  const prefix = `/projects/${encodeURIComponent(binding.projectId)}/rooms/${encodeURIComponent(room.id)}/revisions/${source.publicationRevision}/`;
  const suffix = encodedPath(room.page);
  ensure(url.origin === binding.authority.origin && !url.username && !url.password && !url.search && !url.hash
    && url.pathname.startsWith(prefix) && url.pathname.endsWith(`/${suffix}`), "The publication URL escapes its authorized source.", 502);
  const grant = url.pathname.slice(prefix.length, -suffix.length - 1);
  ensure(grant.length > 0 && grant.length <= 2048 && !grant.includes("/"), "The publication resource grant is invalid.", 502);
  url.pathname = prefix + grant + "/";
  return url;
}

async function importReference(options: ReferenceImportOptions, referenceId: string, requestId: string): Promise<CollaborationReferenceImportReceipt> {
  ensure(options.projectRoot, "Open a connected Project before importing a reference.");
  const binding = await readLocalCollaborationBinding(options.projectRoot);
  ensure(binding, "Connect this Project to collaboration before importing a reference.");
  const workspace = resolve(options.workspace);
  const operationPath = checkedPath(options.stateDir, `collaboration-imports/${requestId}.json`);
  // The lease is workspace-scoped, so different Session processes cannot race directory commits.
  const leasePath = checkedPath(workspace, ".pneuma/collaboration-import-lease.sqlite");
  let release: () => void;
  try { release = acquireCollaborationLease(leasePath, "Another local import is in progress. Retry with the same request ID."); }
  catch (error) { throw new ImportError(error instanceof Error ? error.message : "The local import is busy.", 409); }
  try {
    const rawOperation = await optionalJson(operationPath) as ImportOperation | null;
    let previous: CollaborationReferenceImportReceipt | null = null;
    if (rawOperation) {
      ensure(rawOperation.version === 1, "The local import operation has an unsupported version.", 409);
      previous = receipt(rawOperation.receipt, binding, referenceId);
      ensure(previous.requestId === requestId, "This request ID already belongs to another import.", 409);
      const completed = await optionalJson(checkedPath(workspace, previous.attributionPath));
      if (completed) {
        const recovered = receipt(completed, binding, referenceId);
        ensure(JSON.stringify({ ...recovered, requestId }) === JSON.stringify(previous), "The copied attribution no longer matches its retry receipt.", 409);
        return previous;
      }
    }
    const state = await authorityJson<CollaborationProjectState>(binding, "/api/state");
    ensure(state?.project?.id === binding.projectId && state.self && canWriteCollaboration(state.self) && state.self.id === binding.workspace.ownerId
      && Array.isArray(state.workspaces) && state.workspaces.some((item) => item.id === binding.workspace.id && item.ownerId === state.self.id), "Only this workspace's current writer or administrator can import a copy.", 403);
    const resolved = await authorityJson<CollaborationResolvedReference>(binding, `/api/references/${encodeURIComponent(referenceId)}/resolve`);
    const reference = resolved.reference;
    ensure(reference?.id === referenceId && reference.ownerId === state.self.id && reference.destinationWorkspaceId === binding.workspace.id
      && reference.source?.projectId === binding.projectId && typeof reference.source.workspaceId === "string" && ID.test(reference.source.workspaceId)
      && typeof reference.source.roomId === "string" && ID.test(reference.source.roomId)
      && Number.isSafeInteger(reference.source.publicationRevision) && reference.source.publicationRevision > 0
      && isViewerViewState({ address: reference.source.address }) && typeof reference.label === "string" && reference.label.length <= 200,
    "This reference does not belong to the current member's destination workspace.", 403);
    if (previous) ensure(previous.publicationRevision === reference.source.publicationRevision, "The reference was refreshed after this import started. Retry with a new request ID.", 409);
    const files = manifestFiles(resolved.publication?.files);
    const root = sourceRoot(binding, resolved, files);
    const path = `imports/${referenceId}-r${reference.source.publicationRevision}`;
    const destination = checkedPath(workspace, path);
    const attributionPath = `${path}/${ATTRIBUTION}`;
    if (await exists(destination)) {
      const existing = await optionalJson(checkedPath(workspace, attributionPath));
      ensure(existing, "The import destination already contains user files. They were not overwritten.", 409);
      const recovered = receipt(existing, binding, referenceId);
      ensure(JSON.stringify(recovered.files) === JSON.stringify(files) && JSON.stringify(recovered.source) === JSON.stringify(reference.source), "The existing directory contains a different import. It was not overwritten.", 409);
      const repeat = { ...recovered, requestId };
      await writePrivateJson(operationPath, { version: 1, receipt: repeat });
      return repeat;
    }
    const imported: CollaborationReferenceImportReceipt = previous ?? { kind: "local-copy", requestId, referenceId,
      destinationWorkspaceId: binding.workspace.id, publicationRevision: reference.source.publicationRevision, label: reference.label,
      source: reference.source, path, attributionPath, paths: [...files.map((file) => `${path}/${file.path}`), attributionPath], files, importedAt: Date.now() };
    ensure(JSON.stringify(imported.files) === JSON.stringify(files) && JSON.stringify(imported.source) === JSON.stringify(reference.source), "The pinned import metadata changed during retry.", 409);
    const imports = checkedPath(workspace, "imports");
    if (await exists(imports)) ensure((await lstat(imports)).isDirectory() && !(await lstat(imports)).isSymbolicLink(), "The imports path must be a local workspace directory.");
    else await mkdir(imports);
    await writePrivateJson(operationPath, { version: 1, receipt: imported });
    const stage = checkedPath(workspace, `imports/.import-${crypto.randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      let total = 0;
      for (const file of files) {
        const url = new URL(encodedPath(file.path), root);
        const response = await fetchResponse(url.href, { "X-Pneuma-Publication-Bytes": "1" });
        const content = await bytes(response, file.size);
        total += content.byteLength;
        ensure(total <= COLLABORATION_CONTENT_LIMITS.roomBytes && content.byteLength === file.size && hash(content) === file.hash,
          `The copied resource failed integrity verification: ${file.path}. No partial copy was imported.`, 502);
        const filePath = checkedPath(stage, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, { flag: "wx" });
      }
      await writeFile(checkedPath(stage, ATTRIBUTION), JSON.stringify(imported, null, 2) + "\n", { flag: "wx" });
      ensure(!await exists(destination), "The import destination now contains user files. They were not overwritten.", 409);
      checkedPath(workspace, path);
      await rename(stage, destination); // Complete bytes + receipt become visible together.
      return imported;
    } finally { await rm(stage, { recursive: true, force: true }); }
  } finally { release(); }
}

/** Private normal-Session route; importing never invokes an Agent or writes another workspace. */
export function mountSessionReferenceImportRoutes(app: Hono, options: ReferenceImportOptions): void {
  app.post("/api/collaboration/references/:id/import", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const referenceId = c.req.param("id");
      ensure(ID.test(referenceId), "Invalid reference ID.");
      const text = await c.req.text();
      ensure(text.length <= 2048, "The import request is too large.", 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { throw new ImportError("Provide a JSON import request."); }
      ensure(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1
        && typeof body.requestId === "string" && ID.test(body.requestId), "Provide only a stable requestId; import destinations are owned by the current Session.");
      return c.json(await importReference(options, referenceId, body.requestId));
    } catch (failure) {
      return c.json({ error: failure instanceof Error ? failure.message : "Local copy failed." }, failure instanceof ImportError ? failure.status as 400 : 500);
    }
  });
}
