import { useSyncExternalStore } from "react";
import "./viewer-overlays.css";
import type { CollaborationPresence, CollaborationComment } from "../../core/types/collaboration.js";
import type { ViewerCollaborationRuntime } from "./viewer-runtime.js";

export function ViewerOverlays({ runtime, peers, comments, onComment }: { runtime: ViewerCollaborationRuntime; peers: CollaborationPresence[]; comments: CollaborationComment[]; onComment?: (id: string) => void }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.current, runtime.current);
  return <div className="collaboration-overlays" aria-label="Participant pointers and comments">
    {peers.map((peer) => {
      const point = state.pointers[peer.id];
      if (point?.status !== "visible") return null;
      return <span key={peer.id} className="collaboration-pointer" style={{ left: point.x, top: point.y, color: peer.color }}><svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><path d="M1 1v13l4-4 3 7 3-1-3-7h5Z"/></svg><span>{peer.name}</span></span>;
    })}
    {comments.filter((comment) => comment.status === "open").map((comment, index) => {
      const point = state.anchors[comment.id];
      return point?.status === "visible" ? <button type="button" className="collaboration-pin" key={comment.id} style={{ left: point.x, top: point.y }} onClick={() => onComment?.(comment.id)} aria-label={`Open comment: ${comment.anchor.quote || index + 1}`}>{index + 1}</button> : null;
    })}
    {state.error && <p className="collaboration-view-error" role="status">{state.error}</p>}
  </div>;
}
