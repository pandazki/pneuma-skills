import { expect, test } from "bun:test";
import { COLLABORATION_PUBLIC_IDLE_MS, parseCollaborationTunnelProvider } from "../types/collaboration-access.js";
import { collaborationIdentityChallenge } from "../types/collaboration-workspace.js";

test("public ingress policy is independent of authority placement and defaults to ten idle minutes", () => {
  expect(COLLABORATION_PUBLIC_IDLE_MS).toBe(600000);
  expect(parseCollaborationTunnelProvider({ kind: "quick", arbitrary: "discard" })).toEqual({ kind: "quick" });
  const provider = { kind: "named" as const, tunnelId: "b28e6772-20c8-4463-8b7f-2adf40908e24", credentialsFile: "/private/tunnel.json", publicOrigin: "https://example.test/" };
  expect(parseCollaborationTunnelProvider(provider)).toEqual({ ...provider, publicOrigin: "https://example.test" });
  for (const publicOrigin of ["http://example.test", "https://example.test/path", "https://example.test/?key=secret", "https://user:secret@example.test"])
    expect(() => parseCollaborationTunnelProvider({ ...provider, publicOrigin })).toThrow();
});
test("authority challenge binds version, placement, project, exact entry origin and nonce", () => {
  expect(collaborationIdentityChallenge("project", "https://example.test", "nonce")).toBe('{"version":1,"kind":"lan","projectId":"project","origin":"https://example.test","nonce":"nonce"}');
  expect(collaborationIdentityChallenge("project", "https://example.test", "nonce")).not.toBe(collaborationIdentityChallenge("project", "https://relay.test", "nonce"));
});
