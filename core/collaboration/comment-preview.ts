import type { CollaborationCommentPreview } from "../types/collaboration.js";

export const COMMENT_PREVIEW_LIMITS = { label: 200, file: 1024, type: 64, content: 2000, thumbnail: 48 * 1024 } as const;
const TEXT_FIELDS = ["label", "file", "type", "content"] as const;

/** Image URLs only. SVG stays an isolated image; callers must never inject its markup. */
export function isCommentThumbnail(value: unknown): value is string {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > COMMENT_PREVIEW_LIMITS.thumbnail) return false;
  if (/^data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return value.endsWith(",") === false;
  const prefix = "data:image/svg+xml;charset=utf-8,";
  if (!value.startsWith(prefix) || value.length === prefix.length) return false;
  try { decodeURIComponent(value.slice(prefix.length)); return true; } catch { return false; }
}

/** Authorities reject malformed supplied metadata; unknown properties never persist. */
export function validateCommentPreview(value: unknown): CollaborationCommentPreview | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid comment preview");
  const input = value as Record<string, unknown>;
  const preview: CollaborationCommentPreview = {};
  for (const key of TEXT_FIELDS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string" || input[key].length > COMMENT_PREVIEW_LIMITS[key]) throw new Error(`Invalid comment preview ${key}`);
    preview[key] = input[key];
  }
  if (input.thumbnail !== undefined) {
    if (!isCommentThumbnail(input.thumbnail)) throw new Error("Invalid comment preview thumbnail");
    preview.thumbnail = input.thumbnail;
  }
  return preview;
}

/** Selection capture is best effort: bounded text survives a missing/large image. */
export function normalizeCommentPreview(input: Record<string, unknown>): CollaborationCommentPreview | undefined {
  const preview: CollaborationCommentPreview = {};
  for (const key of TEXT_FIELDS) if (typeof input[key] === "string" && input[key]) preview[key] = input[key].slice(0, COMMENT_PREVIEW_LIMITS[key]);
  if (isCommentThumbnail(input.thumbnail)) preview.thumbnail = input.thumbnail;
  return Object.keys(preview).length ? preview : undefined;
}
