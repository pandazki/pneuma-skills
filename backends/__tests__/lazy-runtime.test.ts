import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("loading the server and backend catalog keeps each unused runtime unloaded", async () => {
  // The other contract tests construct every backend; inspect a fresh Bun module cache.
  const probe = Bun.spawn([process.execPath, "-e", `
    import { startServer } from "./server/index.ts";
    import { createBackend, getBackendDescriptors } from "./backends/index.ts";
    import { relative, sep } from "node:path";
    const loaded = () => Object.keys(require.cache)
      .map(path => relative(process.cwd(), path).split(sep).join("/"))
      .filter(path => /^backends[/](codex|kimi-cli|claude-code)[/]index[.]ts$|^server[/]ws-bridge-(codex|kimi)[.]ts$/.test(path));
    if (typeof startServer !== "function" || !getBackendDescriptors().length) process.exit(1);
    const catalog = loaded();
    createBackend("codex", 17007);
    console.log(JSON.stringify([catalog, loaded()]));
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "inherit" });
  const output = await new Response(probe.stdout).text();
  expect(await probe.exited).toBe(0);
  expect(JSON.parse(output)).toEqual([[], ["backends/codex/index.ts"]]);
});
