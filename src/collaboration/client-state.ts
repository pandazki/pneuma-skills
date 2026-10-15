import { canDiscussCollaboration, type CollaborationAnchor, type CollaborationIdentity, type CollaborationRoomState, type CollaborationView } from "../../core/types/collaboration.js";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed" | "error";
export const HOST_OFFLINE_MESSAGE = "The host is offline. Rejoin when the host is online.";

/** Random operation identity also works on plain-HTTP LAN origins. */
export function createOperationId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Credentials are scoped to the authority Project path as well as the tab. */
export function credentialKey(href: string, kind: "token" | "invitation" | "visitor-name"): string {
  const url = new URL(href);
  const scope = url.pathname.match(/^\/projects\/[^/]+/)?.[0];
  return `pneuma-collaboration-${kind}${scope ? `:${url.origin}${scope}` : ""}`;
}

/** Fragment credentials stay in this tab; a guest link cannot replace another tab's identity. */
export function readCredentials(href: string, storage: Pick<Storage, "getItem" | "setItem">): { token: string; inviteToken: string; roomId: string; cleanUrl: string; baseUrl: string } {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const incoming = fragment.get("token");
  const incomingInvite = fragment.get("invite");
  let stored = "";
  let inviteToken = incomingInvite || "";
  try {
    if (incomingInvite) storage.setItem(credentialKey(href, "invitation"), incomingInvite);
    if (incoming) {
      storage.setItem(credentialKey(href, "token"), incoming);
      storage.setItem(credentialKey(href, "invitation"), "");
    }
    stored = storage.getItem(credentialKey(href, "token")) || "";
    inviteToken = incomingInvite || storage.getItem(credentialKey(href, "invitation")) || "";
  } catch { /* The fragment still works when session storage is unavailable. */ }
  fragment.delete("token");
  fragment.delete("invite");
  url.hash = fragment.toString();
  return { token: inviteToken ? "" : incoming || stored, inviteToken, roomId: fragment.get("room") || "", cleanUrl: url.toString(), baseUrl: url.pathname.match(/^\/projects\/[^/]+/) ? `${url.origin}${url.pathname.match(/^\/projects\/[^/]+/)![0]}` : "" };
}

export function shareUrl(token: string, roomId?: string, options: { publicOrigin?: string; invitation?: boolean } = {}): string {
  const url = options.publicOrigin ? new URL(options.publicOrigin) : new URL(location.pathname, location.origin);
  const fragment = new URLSearchParams(options.invitation ? { invite: token } : { token });
  if (roomId) fragment.set("room", roomId);
  url.hash = fragment.toString();
  return url.toString();
}

export function safePageUrl(value: string, origin: string, publicOrigin?: string): string | null {
  try {
    const url = new URL(value, origin);
    const trustedCloudOrigin = publicOrigin ? new URL(publicOrigin).origin : undefined;
    return (url.origin === origin || url.origin === trustedCloudOrigin) && ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e8;
export function validView(value: unknown): value is CollaborationView {
  if (!value || typeof value !== "object") return false;
  const view = value as CollaborationView;
  return typeof view.page === "string" && view.page.length < 2048 && Number.isInteger(view.revision) && view.revision >= 0
    && [view.scrollX, view.scrollY, view.width, view.height, view.documentWidth, view.documentHeight].every(finite)
    && view.width > 0 && view.height > 0 && view.documentWidth > 0 && view.documentHeight > 0;
}

export function validAnchor(value: unknown): value is CollaborationAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as CollaborationAnchor;
  return Number.isInteger(anchor.revision) && anchor.revision >= 0 && finite(anchor.x) && finite(anchor.y)
    && !!anchor.address && typeof anchor.address === "object" && !Array.isArray(anchor.address)
    && JSON.stringify(anchor.address).length < 8192
    && (anchor.quote === undefined || (typeof anchor.quote === "string" && anchor.quote.length <= 2000));
}

/** Follow never applies another page/revision's coordinates to the current document. */
export function canApplyView(view: CollaborationView | null, room: CollaborationRoomState | null): boolean {
  return !!view && !!room && view.page === room.room.page && view.revision === room.room.revision;
}

export function visibleRoomIds(identity: CollaborationIdentity, roomIds: string[]): string[] {
  return identity.kind === "guest" ? roomIds.filter((id) => id === identity.roomId) : roomIds;
}

export function mutationAvailable(identity: CollaborationIdentity | undefined, status: ConnectionStatus): boolean {
  return status === "connected" && identity?.kind === "member" && (identity.role === "writer" || identity.role === "admin");
}

export function discussionAvailable(identity: CollaborationIdentity | undefined, status: ConnectionStatus): boolean {
  return status === "connected" && !!identity && canDiscussCollaboration(identity);
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).map((part) => Array.from(part)[0]).slice(0, 2).join("").toUpperCase() || "?";
}
