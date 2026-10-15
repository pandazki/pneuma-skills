import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../index.js";
import { hostAbiImportMap } from "../../snapshot/host-abi.js";

for (const production of [false, true]) {
  test(`ordinary bundled Project Session serves canonical ABI shims in ${production ? "production" : "dev"}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "pneuma-project-host-abi-"));
    const distDir = join(root, "dist");
    mkdirSync(distDir);
    writeFileSync(join(distDir, "index.html"), '<!doctype html><html><head></head><body><script type="module" src="/app.js"></script></body></html>');
    const running = await startServer({ port: 0, workspace: root, pneumaProjectRoot: root,
      modeName: "webcraft", editing: false, ...(production ? { distDir } : {}) });
    try {
      const origin = `http://127.0.0.1:${running.server.port}`;
      for (const path of new Set(Object.values(hostAbiImportMap().imports))) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("application/javascript");
        const source = await response.text();
        expect(source).toContain("__PNEUMA_");
        expect(source).not.toContain('from "../src/store');
      }
      const info = await fetch(`${origin}/api/mode-info`).then((response) => response.json());
      expect(info.viewerBuild).toBeUndefined(); // Supplying shims does not invent a mode build.
      if (production) for (const path of ["/", "/index.html"]) {
        const html = await fetch(`${origin}${path}`).then((response) => response.text());
        const maps = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
        expect(maps).toHaveLength(1); expect(JSON.parse(maps[0]![1]!)).toEqual(hostAbiImportMap());
        expect(maps[0]!.index!).toBeLessThan(html.indexOf('<script type="module"'));
      }
    } finally { await running.server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
}
