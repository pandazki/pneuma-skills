/** Identity and ownership are independent of process and filesystem placement. */
export interface CollaborationWorkspace {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  /** Describes execution placement; does not change who owns the workspace. */
  placement: "local" | "cloud";
}

/** Runtime connection configuration, never passed to a mode viewer or publication adapter. */
export interface CollaborationAuthority {
  kind: "lan" | "cloud";
  /** An origin, not a local path. The project ID scopes its authority endpoints. */
  origin: string;
  /** LAN authority key pinned before a credential can move to another entry origin. */
  publicKey?: string;
}

/** Private local binding. Member credentials never enter shared Project state. */
export interface LocalCollaborationBinding {
  version: 1;
  projectId: string;
  workspace: CollaborationWorkspace;
  authority: CollaborationAuthority;
  memberToken: string;
  memberName: string;
}

/** Private running-instance attachment, persisted beside existing Session metadata. */
export interface LocalCollaborationRoom {
  version: 1;
  projectId: string;
  workspaceId: string;
  modeInstanceId: string;
  roomId: string;
  publisherToken: string;
  title: string;
  contentSet: string | null;
  activeFile: string | null;
  enabled: boolean;
}

export function collaborationAuthorityBase(authority: CollaborationAuthority, projectId: string): string {
  return `${authority.origin}/projects/${encodeURIComponent(projectId)}`;
}

/** Unauthenticated placement discovery. LAN signatures prove continuity across entry URLs. */
export interface CollaborationAuthorityIdentity {
  version: 1;
  kind: "lan" | "cloud";
  projectId: string;
  publicKey?: string;
  origin: string;
  nonce?: string;
  signature?: string;
  lanOrigin?: string;
  publicOrigin?: string | null;
}

/** The signature includes placement and Project identity, not just a caller's nonce. */
export function collaborationIdentityChallenge(projectId: string, origin: string, nonce: string): string {
  return JSON.stringify({ version: 1, kind: "lan", projectId, origin, nonce });
}

/** Non-secret private recovery identity; entry URLs may change only for a pinned LAN authority. */
export async function collaborationReferenceOperationAuthority(authority: CollaborationAuthority): Promise<string> {
  if (authority.kind === "lan" && authority.publicKey) {
    const key = Uint8Array.from(atob(authority.publicKey), (byte) => byte.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", key);
    return `lan-key:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `${authority.kind}-origin:${new URL(authority.origin).origin}`;
}
