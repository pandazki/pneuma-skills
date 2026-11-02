import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform === "win32")("launcher startup ownership", () => {
  async function run(scenario: string) {
    const root = mkdtempSync(join(tmpdir(), "pneuma-desktop-start-"));
    roots.push(root);
    mkdirSync(join(root, "bun"));
    mkdirSync(join(root, "pneuma"));
    const shell = join(root, "shell");
    const bun = join(root, "bun", "bun");
    const captureLog = join(root, "capture-count");
    writeFileSync(shell, `#!/bin/sh\nprintf 'capture\\n' >> "$TEST_CAPTURE_LOG"\n${scenario === "cancel-shell" ? "exec /bin/sleep 30" : 'exec /bin/sh -c "$2"'}\n`);
    writeFileSync(bun, `#!/bin/sh\nprintf '%s' "$$" > "$TEST_CHILD_PID"\nprintf '%s' "$PNEUMA_DESKTOP_PATH_READY" > "$TEST_PATH_MARKER"\n${scenario === "ready" ? "printf 'Marketplace → http://localhost:32123\\n'" : ""}\nexec /bin/sleep 30\n`);
    chmodSync(shell, 0o755);
    chmodSync(bun, 0o755);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/startup-probe.ts")], {
      env: { ...process.env, SHELL: shell, PATH: "/usr/bin:/bin", PNEUMA_BOOT_PROFILE: "0", TEST_SCENARIO: scenario, TEST_RESOURCES: root,
        TEST_CAPTURE_LOG: captureLog, TEST_CHILD_PID: join(root, "child-pid"), TEST_PATH_MARKER: join(root, "marker") },
      stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect(await child.exited, output + errors).toBe(0);
    return { root, captureLog };
  }

  test("captures once, passes the completed-attempt marker, and resolves the service URL", async () => {
    const { root, captureLog } = await run("ready");
    expect(readFileSync(captureLog, "utf8")).toBe("capture\n");
    expect(readFileSync(join(root, "marker"), "utf8")).toBe("1");
  });

  test("quitting during shell capture prevents a late Bun spawn", async () => { await run("cancel-shell"); });
  test("quitting while waiting for readiness rejects startup and terminates its child", async () => { await run("cancel-child"); });
});
