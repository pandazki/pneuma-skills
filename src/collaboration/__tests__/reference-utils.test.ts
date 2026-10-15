import { describe, expect, test } from "bun:test";
import type { CollaborationReference } from "../../../core/types/collaboration-reference.js";
import type { CollaborationRoomState } from "../../../core/types/collaboration.js";
import { currentReferenceSource, referenceAgentDraft, referenceLocation, selectedReferenceSource } from "../reference-utils.js";

describe("private reference context", () => {
  test("location text retains a raw filename and optional query, fragment and selected object", () => {
    expect(referenceLocation({ page: "report#2026.html", query: "preview=1", hash: "details", selector: "#headline" })).toBe("report#2026.html?preview=1#details · #headline");
  });
  const room = { room: { id: "room-a", workspaceId: "workspace-a", revision: 3 },
    publication: { revision: 3, files: [], projection: { schema: "test@1", sources: {}, entryAddress: { contentSet: "website", page: "index.html", selector: "#heading" } } } } as unknown as CollaborationRoomState;
  test("pins the complete published entry and rejects a mismatched revision", () => {
    const source = currentReferenceSource("project-a", room);
    expect(source).toEqual({ projectId: "project-a", workspaceId: "workspace-a", roomId: "room-a", publicationRevision: 3, address: room.publication!.projection!.entryAddress });
    expect(source.address).not.toBe(room.publication!.projection!.entryAddress);
    expect(() => currentReferenceSource("project-a", { ...room, publication: { ...room.publication!, revision: 2 } })).toThrow("complete published entry");
  });
  test("only the reference identity enters the editable Agent draft", () => {
    const reference = { id: "reference-a", label: "Landing page", source: currentReferenceSource("project-a", room),
      pageUrl: "https://authority.example/grant/private-secret", token: "member-secret", localPath: "/private/workspace" } as unknown as CollaborationReference;
    const draft = referenceAgentDraft(reference);
    expect(draft).toContain('"referenceId": "reference-a"');
    expect(draft).toContain('"publicationRevision": 3');
    expect(draft).toContain('"selector": "#heading"');
    expect(draft).toContain("Do not substitute a local capture for the pinned revision.");
    for (const forbidden of ["private-secret", "member-secret", "/private/workspace", "pageUrl", "token"]) expect(draft).not.toContain(forbidden);
  });
  test("selecting an object changes its address while retaining the pinned revision and source identity", () => {
    const reference = { source: currentReferenceSource("project-a", room) } as CollaborationReference;
    const source = selectedReferenceSource(reference, { address: { contentSet: "website", page: "index.html", selector: "#new-object" }, revision: 3, x: 0, y: 0 });
    expect(source).toMatchObject({ projectId: "project-a", workspaceId: "workspace-a", roomId: "room-a", publicationRevision: 3, address: { selector: "#new-object" } });
    expect(() => selectedReferenceSource(reference, { address: { selector: "#head" }, revision: 4, x: 0, y: 0 })).toThrow("pinned revision");
    expect(reference.source.address.selector).toBe("#heading");
  });
});
