import type { CollaborationReference } from "../types/collaboration-reference.js";
import { describe, expect, test } from "bun:test";
import { removeProject, replayProjectRemoval, requireActiveProject, type ProjectData, collaborationLeaseDeadline, collaborationLeaseIsLive, publicRoomRecord, validateReferenceSource, requireReferenceQuota, retainedCollaborationRevisions, validateFiles, validateProjection, validateRegistration } from "../collaboration/authority-domain.js";

const registration = { workspaceId: "workspace", modeInstanceId: "instance", mode: "webcraft", title: "Public work", page: "content-set/index.html",
  compatibility: { coreVersion: "4.0.0", modeVersion: "1.0.0", viewerHash: "a".repeat(64), publicationSchema: "public-v1" } };

describe("portable collaboration authority domain", () => {
  test("registration binds the authenticated owner and rejects malformed stable identity and compatibility", () => {
    const room = validateRegistration({ ...registration, ownerId: "forged-owner", placement: "cloud" }, "authenticated-member");
    expect(room.ownerId).toBe("authenticated-member"); expect(room.workspaceId).toBe("workspace"); expect(room.modeInstanceId).toBe("instance");
    expect(() => validateRegistration({ ...registration, workspaceId: "/private/workspace" }, "member")).toThrow();
    expect(() => validateRegistration({ ...registration, compatibility: { ...registration.compatibility, viewerHash: "/private/viewer.js" } }, "member")).toThrow();
    expect(() => validateRegistration({ ...registration, page: ".pneuma/history.json" }, "member")).toThrow();
    expect(() => validateRegistration({ ...registration, enabled: "true" }, "member")).toThrow();
    const publicRoom = publicRoomRecord({ ...room, publisherHash: "private-credential-hash", frameScript: "private-instrumentation" }, true);
    expect(JSON.stringify(publicRoom)).not.toContain("private-"); expect(publicRoom.compatibility).toEqual(registration.compatibility);
  });
  test("Source projection must match registered schema and remain bounded plain JSON", () => {
    const room = validateRegistration(registration, "member");
    const projection = { schema: "public-v1", sources: { files: [{ path: room.page, content: "Public HTML" }] }, entryAddress: { file: room.page } };
    expect(validateProjection(projection, room)).toEqual(projection);
    expect(() => validateProjection(undefined, room)).toThrow();
    expect(() => validateProjection({ ...projection, schema: "wrong-schema" }, room)).toThrow();
    expect(() => validateProjection({ ...projection, sources: { bad: NaN } }, room)).toThrow();
    expect(() => validateProjection({ ...projection, sources: JSON.parse('{"constructor":"forged"}') }, room)).toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => validateProjection({ ...projection, sources: cycle }, room)).toThrow();
  });
  test("room resource validation excludes private files, duplicate paths and MIME spoofing", () => {
    const file = { path: "index.html", hash: "a".repeat(64), size: 12, type: "text/html; charset=utf-8" };
    expect(validateFiles([file], file.path)).toEqual([file]);
    expect(() => validateFiles([file, file], file.path)).toThrow();
    expect(() => validateFiles([{ ...file, path: "AGENTS.md" }], "AGENTS.md")).toThrow();
    expect(() => validateFiles([{ ...file, type: "application/javascript" }], file.path)).toThrow();
  });
  test("identical LAN/cloud lease policy expires at receipt-time deadlines", () => {
    expect(collaborationLeaseDeadline(100, "owner")).toBe(15100);
    expect(collaborationLeaseDeadline(100, "publisher")).toBe(45100);
    expect(collaborationLeaseIsLive(100, "owner", 15099)).toBe(true);
    expect(collaborationLeaseIsLive(100, "owner", 15100)).toBe(false);
    expect(collaborationLeaseIsLive(NaN, "owner", 15100)).toBe(false);
  });
  test("reference addresses remain bounded and a foreign Project cannot become a source", () => {
    const source = { projectId: "project", workspaceId: "workspace", roomId: "room", publicationRevision: 2, address: { file: "index.html", selector: "h1" } };
    expect(validateReferenceSource(source, "project")).toEqual(source);
    expect(() => validateReferenceSource(source, "another-project")).toThrow();
    expect(() => validateReferenceSource({ ...source, publicationRevision: NaN }, "project")).toThrow();
    expect(() => validateReferenceSource({ ...source, address: { quote: "x".repeat(4096) } }, "project")).toThrow();
    expect(() => validateReferenceSource({ ...source, address: JSON.parse('{"__proto__":{"id":"forged"}}') }, "project")).toThrow();
  });
  test("removal persists a single administrator receipt while retaining source metadata", () => {
    const room = { ...validateRegistration(registration, "owner"), publisherHash: "private" };
    const state: ProjectData = { project: { id: "project", name: "Project" }, bootstrapHash: "hash", grantKey: "secret", frameScript: "", rooms: [room], workspaces: [], references: [], members: [], invitations: [], guests: [], comments: [], messages: [] };
    const actor = { id: "owner", name: "Owner", role: "admin" as const, kind: "member" as const };
    const body = { opId: "remove-project" };
    expect(() => removeProject(state, { ...actor, role: "writer" }, body)).toThrow("Administrator");
    const receipt = removeProject(state, actor, body);
    const restored = JSON.parse(JSON.stringify(state)) as ProjectData;
    expect(replayProjectRemoval(restored, actor, body)).toEqual(receipt);
    expect(() => replayProjectRemoval(restored, { ...actor, id: "other-admin" }, body)).toThrow("Project was removed");
    expect(() => replayProjectRemoval(restored, actor, { opId: "another-operation" })).toThrow("Project was removed");
    expect(() => requireActiveProject(restored)).toThrow("Project was removed");
    expect(restored.rooms[0]?.enabled).toBe(false); expect(restored.rooms[0]?.grantEpoch).toBe(1); expect(restored.rooms).toHaveLength(1);
    expect(restored.grantKey).toBe("secret");
  });
  test("retention reserves distinct revisions and one rolling head without expanding the room budget", () => {
    const reference = (revision: number, id = String(revision)): CollaborationReference => ({ id, ownerId: "owner", destinationWorkspaceId: "destination", label: "Pin",
      source: { projectId: "project", workspaceId: "workspace", roomId: "room", publicationRevision: revision, address: { file: "index.html" } }, compatibility: registration.compatibility, createdAt: 1, updatedAt: 1 });
    const pins = Array.from({ length: 7 }, (_, index) => reference(index + 1));
    expect(() => requireReferenceQuota([...pins, reference(1, "duplicate")], reference(1).source)).not.toThrow();
    expect(() => requireReferenceQuota(pins, reference(12).source)).toThrow();
    expect(() => requireReferenceQuota(pins, reference(12).source, "1")).not.toThrow();
    expect(() => requireReferenceQuota([...pins, reference(1, "duplicate")], reference(12).source, "1")).toThrow();
    const retained = retainedCollaborationRevisions(Array.from({ length: 12 }, (_, index) => index + 1), pins, "room");
    expect([...retained].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 12]);
    expect(retained.size).toBe(8);
    const released = retainedCollaborationRevisions([1, 2, 3, 4, 5, 6, 7, 12, 13], [...pins.slice(1), reference(12)], "room");
    expect(released.has(1)).toBe(false); expect(released.has(12)).toBe(true); expect(released.has(13)).toBe(true);
  });

});
