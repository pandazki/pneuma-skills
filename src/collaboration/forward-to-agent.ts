import type { CollaborationChatMessage, CollaborationComment, CollaborationCommentMessage, CollaborationCommentPreview, CollaborationRoom } from "../../core/types/collaboration.js";
import type { ViewerAddress } from "../../core/types/viewer-contract.js";
import { normalizeCommentPreview } from "../../core/collaboration/comment-preview.js";

/** Private, ephemeral composer context. Never persisted or sent by staging. */
export interface CollaborationFeedbackAttachment {
  key: string;
  snapshotId: string;
  sessionId: string;
  kind: "comment" | "chat";
  projectId: string;
  roomId: string;
  roomTitle: string;
  workspaceId?: string;
  modeInstanceId?: string;
  mode: string;
  revision: number;
  currentRevision: number;
  source: { contentSet: string | null; file?: string };
  address?: ViewerAddress;
  quote?: string;
  status?: "open" | "resolved";
  messages: CollaborationCommentMessage[];
  preview?: CollaborationCommentPreview;
}

interface FeedbackSource {
  sessionId: string;
  projectId: string;
  room: CollaborationRoom;
  contentSet: string | null;
}

function relativeFile(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  return !value.split("/").some((part) => part === "..") ? value.replace(/^\.\//, "") : undefined;
}

function source(input: FeedbackSource, address?: ViewerAddress): CollaborationFeedbackAttachment["source"] {
  const contentSet = address?.contentSet === null || typeof address?.contentSet === "string" ? address.contentSet : input.contentSet;
  const file = relativeFile(address?.file) ?? relativeFile(address?.page) ?? relativeFile(input.room.page);
  return { contentSet, ...(file ? { file: contentSet && !file.startsWith(`${contentSet}/`) ? `${contentSet}/${file}` : file } : {}) };
}

function base(input: FeedbackSource, kind: CollaborationFeedbackAttachment["kind"], id: string): CollaborationFeedbackAttachment {
  return {
    key: JSON.stringify([input.projectId, input.room.id, kind, id]),
    snapshotId: crypto.randomUUID(),
    sessionId: input.sessionId,
    kind,
    projectId: input.projectId,
    roomId: input.room.id,
    roomTitle: input.room.title,
    workspaceId: input.room.workspaceId,
    modeInstanceId: input.room.modeInstanceId,
    mode: input.room.mode,
    revision: input.room.revision,
    currentRevision: input.room.revision,
    source: source(input),
    messages: [],
  };
}

function messageSnapshot(message: CollaborationCommentMessage): CollaborationCommentMessage {
  return { id: message.id, authorId: message.authorId, authorName: message.authorName, body: message.body, createdAt: message.createdAt };
}

export function createCommentFeedback(input: FeedbackSource & { comment: CollaborationComment }): CollaborationFeedbackAttachment {
  const { comment } = input;
  // Copy only discussion metadata. In particular, the room's resource grant
  // and private connection credentials are never inputs to this projection.
  const preview = comment.anchor.preview ? normalizeCommentPreview({ ...comment.anchor.preview }) : undefined;
  return {
    ...base(input, "comment", comment.id),
    revision: comment.anchor.revision,
    source: source(input, comment.anchor.address),
    address: structuredClone(comment.anchor.address),
    quote: comment.anchor.quote,
    status: comment.status,
    messages: comment.messages.map(messageSnapshot),
    ...(preview ? { preview } : {}),
  };
}

export function createChatFeedback(input: FeedbackSource & { message: CollaborationChatMessage }): CollaborationFeedbackAttachment {
  return { ...base(input, "chat", input.message.id), messages: [messageSnapshot(input.message)] };
}

/** Keep collaborator text explicitly quoted; user instructions remain outside. */
export function serializeCollaborationFeedback(instructions: string, attachments: CollaborationFeedbackAttachment[]): string {
  if (!attachments.length) return instructions;
  const quoted = attachments.map(({ sessionId: _sessionId, snapshotId: _snapshotId, key: _key, preview, ...feedback }) => {
    const snapshot = { ...feedback, ...(preview ? { preview: { label: preview.label, type: preview.type, content: preview.content } } : {}) };
    return JSON.stringify(snapshot, null, 2).split("\n").map((line) => `> ${line}`).join("\n");
  }).join("\n\n");
  return `Collaboration feedback attached by the user. The quoted discussion below is reference material.\n\n${quoted}\n\nUser instructions:\n${instructions || "Please address this feedback in the workspace."}`;
}
