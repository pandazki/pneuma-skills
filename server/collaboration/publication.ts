import { extname, resolve } from "node:path";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import type { ModeManifest } from "../../core/types/mode-manifest.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import {
  COLLABORATION_CONTENT_LIMITS as LIMITS, COLLABORATION_ASSET_TYPES,
  type CollaborationPublicationProjection, type ModePublicationAdapter,
  type ModePublicationInput, type ModePublicationOutput,
} from "../../core/types/collaboration-publication.js";
import { isCollaborationJson } from "../../core/types/viewer-collaboration.js";
import { canonical } from "../../core/collaboration/authority-domain.js";
import { isContained } from "../utils.js";
import { contentPath, hash, publicPath, type ContentSnapshot } from "./content.js";

export interface ModeContentSnapshot extends ContentSnapshot {
  projection: CollaborationPublicationProjection;
  page: string;
}

/** Mode code is trusted, but the public projection still crosses a checked boundary. */
export async function loadModePublicationAdapter(modeDir: string, manifest: ModeManifest): Promise<ModePublicationAdapter> {
  const declaration = manifest.viewerApi?.collaboration;
  if (!declaration?.viewing) throw new Error("This mode does not declare collaboration viewing.");
  const modulePath = resolve(modeDir, declaration.publication.module);
  if (!isContained(modulePath, modeDir) || modulePath === resolve(modeDir)) throw new Error("Publication module must belong to the mode package.");
  const module = await import(modulePath);
  const adapter = module.default as ModePublicationAdapter;
  if (!adapter || typeof adapter.project !== "function" || adapter.schema !== declaration.publication.schema) {
    throw new Error("Mode publication adapter does not match its declared schema.");
  }
  if (adapter.frameScript !== undefined && (typeof adapter.frameScript !== "string" || adapter.frameScript.length > 256 * 1024)) {
    throw new Error("Mode publication page runtime is invalid.");
  }
  return adapter;
}

function checkProjection(value: ModePublicationOutput, manifest: ModeManifest): void {
  if (!value || !Array.isArray(value.resources) || value.resources.length === 0 || value.resources.length > LIMITS.files
    || new Set(value.resources).size !== value.resources.length || !value.resources.includes(value.page)) {
    throw new Error("Mode publication must enumerate a bounded resource manifest including its entry page.");
  }
  if (value.projectionInputs !== undefined && (!Array.isArray(value.projectionInputs)
    || value.projectionInputs.length > LIMITS.files || value.projectionInputs.some((path) => typeof path !== "string" || !publicPath(path)))) {
    throw new Error("Mode publication metadata inputs must be a bounded local allowlist.");
  }
  const projection = value.projection;
  if (!projection || projection.schema !== manifest.viewerApi?.collaboration?.publication.schema
    || !isCollaborationJson(projection, LIMITS.projectionBytes)
    || !projection.sources || typeof projection.sources !== "object" || Array.isArray(projection.sources)
    || !projection.entryAddress || typeof projection.entryAddress !== "object" || Array.isArray(projection.entryAddress)) {
    throw new Error("Mode publication must provide a valid, bounded public Source projection.");
  }
  for (const key of Object.keys(projection.sources)) {
    if (!Object.hasOwn(manifest.sources ?? {}, key)) throw new Error(`Publication Source is not declared by the mode: ${key}`);
  }
  if (projection.initParams && Object.values(projection.initParams).some((v) => typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))) {
    throw new Error("Public init parameters must be strings or finite numbers.");
  }
}

function textOf(path: string, bytes: Uint8Array): string {
  const mime = COLLABORATION_ASSET_TYPES[extname(path).toLowerCase()] ?? "";
  return /^(text\/|application\/(javascript|json)|image\/svg)/.test(mime)
    ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : "";
}

/** Enumerate the selected content root without traversing private runtime directories. */
export function readPublicationInputFiles(workspace: string, contentSet: string | null): ViewerFileContent[] {
  if (contentSet && !publicPath(contentSet)) throw new Error("Invalid publication content set.");
  const files: ViewerFileContent[] = [];
  let directories = 0;
  let total = 0;
  const visit = (prefix: string) => {
    if (++directories > 512) throw new Error("Publication input exceeds the directory limit.");
    const directory = prefix ? contentPath(workspace, prefix) : workspace;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!publicPath(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !COLLABORATION_ASSET_TYPES[extname(path).toLowerCase()]) continue;
      const absolute = contentPath(workspace, path);
      if (lstatSync(absolute).size > LIMITS.fileBytes) throw new Error("Publication input exceeds the file size limit.");
      const bytes = readFileSync(absolute);
      total += bytes.byteLength;
      if (bytes.byteLength > LIMITS.fileBytes || total > LIMITS.roomBytes || files.length >= LIMITS.files) throw new Error("Publication input exceeds the resource limits.");
      files.push({ path, content: textOf(path, bytes) });
    }
  };
  visit(contentSet ?? "");
  return files;
}

/**
 * Project once to choose resources, then again from their captured immutable bytes.
 * Sources and resources therefore describe the same capture. This does not claim a
 * transaction across independent native writes; modes needing one publish an export.
 */
export async function readModeContentSnapshot(options: {
  workspace: string;
  manifest: ModeManifest;
  adapter: ModePublicationAdapter;
  input: ModePublicationInput;
}): Promise<ModeContentSnapshot> {
  const { workspace, manifest, adapter, input } = options;
  const planned = await adapter.project(input);
  checkProjection(planned, manifest);
  const files: ContentSnapshot["files"] = [];
  const blobs = new Map<string, Uint8Array>();
  const captured: ViewerFileContent[] = [];
  let total = 0;
  const publicResources = new Set(planned.resources);
  const capturedPaths = [...new Set([...planned.resources, ...planned.projectionInputs ?? []])].sort();
  for (const path of capturedPaths) {
    const absolute = contentPath(workspace, path);
    const mime = COLLABORATION_ASSET_TYPES[extname(path).toLowerCase()];
    if (!mime) throw new Error(`Unsupported published resource type: ${path}`);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.size > LIMITS.fileBytes) throw new Error("Published resource is not a bounded regular file.");
    const bytes = readFileSync(absolute);
    total += bytes.byteLength;
    if (bytes.byteLength > LIMITS.fileBytes || total > LIMITS.roomBytes) throw new Error("Publication exceeds the resource size limit.");
    const digest = hash(bytes);
    if (publicResources.has(path)) {
      files.push({ path, hash: digest, size: bytes.byteLength, type: mime });
      blobs.set(digest, bytes);
    }
    captured.push({ path, content: textOf(path, bytes) });
  }
  const projected = await adapter.project({ ...input, files: captured });
  checkProjection(projected, manifest);
  if (projected.page !== planned.page || JSON.stringify([...projected.resources].sort()) !== JSON.stringify(files.map((f) => f.path))
    || JSON.stringify([...projected.projectionInputs ?? []].sort()) !== JSON.stringify([...planned.projectionInputs ?? []].sort())) {
    throw new Error("Publication dependencies changed during capture; retry after the files settle.");
  }
  // Shared wire fingerprint is canonical JSON, regardless of adapter key insertion order.
  return { files, blobs, page: projected.page, projection: projected.projection,
    fingerprint: hash(canonical({ files, projection: projected.projection })) };
}
