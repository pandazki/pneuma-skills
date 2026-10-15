import type { CollaborationAnchor } from "../../core/types/collaboration.js";
import type { ViewerSelectionContext } from "../../core/types/viewer-contract.js";
import { normalizeCommentPreview } from "../../core/collaboration/comment-preview.js";

/** Preserve the viewer's reference and capture its existing display context once. */
export function createCommentAnchor(selection: ViewerSelectionContext, revision: number): CollaborationAnchor | null {
  if (!selection.address) return null;
  const preview = normalizeCommentPreview({ label: selection.label, file: selection.file, type: selection.type, content: selection.content, thumbnail: selection.thumbnail });
  const quote = (selection.label || selection.content || "").slice(0, 1000);
  return { address: selection.address, revision, x: 0, y: 0, ...(quote ? { quote } : {}), ...(preview ? { preview } : {}) };
}
