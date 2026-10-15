/** Public ingress never changes the Project's authority placement or durable state. */
export type CollaborationTunnelProvider =
  | { kind: "quick" }
  | { kind: "named"; tunnelId: string; credentialsFile: string; publicOrigin: string };

export const COLLABORATION_PUBLIC_IDLE_MS = 10 * 60_000;
export type CollaborationInternetAccessPhase = "off" | "starting" | "active" | "stopping" | "idleexpired" | "failed";

/** Private administration state; credential file paths never enter public Project state. */
export interface CollaborationInternetAccessState {
  status: CollaborationInternetAccessPhase;
  provider: CollaborationTunnelProvider;
  publicOrigin: string | null;
  publicClients: number;
  idleDeadline: number | null;
  idleTimeoutMs: number;
  error?: string;
}
export interface CollaborationInternetAccessChange {
  enabled: boolean;
  provider?: CollaborationTunnelProvider;
}

export function parseCollaborationTunnelProvider(value: unknown): CollaborationTunnelProvider {
  if (!value || typeof value !== "object") throw new Error("Choose a public access provider.");
  const input = value as Record<string, unknown>;
  if (input.kind === "quick") return { kind: "quick" };
  if (input.kind !== "named" || typeof input.tunnelId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.tunnelId)
    || typeof input.credentialsFile !== "string" || !input.credentialsFile.trim() || input.credentialsFile.length > 4096
    || typeof input.publicOrigin !== "string") throw new Error("Provide an existing named Tunnel ID, credentials file, and HTTPS origin.");
  const url = new URL(input.publicOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Named Tunnel public origin must be an HTTPS origin.");
  return { kind: "named", tunnelId: input.tunnelId, credentialsFile: input.credentialsFile, publicOrigin: url.origin };
}
