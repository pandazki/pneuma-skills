import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";
import { expect, test } from "bun:test";
import { referenceOperationKey, readReferenceOperation, saveReferenceOperation, clearReferenceOperation, migrateReferenceOperations } from "../reference-operations.js";

function tabStorage() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const scope = { authorityBaseUrl: "https://authority.example/projects/project-a", projectId: "project-a", workspaceId: "mine", targetId: "pin-a", action: "selected-location", revision: 3 };
test("selected-location recovery preserves the full original body across callers and is scoped to placement/action/revision", () => {
  const storage = tabStorage();
  const key = referenceOperationKey(scope);
  const original = { opId: "original-operation", source: { projectId: "project-a", workspaceId: "peer", roomId: "room-a", publicationRevision: 3, address: { page: "index.html", selector: "#object" } }, label: "Selected object" };
  saveReferenceOperation(key, original, storage);
  expect(readReferenceOperation(key, storage)).toEqual(original);
  for (const changed of [{ workspaceId: "another-placement" }, { projectId: "another-project" }, { authorityBaseUrl: "https://other.example/projects/project-a" }, { targetId: "another-pin" }, { action: "import" }, { revision: 4 }]) expect(readReferenceOperation(referenceOperationKey({ ...scope, ...changed }), storage)).toBeNull();
  expect(readReferenceOperation(key, tabStorage())).toBeNull();
  expect(JSON.stringify(readReferenceOperation(key, storage))).not.toContain("token");
  clearReferenceOperation(key, storage); expect(readReferenceOperation(key, storage)).toBeNull();
});
test("import retries retain a request ID for the pinned revision while a new revision has a separate request", () => {
  const storage = tabStorage(); const key = referenceOperationKey({ ...scope, action: "import" });
  saveReferenceOperation(key, { opId: "original-import-request" }, storage);
  expect(readReferenceOperation(key, storage)?.opId).toBe("original-import-request");
  expect(readReferenceOperation(referenceOperationKey({ ...scope, action: "import", revision: 4 }), storage)).toBeNull();
});
test("unreadable or unavailable tab storage fails before a caller can submit an unrecoverable request", () => {
  const storage = tabStorage(); storage.setItem("broken", "not json");
  expect(() => readReferenceOperation("broken", storage)).toThrow("cannot be read");
  expect(() => saveReferenceOperation("key", { opId: "request" }, { ...storage, setItem: () => { throw new Error("quota"); } })).toThrow("safe retry");
});

const connection = (authorityBaseUrl: string, referenceOperationAuthority: string): NonNullable<SessionCollaborationStatus["connection"]> => ({ authorityBaseUrl, referenceOperationAuthority, projectId: scope.projectId, workspaceId: scope.workspaceId, ownerId: "member", authorityKind: "lan", token: "private-member-token" });
test("all pending actions follow the exact trusted entry into a stable pinned authority scope", () => {
  const storage = tabStorage();
  const first = connection(scope.authorityBaseUrl, "lan-key:first");
  const next = connection("https://new.example/projects/project-a", first.referenceOperationAuthority!);
  const actions = ["pin", "refresh", "remove", "selected-location", "import"];
  for (const action of actions) saveReferenceOperation(referenceOperationKey({ ...scope, action }), { opId: `${action}-original`, label: action }, storage);
  const unrelated = referenceOperationKey({ ...scope, workspaceId: "other" });
  saveReferenceOperation(unrelated, { opId: "unrelated" }, storage);
  migrateReferenceOperations(undefined, first, storage);
  migrateReferenceOperations(first, next, storage);
  for (const action of actions) {
    expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityBaseUrl: next.authorityBaseUrl, authorityScope: next.referenceOperationAuthority, action }), storage)).toEqual({ opId: `${action}-original`, label: action });
    expect(readReferenceOperation(referenceOperationKey({ ...scope, action }), storage)).toBeNull();
  }
  expect(readReferenceOperation(unrelated, storage)?.opId).toBe("unrelated");
});
test("verified legacy-origin to pinned-key transition migrates only the observed previous binding", () => {
  const storage = tabStorage();
  const previous = connection(scope.authorityBaseUrl, "lan-origin:https://authority.example");
  const next = connection("https://new.example/projects/project-a", "lan-key:verified");
  const original = { opId: "legacy-operation" };
  saveReferenceOperation(referenceOperationKey({ ...scope, authorityScope: previous.referenceOperationAuthority }), original, storage);
  migrateReferenceOperations(previous, next, storage);
  expect(readReferenceOperation(referenceOperationKey({ ...scope, authorityScope: next.referenceOperationAuthority }), storage)).toEqual(original);
  expect(storage.length).toBe(1);
});
test("different pinned authorities and different private bindings never migrate each other's operations", () => {
  for (const changed of [{ referenceOperationAuthority: "lan-key:other" }, { projectId: "different" }, { workspaceId: "different" }, { ownerId: "different" }, { authorityKind: "cloud" as const, referenceOperationAuthority: "cloud-origin:https://new.example" }]) {
    const storage = tabStorage();
    const previous = connection(scope.authorityBaseUrl, "lan-key:first");
    const next = { ...connection("https://new.example/projects/project-a", "lan-key:first"), ...changed };
    const key = referenceOperationKey({ ...scope, authorityScope: previous.referenceOperationAuthority });
    saveReferenceOperation(key, { opId: "isolated" }, storage);
    migrateReferenceOperations(previous, next, storage);
    expect(readReferenceOperation(key, storage)?.opId).toBe("isolated");
    expect(storage.length).toBe(1);
  }
});
test("migration conflicts and failed destination writes retain every original record", () => {
  const previous = connection(scope.authorityBaseUrl, "lan-origin:https://authority.example");
  const next = connection("https://new.example/projects/project-a", "lan-key:verified");
  const oldKey = referenceOperationKey(scope);
  const newKey = referenceOperationKey({ ...scope, authorityScope: next.referenceOperationAuthority });
  const storage = tabStorage();
  saveReferenceOperation(oldKey, { opId: "old" }, storage); saveReferenceOperation(newKey, { opId: "new" }, storage);
  expect(() => migrateReferenceOperations(previous, next, storage)).toThrow("recovered safely");
  expect(readReferenceOperation(oldKey, storage)?.opId).toBe("old"); expect(readReferenceOperation(newKey, storage)?.opId).toBe("new");
  storage.removeItem(newKey);
  expect(() => migrateReferenceOperations(previous, next, { ...storage, setItem: () => { throw new Error("quota"); } })).toThrow("recovered safely");
  expect(readReferenceOperation(oldKey, storage)?.opId).toBe("old");
  storage.setItem(oldKey, "invalid JSON");
  expect(() => migrateReferenceOperations(previous, next, storage)).toThrow("recovered safely");
  expect(storage.getItem(oldKey)).toBe("invalid JSON");
});

test("two eligible legacy namespaces cannot overwrite each other's pending operation", () => {
  const storage = tabStorage();
  const previous = connection(scope.authorityBaseUrl, "lan-origin:https://authority.example");
  const next = connection("https://new.example/projects/project-a", "lan-key:verified");
  const urlKey = referenceOperationKey(scope);
  const originKey = referenceOperationKey({ ...scope, authorityScope: previous.referenceOperationAuthority });
  saveReferenceOperation(urlKey, { opId: "url-operation" }, storage);
  saveReferenceOperation(originKey, { opId: "origin-operation" }, storage);
  expect(() => migrateReferenceOperations(previous, next, storage)).toThrow("recovered safely");
  expect(readReferenceOperation(urlKey, storage)?.opId).toBe("url-operation");
  expect(readReferenceOperation(originKey, storage)?.opId).toBe("origin-operation");
  expect(storage.length).toBe(2);
});
