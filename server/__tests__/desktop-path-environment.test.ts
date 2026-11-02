import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform === "win32")("desktop inherited PATH contract", () => {
  async function probe(marker: string | undefined, inheritedPath = "/usr/bin:/bin") {
    const root = mkdtempSync(join(tmpdir(), "pneuma-path-reuse-"));
    roots.push(root);
    const shell = join(root, "shell");
    const touched = join(root, "captured");
    writeFileSync(shell, `#!/bin/sh\nprintf captured > '${touched}'\nprintf '___PNEUMA_PATH_START___\\n/usr/bin:/bin\\n___PNEUMA_PATH_END___\\n'\n`);
    chmodSync(shell, 0o755);
    const script = `import { getEnrichedPath, buildFallbackPath } from ${JSON.stringify(join(import.meta.dir, "../path-resolver.ts"))}; console.log(JSON.stringify({ path: getEnrichedPath(), fallback: buildFallbackPath() }));`;
    const child = Bun.spawn([process.execPath, "-e", script], {
      env: { ...process.env, PATH: inheritedPath, SHELL: shell, PNEUMA_DESKTOP_PATH_READY: marker },
      stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(error).toBe("");
    return { result: JSON.parse(output) as { path: string; fallback: string }, captured: existsSync(touched) ? readFileSync(touched, "utf8") : null };
  }

  test("reuses desktop PATH and retains server fallback directories without sourcing a shell", async () => {
    const { result, captured } = await probe("1");
    expect(captured).toBeNull();
    expect(result.path.split(":")).toContain("/usr/bin");
    for (const dir of result.fallback.split(":").filter(Boolean)) expect(result.path.split(":")).toContain(dir);
  });

  test("unmarked CLI launch still captures the shell", async () => {
    expect((await probe(undefined)).captured).toBe("captured");
  });

  test("unknown markers and invalid inherited PATH cannot suppress normal capture", async () => {
    expect((await probe("true")).captured).toBe("captured");
    expect((await probe("1", "not an absolute directory")).captured).toBe("captured");
  });
});
