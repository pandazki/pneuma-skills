import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectManifest, writeProjectManifest } from "../../../core/project-loader.js";
import { collaborationAuthorityBase, type LocalCollaborationBinding } from "../../../core/types/collaboration-workspace.js";
import { collaborationStateDir, ensurePortableProjectId, parseCollaborationAuthority, readLocalCollaborationBinding, withCollaborationSetupLock, writeLocalCollaborationBinding } from "../local-state.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const path = mkdtempSync(join(tmpdir(), "pneuma-shared-identity-")); roots.push(path); return path; }

describe("portable project identity and private local placement", () => {
  test("existing project slug survives lazy identity assignment and moving the directory", async () => {
    const root = directory();
    await writeProjectManifest(root, { version: 1, name: "local-slug", displayName: "A project", createdAt: 1 });
    const id = await withCollaborationSetupLock(root, () => ensurePortableProjectId(root));
    expect(await ensurePortableProjectId(root)).toBe(id);
    expect((await loadProjectManifest(root))?.name).toBe("local-slug");
    const relocated = directory();
    await writeProjectManifest(relocated, (await loadProjectManifest(root))!);
    expect(await ensurePortableProjectId(relocated)).toBe(id);
    expect(id).not.toContain(root);
  });
  test("connection persists the principal and separate placement without exposing paths", async () => {
    const root = directory();
    await writeProjectManifest(root, { version: 1, name: "local", displayName: "Local", createdAt: 1 });
    const binding: LocalCollaborationBinding = { version: 1, projectId: "shared-project",
      workspace: { id: "workspace-a", projectId: "shared-project", ownerId: "member-a", name: "My work", placement: "local" },
      authority: { kind: "cloud", origin: "https://collaboration.example" }, memberToken: "credential-for-member-a", memberName: "Ada" };
    await withCollaborationSetupLock(root, async () => {
      await ensurePortableProjectId(root, binding.projectId);
      await writeLocalCollaborationBinding(root, binding);
    });
    expect(await readLocalCollaborationBinding(root)).toEqual(binding);
    expect(statSync(join(collaborationStateDir(root), "local.json")).mode & 0o777).toBe(0o600);
    expect(collaborationAuthorityBase(binding.authority, binding.projectId)).toBe("https://collaboration.example/projects/shared-project");
    await expect(ensurePortableProjectId(root, "another-project")).rejects.toThrow("different shared project");
  });
  test("parallel setup is an explicit conflict and malformed origins never become authority URLs", async () => {
    const root = directory();
    await withCollaborationSetupLock(root, async () => {
      await expect(withCollaborationSetupLock(root, async () => 1)).rejects.toThrow("Another Session");
    });
    expect(parseCollaborationAuthority({ kind: "lan", origin: "http://192.168.1.2:17080/" })).toEqual({ kind: "lan", origin: "http://192.168.1.2:17080" });
    for (const origin of ["file:///tmp", "http://remote.example", "https://x.example/private", "https://a:b@x.example", "https://x.example#token=x"]) {
      expect(() => parseCollaborationAuthority({ kind: "cloud", origin })).toThrow();
    }
  });
});
