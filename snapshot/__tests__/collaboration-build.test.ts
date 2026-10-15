import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCollaborationAssets } from "../collaboration-build.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "collaboration-build-")); roots.push(root);
  mkdirSync(join(root, "modes", "shared", "viewer"), { recursive: true });
  mkdirSync(join(root, "modes", "unsupported"), { recursive: true });
  mkdirSync(join(root, "src", "collaboration"), { recursive: true });
  mkdirSync(join(root, "public", "fonts", "test"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"4.0.0","type":"module"}');
  writeFileSync(join(root, "modes", "distribution.json"), '{"bundled":["shared","unsupported"]}');
  writeFileSync(join(root, "modes", "shared", "manifest.ts"), 'export default { name: "shared", version: "1.0.0", viewerApi: { collaboration: { viewing: true, publication: { module: "publication.ts", schema: "shared-v1" } } } };');
  writeFileSync(join(root, "modes", "shared", "publication.ts"), 'export default {schema:"shared-v1",frameScript:"window.pageRuntime=1",project(){throw Error("Build must not read content")}};');
  writeFileSync(join(root, "modes", "shared", "pneuma-mode.ts"), 'import "./viewer/styles.css"; export default { viewer: { PreviewComponent: () => null } };');
  writeFileSync(join(root, "modes", "shared", "viewer", "styles.css"), "body { color: red }");
  writeFileSync(join(root, "modes", "unsupported", "manifest.ts"), 'export default { name: "unsupported", version: "1.0.0" };');
  writeFileSync(join(root, "modes", "unsupported", "pneuma-mode.ts"), 'this viewer must not be built');
  writeFileSync(join(root, "src", "collaboration", "main.ts"), 'import "../index.css"; document.title="Public viewer";');
  writeFileSync(join(root, "src", "index.css"), '@font-face{font-family:Test;src:url(/fonts/test/font.woff2)} body{color:#f97316}');
  writeFileSync(join(root, "public", "fonts", "test", "font.woff2"), "test-font-bytes");
  writeFileSync(join(root, "public", "fonts", "test", "OFL.txt"), "Public font license");
  return root;
}

describe("public collaboration asset assembly", () => {
  test("builds only declared modes with the normal ABI and hashes page runtime as part of the artifact", async () => {
    const root = fixture();
    const result = await buildCollaborationAssets({ projectRoot: root, entry: "src/collaboration/main.ts" });
    expect(result.catalog.modes.map((mode) => mode.mode)).toEqual(["shared"]);
    const mode = result.catalog.modes[0];
    expect(mode.coreVersion).toBe("4.0.0");
    expect(mode.publicationSchema).toBe("shared-v1");
    expect(mode.entry).toContain(`/viewer/shared/v1.0.0/${mode.viewerHash}/pneuma-mode.js`);
    expect(mode.frameScriptUrl).toContain(`/${mode.viewerHash}/page-runtime.js`);
    const firstEntry = readFileSync(join(result.directory, mode.entry.slice(1)), "utf8");
    writeFileSync(join(root, "modes", "shared", "publication.ts"), 'export default {schema:"shared-v1",frameScript:"window.pageRuntime=2",project(){}};');
    const changed = await buildCollaborationAssets({ projectRoot: root, entry: "src/collaboration/main.ts" });
    expect(changed.catalog.modes[0].viewerHash).not.toBe(mode.viewerHash);
    expect(readFileSync(join(changed.directory, changed.catalog.modes[0].entry.slice(1)), "utf8")).toBe(firstEntry);
    writeFileSync(join(root, "modes", "shared", "viewer", "styles.css"), "body { color: blue }");
    const changedCss = await buildCollaborationAssets({ projectRoot: root, entry: "src/collaboration/main.ts" });
    expect(changedCss.catalog.modes[0].viewerHash).not.toBe(changed.catalog.modes[0].viewerHash);
    expect(changedCss.catalog.modes[0].styles.length).toBeGreaterThan(0);
  });

  test("ships versioned ABI shims and fonts with licenses, and preserves the last complete output on failure", async () => {
    const root = fixture();
    const result = await buildCollaborationAssets({ projectRoot: root, entry: "src/collaboration/main.ts" });
    const index = readFileSync(join(result.directory, "index.html"), "utf8");
    expect(index).toContain('type="importmap"');
    expect(index).toContain("/assets/host-v4.0.0/");
    const manifest = JSON.parse(readFileSync(join(result.directory, "viewer-manifest.json"), "utf8"));
    expect(manifest.files.some((file: { path: string }) => file.path.endsWith("OFL.txt"))).toBe(true);
    const css = manifest.files.filter((file: { path: string }) => file.path.endsWith(".css")).map((file: { path: string }) => readFileSync(join(result.directory, file.path), "utf8")).join("\n");
    expect(css).toContain("/assets/fonts-v4.0.0/");
    const previous = readFileSync(join(result.directory, "viewer-manifest.json"), "utf8");
    writeFileSync(join(root, "src", "collaboration", "main.ts"), 'import "./missing-module";');
    await expect(buildCollaborationAssets({ projectRoot: root, entry: "src/collaboration/main.ts" })).rejects.toThrow();
    expect(readFileSync(join(result.directory, "viewer-manifest.json"), "utf8")).toBe(previous);
  });
});
