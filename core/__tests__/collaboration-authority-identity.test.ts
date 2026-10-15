import { describe, expect, test } from "bun:test";
import { collaborationIdentityChallenge, collaborationReferenceOperationAuthority } from "../types/collaboration-workspace.js";

describe("collaboration authority identity challenge", () => {
  test("pins placement, Project, ingress origin, and caller nonce in one signed value", () => {
    const original = collaborationIdentityChallenge("project-a", "https://entry.example", "nonce-a");
    expect(original).toBe('{"version":1,"kind":"lan","projectId":"project-a","origin":"https://entry.example","nonce":"nonce-a"}');
    expect(collaborationIdentityChallenge("project-b", "https://entry.example", "nonce-a")).not.toBe(original);
    expect(collaborationIdentityChallenge("project-a", "https://phishing.example", "nonce-a")).not.toBe(original);
    expect(collaborationIdentityChallenge("project-a", "https://entry.example", "nonce-b")).not.toBe(original);
  });
});

test("private operation authority follows a pinned key across LAN entries and isolates placement", async () => {
  const first = { kind: "lan", origin: "https://first.example", publicKey: btoa("first-pinned-key") } as const;
  const scope = await collaborationReferenceOperationAuthority(first);
  expect(scope).toMatch(/^lan-key:[a-f0-9]{64}$/);
  expect(await collaborationReferenceOperationAuthority({ ...first, origin: "https://new.example" })).toBe(scope);
  expect(await collaborationReferenceOperationAuthority({ ...first, publicKey: btoa("other-key") })).not.toBe(scope);
  expect(await collaborationReferenceOperationAuthority({ kind: "lan", origin: first.origin })).toBe("lan-origin:https://first.example");
  expect(await collaborationReferenceOperationAuthority({ kind: "cloud", origin: "https://FIRST.example:443/" })).toBe("cloud-origin:https://first.example");
  expect(await collaborationReferenceOperationAuthority({ kind: "cloud", origin: "https://new.example" })).not.toBe(scope);
});
