import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySeedEntry, resolveSeedCatalog } from "../seed-installer.js";
import type { SeedDescriptor } from "../../core/types/mode-manifest.js";

let seedBase: string;
let workspace: string;

beforeEach(async () => {
  seedBase = await mkdtemp(join(tmpdir(), "pneuma-seedbase-"));
  workspace = await mkdtemp(join(tmpdir(), "pneuma-seeddst-"));
});
afterEach(async () => {
  await rm(seedBase, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("copySeedEntry — single file", () => {
  it("copies a plain file to the workspace destination", async () => {
    await writeFile(join(seedBase, "README.md"), "# Hello\n");
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "README.md",
      dst: "README.md",
      params: {},
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(result!.files).toEqual(["README.md"]);
    expect(readFileSync(join(workspace, "README.md"), "utf-8")).toBe("# Hello\n");
  });

  it("applies template params on text files", async () => {
    await writeFile(join(seedBase, "intro.md"), "Hello {{name}}!");
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "intro.md",
      dst: "intro.md",
      params: { name: "Pandazki" },
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "intro.md"), "utf-8")).toBe("Hello Pandazki!");
  });

  it("does not substitute templates inside binary files", async () => {
    // A .png file with a marker — the substitution-only-for-text-files
    // branch should leave the bytes alone.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x7b, 0x7b, 0x6e, 0x61, 0x6d, 0x65, 0x7d, 0x7d]); // contains "{{name}}"
    await writeFile(join(seedBase, "logo.png"), bytes);
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "logo.png",
      dst: "logo.png",
      params: { name: "X" },
      locale: "en",
    });
    expect(result).not.toBeNull();
    const written = readFileSync(join(workspace, "logo.png"));
    expect(written.equals(bytes)).toBe(true);
  });

  it("flags root-level package.json so the caller can run `bun install`", async () => {
    await writeFile(join(seedBase, "pkg.json"), JSON.stringify({ name: "x" }));
    const r1 = copySeedEntry({
      workspace,
      seedBase,
      src: "pkg.json",
      dst: "package.json",
      params: {},
      locale: "en",
    });
    expect(r1?.seededRootPackageJson).toBe(true);

    const r2 = copySeedEntry({
      workspace,
      seedBase,
      src: "pkg.json",
      dst: "nested/package.json",
      params: {},
      locale: "en",
    });
    // Nested package.json doesn't trigger workspace-root install.
    expect(r2?.seededRootPackageJson).toBe(false);
  });

  it("returns null when the source path doesn't exist on disk", async () => {
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "missing.md",
      dst: "missing.md",
      params: {},
      locale: "en",
    });
    expect(result).toBeNull();
  });
});

describe("copySeedEntry — directory", () => {
  it("recursively copies a directory to the workspace destination", async () => {
    await mkdir(join(seedBase, "deck"), { recursive: true });
    await mkdir(join(seedBase, "deck/slides"), { recursive: true });
    await writeFile(join(seedBase, "deck/manifest.json"), "{}");
    await writeFile(join(seedBase, "deck/slides/01.html"), "<p>1</p>");
    await writeFile(join(seedBase, "deck/slides/02.html"), "<p>2</p>");
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "deck/",
      dst: "en-dark/",
      params: {},
      locale: "en",
    });
    expect(result).not.toBeNull();
    expect(result!.files.sort()).toEqual([
      "en-dark/manifest.json",
      "en-dark/slides/01.html",
      "en-dark/slides/02.html",
    ]);
    expect(existsSync(join(workspace, "en-dark/manifest.json"))).toBe(true);
    expect(readFileSync(join(workspace, "en-dark/slides/01.html"), "utf-8")).toBe("<p>1</p>");
  });
});

describe("copySeedEntry — locale resolution", () => {
  it("picks the localized variant when it exists", async () => {
    await mkdir(join(seedBase, "seed/zh-CN"), { recursive: true });
    await writeFile(join(seedBase, "seed/zh-CN/hello.md"), "你好");
    await mkdir(join(seedBase, "seed/en"), { recursive: true });
    await writeFile(join(seedBase, "seed/en/hello.md"), "Hello");
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "seed/{{_locale}}/",
      dst: "./",
      params: {},
      locale: "zh-CN",
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "hello.md"), "utf-8")).toBe("你好");
  });

  it("falls back to en when the localized variant is missing", async () => {
    await mkdir(join(seedBase, "seed/en"), { recursive: true });
    await writeFile(join(seedBase, "seed/en/hello.md"), "Hello");
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "seed/{{_locale}}/",
      dst: "./",
      params: {},
      locale: "ja", // no ja variant exists
    });
    expect(result).not.toBeNull();
    expect(readFileSync(join(workspace, "hello.md"), "utf-8")).toBe("Hello");
  });

  it("returns null when neither the localized nor the en variant exists", async () => {
    const result = copySeedEntry({
      workspace,
      seedBase,
      src: "seed/{{_locale}}/",
      dst: "./",
      params: {},
      locale: "ko",
    });
    expect(result).toBeNull();
  });
});

describe("resolveSeedCatalog", () => {
  it("returns declared descriptors when sourceKey resolves in seedFiles", () => {
    const seedFiles = { "a/seed/": "a/", "b/seed/": "b/" };
    const declared: SeedDescriptor[] = [
      { id: "a", sourceKey: "a/seed/", displayName: "A" },
      { id: "b", sourceKey: "b/seed/", displayName: "B" },
    ];
    const result = resolveSeedCatalog(seedFiles, declared);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("drops declared descriptors whose sourceKey is missing", () => {
    const seedFiles = { "a/seed/": "a/" };
    const declared: SeedDescriptor[] = [
      { id: "a", sourceKey: "a/seed/", displayName: "A" },
      { id: "missing", sourceKey: "x/seed/", displayName: "X" },
    ];
    const result = resolveSeedCatalog(seedFiles, declared);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("supports compound sourceKey arrays (all keys must resolve)", () => {
    const seedFiles = { "core.json": "core.json", "extra.png": "extra.png" };
    const declared: SeedDescriptor[] = [
      { id: "bundle", sourceKey: ["core.json", "extra.png"], displayName: "Bundle" },
      { id: "broken", sourceKey: ["core.json", "missing.png"], displayName: "Broken" },
    ];
    const result = resolveSeedCatalog(seedFiles, declared);
    expect(result.map((s) => s.id)).toEqual(["bundle"]);
  });

  it("auto-derives descriptors from seedFiles when none declared, skipping `_`-prefixed entries", () => {
    const seedFiles = {
      "modes/slide/seed/en-dark/": "en-dark/",
      "modes/slide/seed/_shared/": "_shared/", // framework-managed, must not appear
      "modes/slide/seed/zh-light/": "zh-light/",
    };
    const result = resolveSeedCatalog(seedFiles, undefined);
    expect(result.map((s) => s.sourceKey)).toEqual([
      "modes/slide/seed/en-dark/",
      "modes/slide/seed/zh-light/",
    ]);
  });

  it("returns empty when seedFiles is undefined", () => {
    const result = resolveSeedCatalog(undefined, undefined);
    expect(result).toEqual([]);
  });

  it("derives a sensible displayName from a directory seed with dst `./`", () => {
    const seedFiles = { "modes/gridboard/seed/default/": "./" };
    const result = resolveSeedCatalog(seedFiles, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Default");
  });

  it("auto-derive ignores single-file seedFiles entries (framework setup, not user-pickable templates)", () => {
    // invoice-organization shape: a single config file seeded alongside
    // the workspace. Surfacing it as a gallery card offers the user a
    // meaningless pick — fall through to the no-seed empty state
    // instead.
    const seedFiles = { "modes/invoice-organization/seed/profile.json": "profile.json" };
    const result = resolveSeedCatalog(seedFiles, undefined);
    expect(result).toEqual([]);
  });

  it("auto-derive picks directories, drops single files in mixed seedFiles", () => {
    // A mode that ships both a real directory template AND a sidecar
    // config file should only show the directory in the gallery.
    const seedFiles = {
      "mode/seed/default/": "default/",
      "mode/seed/config.json": "config.json",
    };
    const result = resolveSeedCatalog(seedFiles, undefined);
    expect(result.map((s) => s.sourceKey)).toEqual(["mode/seed/default/"]);
  });
});
