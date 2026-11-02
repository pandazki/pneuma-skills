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

  for (const marker of ["1", undefined]) {
    test(`finds an agent installed after ${marker ? "desktop" : "CLI"} PATH initialization without recapturing the shell`, async () => {
      const root = mkdtempSync(join(tmpdir(), "pneuma-path-install-"));
      roots.push(root);
      const shell = join(root, "shell");
      const captures = join(root, "captures");
      writeFileSync(shell, `#!/bin/sh\nprintf 'capture\\n' >> '${captures}'\nprintf '___PNEUMA_PATH_START___\\n/usr/bin:/bin\\n___PNEUMA_PATH_END___\\n'\n`);
      chmodSync(shell, 0o755);
      const script = `
        import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
        import { join } from "node:path";
        import { getEnrichedPath, resolveBinary } from ${JSON.stringify(join(import.meta.dir, "../path-resolver.ts"))};
        const directory = join(process.env.HOME, ".local", "bin");
        const name = "pneuma-fresh-agent-fixture";
        const beforePath = getEnrichedPath();
        const before = resolveBinary(name);
        mkdirSync(directory, { recursive: true });
        const binary = join(directory, name);
        writeFileSync(binary, "#!/bin/sh\\nprintf 'fixture agent'\\n");
        chmodSync(binary, 0o755);
        const after = resolveBinary(name);
        const afterPath = getEnrichedPath();
        const launched = after ? Bun.spawnSync([name], { env: { ...process.env, PATH: afterPath } }) : null;
        console.log(JSON.stringify({ directory, binary, beforePath, before, after, afterPath, output: launched?.stdout.toString() }));
      `;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...process.env, HOME: root, PATH: "/usr/bin:/bin", SHELL: shell, PNEUMA_DESKTOP_PATH_READY: marker },
        stdout: "pipe", stderr: "pipe",
      });
      const output = await new Response(child.stdout).text();
      const error = await new Response(child.stderr).text();
      expect(await child.exited, error).toBe(0);
      const result = JSON.parse(output);
      expect(result.beforePath.split(":")).not.toContain(result.directory);
      expect(result.before).toBeNull();
      expect(result.after).toBe(result.binary);
      expect(result.afterPath.split(":")).toContain(result.directory);
      expect(result.output).toBe("fixture agent");
      expect(existsSync(captures) ? readFileSync(captures, "utf8") : "").toBe(marker ? "" : "capture\n");
    });
  }
});
