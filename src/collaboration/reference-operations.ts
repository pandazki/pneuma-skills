import type { SessionCollaborationStatus } from "../../core/types/collaboration-session.js";
import type { CollaborationReferenceSource } from "../../core/types/collaboration-reference.js";

export interface PendingReferenceOperation {
  opId: string;
  source?: CollaborationReferenceSource;
  destinationWorkspaceId?: string;
  label?: string;
}
type OperationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Scope recovery to this authority, Project, private placement and deliberate action. */
export function referenceOperationKey(scope: { authorityBaseUrl: string; authorityScope?: string; projectId: string; workspaceId: string; targetId: string; action: string; revision?: number }): string {
  return `pneuma-reference-operation:${[scope.authorityScope ?? scope.authorityBaseUrl, scope.projectId, scope.workspaceId, scope.targetId, scope.action, scope.revision ?? ""].map((part) => encodeURIComponent(String(part))).join(":")}`;
}
export function hasReferenceOperation(key: string): boolean {
  try { return window.sessionStorage.getItem(key) !== null; } catch { return false; }
}
export function readReferenceOperation(key: string, storage: OperationStorage = window.sessionStorage): PendingReferenceOperation | null {
  try {
    const text = storage.getItem(key);
    if (text === null) return null;
    const value = JSON.parse(text) as PendingReferenceOperation;
    if (!value || typeof value.opId !== "string" || !value.opId || Object.keys(value).some((key) => !["opId", "source", "destinationWorkspaceId", "label"].includes(key))) throw new Error("Invalid operation");
    return value;
  } catch { throw new Error("This tab's reference recovery record cannot be read. Restore browser tab storage before retrying."); }
}
export function saveReferenceOperation(key: string, value: PendingReferenceOperation, storage: OperationStorage = window.sessionStorage): void {
  try { storage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error("This tab cannot retain the reference request for safe retry. Restore browser tab storage before continuing."); }
}
export function clearReferenceOperation(key: string, storage: OperationStorage = window.sessionStorage): void {
  try { storage.removeItem(key); }
  catch { throw new Error("The request succeeded, but this tab's recovery record could not be cleared. Restore browser tab storage before another request."); }
}

type PrivateConnection = NonNullable<SessionCollaborationStatus["connection"]>;
type MigrationStorage = OperationStorage & Pick<Storage, "length" | "key">;

/** Move only the currently trusted private binding's records before enabling reference actions. */
export function migrateReferenceOperations(previous: PrivateConnection | undefined, next: PrivateConnection | undefined, storage: MigrationStorage = window.sessionStorage): void {
  if (!next?.referenceOperationAuthority) return;
  const canonical = next.referenceOperationAuthority;
  const sources = new Set([next.authorityBaseUrl]);
  if (previous?.referenceOperationAuthority && previous.projectId === next.projectId
    && previous.workspaceId === next.workspaceId && previous.ownerId === next.ownerId
    && previous.authorityKind === "lan" && next.authorityKind === "lan"
    && (previous.referenceOperationAuthority === canonical
      || previous.referenceOperationAuthority.startsWith("lan-origin:") && canonical.startsWith("lan-key:"))) {
    sources.add(previous.referenceOperationAuthority);
    sources.add(previous.authorityBaseUrl);
  }
  sources.delete(canonical);
  const prefix = (authority: string) => `pneuma-reference-operation:${[authority, next.projectId, next.workspaceId].map(encodeURIComponent).join(":")}:`;
  try {
    const moves: { from: string; to: string; value: string }[] = [];
    const destinations = new Map<string, string>();
    for (let index = 0; index < storage.length; index++) {
      const from = storage.key(index);
      if (!from) continue;
      for (const source of sources) {
        const oldPrefix = prefix(source);
        if (!from.startsWith(oldPrefix)) continue;
        readReferenceOperation(from, storage); // Validate every record before moving any.
        const value = storage.getItem(from)!;
        const to = prefix(canonical) + from.slice(oldPrefix.length);
        const existing = storage.getItem(to);
        if (existing !== null && existing !== value || destinations.has(to) && destinations.get(to) !== value) throw new Error("Conflicting pending reference requests");
        destinations.set(to, value);
        moves.push({ from, to, value });
      }
    }
    // Destination writes finish before deleting any recovery record. Partial writes are safe to retry.
    for (const move of moves) storage.setItem(move.to, move.value);
    for (const move of moves) storage.removeItem(move.from);
  } catch {
    throw new Error("This tab's pending reference requests could not be recovered safely. Restore browser tab storage before retrying reference actions.");
  }
}
