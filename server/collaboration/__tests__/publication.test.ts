import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModeManifest } from "../../../core/types/mode-manifest.js";
import type { ModePublicationAdapter } from "../../../core/types/collaboration-publication.js";
import { readModeContentSnapshot, readPublicationInputFiles } from "../publication.js";
import { canonical } from "../../../core/collaboration/authority-domain.js";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const manifest = { name: "test", sources: { files: { kind: "memory" } }, viewerApi: {
  collaboration: { viewing: true, publication: { module: "publication.ts", schema: "test@1" } },
} } as unknown as ModeManifest;
const adapter: ModePublicationAdapter = {
  schema: "test@1", project(input) {
    return { resources: ["site/index.html"], page: "site/index.html",
      projection: { schema: "test@1", sources: { files: input.files.filter((file) => file.path === "site/index.html").map((f) => ({ ...f })) }, entryAddress: { page: "site/index.html" } } };
  },
};
function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "pneuma-publication-")); roots.push(workspace);
  mkdirSync(join(workspace, "site")); writeFileSync(join(workspace, "site/index.html"), "<h1>captured</h1>");
  writeFileSync(join(workspace, "history.json"), '{"private":"Agent history"}');
  return { workspace, manifest, adapter, input: { files: [{ path: "site/index.html", content: "<h1>old source</h1>" }, { path: "history.json", content: "private" }], contentSet: "site", activeFile: "index.html", initParams: { apiKey: "private-key" } } };
}

describe("mode-owned publication boundary", () => {
  test("mixed-case and punctuation Source keys have exactly the authority's SHA-256 fingerprint", async () => {
    const options = fixture();
    const result = await readModeContentSnapshot({ ...options,
      manifest: { ...manifest, sources: { ...manifest.sources, Z: { kind: "memory" }, a: { kind: "memory" } } } as unknown as ModeManifest,
      adapter: { ...adapter, project(input) {
        const base = adapter.project(input) as Awaited<ReturnType<ModePublicationAdapter["project"]>>;
        return { ...base, projection: { ...base.projection, sources: { ...base.projection.sources, a: "lower", Z: { title: "lower", Title: "upper", _meta: "punctuation" } } } };
      } },
    });
    const authorityWire = canonical({ files: result.files, projection: result.projection });
    expect(authorityWire.indexOf('"Z":')).toBeLessThan(authorityWire.indexOf('"a":'));
    expect(authorityWire).toContain('"Title":"upper","_meta":"punctuation","title":"lower"');
    expect(result.fingerprint).toBe(new Bun.CryptoHasher("sha256").update(authorityWire).digest("hex"));
  });
  test("metadata inputs are bounded and cannot read private state or outside symlinks", async () => {
    const options = fixture();
    const base = adapter.project(options.input) as Awaited<ReturnType<ModePublicationAdapter["project"]>>;
    await expect(readModeContentSnapshot({ ...options, adapter: { ...adapter, project: () => ({ ...base, projectionInputs: ["history.json"] }) } })).rejects.toThrow("bounded local allowlist");
    await expect(readModeContentSnapshot({ ...options, adapter: { ...adapter, project: () => ({ ...base, projectionInputs: Array.from({ length: 257 }, (_, index) => `meta-${index}.json`) }) } })).rejects.toThrow("bounded local allowlist");
    const outside = mkdtempSync(join(tmpdir(), "pneuma-publication-outside-")); roots.push(outside);
    writeFileSync(join(outside, "data.json"), '{"secret":"outside"}');
    symlinkSync(join(outside, "data.json"), join(options.workspace, "site", "linked.json"));
    expect(readPublicationInputFiles(options.workspace, "site").map((file) => file.path)).toEqual(["site/index.html"]);
  });
  test("projects Sources from exactly the captured resource bytes, excluding unrelated files and params", async () => {
    const result = await readModeContentSnapshot(fixture());
    expect(result.files.map((file) => file.path)).toEqual(["site/index.html"]);
    expect(result.projection.sources.files).toEqual([{ path: "site/index.html", content: "<h1>captured</h1>" }]);
    expect(new TextDecoder().decode(result.blobs.get(result.files[0]!.hash))).toBe("<h1>captured</h1>");
    expect(result.projection.initParams).toBeUndefined();
    expect(JSON.stringify(result.projection)).not.toContain("private");
  });
  test("rejects undeclared Source names, private paths and symlinked resources", async () => {
    const options = fixture();
    const base = adapter.project(options.input) as Awaited<ReturnType<ModePublicationAdapter["project"]>>;
    await expect(readModeContentSnapshot({ ...options, adapter: { ...adapter, project: () => ({ ...base, projection: { ...base.projection, sources: { secret: "x" } } }) } })).rejects.toThrow("not declared");
    await expect(readModeContentSnapshot({ ...options, adapter: { ...adapter, project: () => ({ ...base, resources: ["history.json"], page: "history.json" }) } })).rejects.toThrow("Private");
    rmSync(join(options.workspace, "site/index.html"));
    symlinkSync(join(options.workspace, "history.json"), join(options.workspace, "site/index.html"));
    await expect(readModeContentSnapshot(options)).rejects.toThrow("Symbolic links");
  });
  test("a changed dependency set fails instead of committing an incomplete projection", async () => {
    const options = fixture(); let calls = 0;
    await expect(readModeContentSnapshot({ ...options, adapter: { ...adapter, project(input) {
      const value = adapter.project(input) as Awaited<ReturnType<ModePublicationAdapter["project"]>>;
      return ++calls === 1 ? value : { ...value, resources: [...value.resources, "late.png"] };
    } } })).rejects.toThrow("dependencies changed");
  });
});
