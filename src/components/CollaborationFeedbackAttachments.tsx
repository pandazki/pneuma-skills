import type { CollaborationFeedbackAttachment } from "../collaboration/forward-to-agent.js";
import { useState } from "react";
import { isCommentThumbnail } from "../../core/collaboration/comment-preview.js";

export default function CollaborationFeedbackAttachments({ attachments, onRemove }: {
  attachments: CollaborationFeedbackAttachment[];
  onRemove: (key: string) => void;
}) {
  if (!attachments.length) return null;
  return <div className="mb-2 space-y-2" aria-label="Attached collaboration feedback">
    {attachments.map((attachment) => <FeedbackCard key={attachment.key} attachment={attachment} onRemove={onRemove}/>)}
  </div>;
}

function FeedbackCard({ attachment, onRemove }: { attachment: CollaborationFeedbackAttachment; onRemove: (key: string) => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const thumbnail = isCommentThumbnail(attachment.preview?.thumbnail) && failedImage !== attachment.preview.thumbnail ? attachment.preview.thumbnail : null;
  return <article className="flex gap-2 rounded-lg border border-cc-border bg-cc-card/50 px-3 py-2">
      {thumbnail && <img src={thumbnail} alt="" onError={() => setFailedImage(thumbnail)} className="h-14 w-20 shrink-0 rounded border border-cc-border/40 object-contain bg-cc-bg"/>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-cc-muted"><span className="font-medium text-cc-primary">{attachment.kind === "comment" ? "Comment" : "Chat"}</span><span className="truncate">{attachment.roomTitle}</span><span className="shrink-0">{attachment.messages.length > 1 ? `${attachment.messages.length} messages` : attachment.messages[0]?.authorName}</span></div>
        {(attachment.preview?.label || attachment.quote) && <p className="mt-0.5 truncate text-xs font-medium text-cc-fg">{attachment.preview?.label || attachment.quote}</p>}
        <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-cc-fg">{attachment.messages[0]?.body}</p>
        <p className="mt-1 truncate text-[10px] text-cc-muted">{attachment.source.file || attachment.mode} · revision {attachment.revision}{attachment.currentRevision !== attachment.revision ? ` · current ${attachment.currentRevision}` : ""}{attachment.messages.length > 1 ? ` · ${attachment.messages[0]?.authorName}` : ""}</p>
      </div>
      <button type="button" onClick={() => onRemove(attachment.key)} aria-label="Remove collaboration feedback" className="h-6 w-6 shrink-0 rounded text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/40"><svg viewBox="0 0 16 16" width="12" height="12" className="mx-auto" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
    </article>;
}
