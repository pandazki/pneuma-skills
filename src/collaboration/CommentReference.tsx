import { useState } from "react";
import type { CollaborationAnchor } from "../../core/types/collaboration.js";
import { isCommentThumbnail } from "../../core/collaboration/comment-preview.js";
import "./comment-reference.css";

/** One readable reference for drafts and saved comments, including older anchors. */
export function CommentReference({ anchor, onLocate }: { anchor: CollaborationAnchor; onLocate: (anchor: CollaborationAnchor) => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const preview = anchor.preview;
  const file = preview?.file || (typeof anchor.address.page === "string" ? anchor.address.page : typeof anchor.address.file === "string" ? anchor.address.file : "");
  const label = preview?.label || anchor.quote || preview?.type || (typeof anchor.address.selector === "string" ? anchor.address.selector : "Page location");
  const excerpt = preview?.content?.trim();
  const thumbnail = isCommentThumbnail(preview?.thumbnail) && failedImage !== preview.thumbnail ? preview.thumbnail : null;
  return <button type="button" className="thread-anchor comment-reference" onClick={() => onLocate(anchor)} title="Locate this comment in the page">
    {thumbnail && <img className="comment-reference-image" src={thumbnail} alt="" onError={() => setFailedImage(thumbnail)}/>}
    <span className="comment-reference-details"><span className="comment-reference-heading"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round"/></svg><span className="comment-reference-label">{label}</span><svg className="comment-reference-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></span>{file && <span className="comment-reference-file">{file}</span>}{excerpt && excerpt !== label && <span className="comment-reference-excerpt">{excerpt}</span>}</span>
  </button>;
}
