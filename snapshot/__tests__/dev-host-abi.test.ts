import { describe, expect, test } from "bun:test";
import { createServer } from "vite";
import { join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostAbiImportMap } from "../host-abi.js";

const projectRoot = resolve(import.meta.dir, "../..");
const configFile = join(projectRoot, "vite.config.ts");

describe("dev Session host ABI", () => {
  test("real Vite HTML resolves compiled viewer imports through exactly one canonical map before any module", async () => {
    const server = await createServer({ configFile, root: projectRoot, logLevel: "silent",
      server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, entries: [], include: [] } });
    try {
      const html = await server.transformIndexHtml("/index.html", await Bun.file(join(projectRoot, "index.html")).text());
      const maps = [...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)];
      expect(maps).toHaveLength(1);
      expect(JSON.parse(maps[0]![1]!)).toEqual(hostAbiImportMap());
      expect(maps[0]!.index!).toBeLessThan(html.indexOf('<script type="module"'));
      expect(server.config.server.proxy?.["/vendor"]).toBeDefined();
      expect(hostAbiImportMap().imports.react).toBe("/vendor/react.js");
    } finally { await server.close(); }
  });
  test("production keeps server-owned HTML injection rather than adding a second map", async () => {
    const process = Bun.spawn(["node", "--input-type=module", "-e", `import { resolveConfig } from 'vite'; const config=await resolveConfig({configFile:${JSON.stringify(configFile)},root:${JSON.stringify(projectRoot)},logLevel:'silent'},'build'); console.log(JSON.stringify(config.plugins.some(plugin=>plugin.name==='pneuma-host-abi-importmap')));`], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
    expect(await process.exited).toBe(0);
    expect(JSON.parse(await new Response(process.stdout).text())).toBe(false);
  });
  test("the canonical declaration loads in Node without a Bun global", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pneuma-host-abi-node-"));
    try {
      const output = join(directory, "host-abi.mjs");
      const build = await Bun.build({ entrypoints: [join(projectRoot, "snapshot/host-abi.ts")], target: "node", format: "esm" });
      expect(build.success).toBe(true); await Bun.write(output, build.outputs[0]!);
      const process = Bun.spawn(["node", "--input-type=module", "-e", `import { hostAbiImportMap } from ${JSON.stringify(output)}; if (typeof Bun !== 'undefined') throw new Error('Bun unexpectedly present'); console.log(JSON.stringify(hostAbiImportMap()));`], { stdout: "pipe", stderr: "pipe" });
      expect(await process.exited).toBe(0);
      expect(JSON.parse(await new Response(process.stdout).text())).toEqual(hostAbiImportMap());
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
