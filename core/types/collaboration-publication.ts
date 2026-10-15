import type { ViewerAddress, ViewerFileContent } from "./viewer-contract.js";
import type { CollaborationJsonValue } from "./viewer-collaboration.js";

/** Bounded public resources, independent of the authority's storage placement. */
export const COLLABORATION_CONTENT_LIMITS = { files: 256, fileBytes: 4 * 1024 * 1024, roomBytes: 16 * 1024 * 1024, projectionBytes: 4 * 1024 * 1024, revisions: 8 };
const PRIVATE_NAMES = new Set([
  "node_modules", "shadow.git", "captures", "evolution", "onboard",
  "agents.md", "claude.md", "history.json", "session.json", "config.json",
  "api-keys.json", "r2.json", "cloudflare-pages.json", "checkpoints.jsonl",
  "inbound-handoff.json", "borrow-result.json", "viewer-state.json",
  "collaboration-room.json", "collaboration-registration.json", "collaboration-references.json", "collaboration-imports",
  "package.json", "package-lock.json", "bun.lock", "bun.lockb",
]);
export const COLLABORATION_ASSET_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
};


export function isCollaborationPublicPath(path: string): boolean {
  return path.length > 0 && path.length <= 500 && !path.includes("\\") && !path.includes("\0")
    && !path.startsWith("/") && path.split("/").every((part) =>
      part.length > 0 && !part.startsWith(".") && !PRIVATE_NAMES.has(part.toLowerCase()));
}


export interface CollaborationPublishedFile { path: string; hash: string; size: number; type: string }

/** Complete public Source projection committed with an immutable file manifest. */
export interface CollaborationPublicationProjection {
  schema: string;
  sources: Record<string, CollaborationJsonValue>;
  initParams?: Record<string, string | number>;
  entryAddress: ViewerAddress;
}

export interface CollaborationViewerCompatibility {
  coreVersion: string;
  modeVersion: string;
  /** SHA-256 of the built mode viewer artifact, not a filesystem location. */
  viewerHash: string;
  publicationSchema: string;
}

export interface ModePublicationInput {
  /** Trusted local input. Only the adapter's explicit projection can leave. */
  files: readonly ViewerFileContent[];
  contentSet: string | null;
  activeFile: string | null;
  initParams: Readonly<Record<string, string | number>>;
}

export interface ModePublicationOutput {
  projection: CollaborationPublicationProjection;
  /** Explicit workspace-relative allowlist. The runtime reads and hashes bytes. */
  resources: string[];
  /** Local metadata needed to derive Sources, captured but never served as a resource. */
  projectionInputs?: string[];
  /** Public entry resource; navigation still uses entryAddress. */
  page: string;
}

/** Mode-owned semantic projection, loaded by the runtime without React. */
export interface ModePublicationAdapter {
  schema: string;
  project(input: ModePublicationInput): ModePublicationOutput | Promise<ModePublicationOutput>;
  /** Optional page instrumentation. Must contain no credentials or private input. */
  frameScript?: string;
}

export const COLLABORATION_RESOURCE_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'";
