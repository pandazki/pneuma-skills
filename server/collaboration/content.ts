import { lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { isContained } from "../utils.js";

export { COLLABORATION_CONTENT_LIMITS as CONTENT_LIMITS, isCollaborationPublicPath as publicPath } from "../../core/types/collaboration-publication.js";
import { COLLABORATION_CONTENT_LIMITS as CONTENT_LIMITS, COLLABORATION_ASSET_TYPES as TYPES, isCollaborationPublicPath as publicPath, type CollaborationPublishedFile } from "../../core/types/collaboration-publication.js";

export function hash(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}


export function contentPath(root: string, path: string): string {
  if (!publicPath(path)) throw new Error("Private or invalid content path");
  const absolute = resolve(root, path);
  if (!isContained(absolute, root)) throw new Error("Content path escapes publication root");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not published");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return absolute;
}

export type PublishedFile = CollaborationPublishedFile;
export interface ContentSnapshot { fingerprint: string; files: PublishedFile[]; blobs: Map<string, Uint8Array> }

/** A revision holds copied bytes, so later disk changes cannot alter its resources. */
export function readContentSnapshot(root: string): ContentSnapshot {
  const files: PublishedFile[] = [];
  const blobs = new Map<string, Uint8Array>();
  let total = 0;
  let directories = 0;
  const visit = (dir: string) => {
    if (++directories > 512) throw new Error("Publication root exceeds directory limit");
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative(root, join(dir, entry.name)).replaceAll("\\", "/");
      if (!publicPath(path) || entry.isSymbolicLink()) continue;
      const absolute = contentPath(root, path);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile() || !TYPES[extname(path).toLowerCase()]) continue;
      const stat = lstatSync(absolute);
      if (stat.size > CONTENT_LIMITS.fileBytes) throw new Error("Published file exceeds 4 MiB limit");
      const bytes = readFileSync(absolute);
      total += bytes.byteLength;
      if (bytes.byteLength > CONTENT_LIMITS.fileBytes || total > CONTENT_LIMITS.roomBytes || files.length >= CONTENT_LIMITS.files) {
        throw new Error("Publication root exceeds bounded snapshot limits");
      }
      const digest = hash(bytes);
      files.push({ path, hash: digest, size: bytes.byteLength, type: TYPES[extname(path).toLowerCase()]! });
      blobs.set(digest, bytes);
    }
  };
  visit(root);
  return { fingerprint: hash(JSON.stringify(files)), files, blobs };
}

export function writePage(root: string, page: string, html: string): void {
  const destination = contentPath(root, page);
  const temp = join(dirname(destination), `.collaboration-${crypto.randomUUID()}.tmp`);
  if (!isContained(temp, root)) throw new Error("Temporary path escapes publication root");
  try {
    writeFileSync(temp, html, { encoding: "utf8", flag: "wx" });
    // Recheck after the temporary write. Local filesystem races are outside this spike's authority.
    contentPath(root, page);
    renameSync(temp, destination);
  } finally {
    try { unlinkSync(temp); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
