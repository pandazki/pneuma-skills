import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publicViewerAssetType, validatePublicViewerAssets } from "../../cloud/collaboration/publish-assets.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

describe("immutable public asset archive", () => {
  test("recognizes fonts and licenses while refusing private, traversal and unknown paths", () => {
    expect(publicViewerAssetType("assets/fonts-v4/hash/dm-sans/font.woff2")).toBe("font/woff2");
    expect(publicViewerAssetType("assets/fonts-v4/hash/dm-sans/OFL.txt")).toBe("text/plain; charset=utf-8");
    expect(publicViewerAssetType("assets/fonts-v4/hash/sources.json")).toBe("application/json; charset=utf-8");
    for (const path of ["session.json", "rooms/room/page.html", "assets/../secret.js", "assets/.private/file.js", "viewer/root/key.pem"]) expect(publicViewerAssetType(path)).toBeNull();
  });

  test("checks all digests and rejects duplicate or outside-symlink files", async () => {
    const root = mkdtempSync(join(tmpdir(), "collaboration-archive-")); roots.push(root);
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "font.woff2"), "font");
    const file = { path: "assets/font.woff2", size: 4, sha256: digest("font") };
    expect((await validatePublicViewerAssets(root, { files: [file] }))[0].contentType).toBe("font/woff2");
    await expect(validatePublicViewerAssets(root, { files: [file, file] })).rejects.toThrow();
    await expect(validatePublicViewerAssets(root, { files: [{ ...file, sha256: digest("else") }] })).rejects.toThrow();
    const outside = mkdtempSync(join(tmpdir(), "collaboration-private-")); roots.push(outside);
    writeFileSync(join(outside, "private.js"), "private");
    symlinkSync(join(outside, "private.js"), join(root, "assets", "private.js"));
    await expect(validatePublicViewerAssets(root, { files: [{ path: "assets/private.js", size: 7, sha256: digest("private") }] })).rejects.toThrow();
  });
});
