import { expect, test } from "bun:test";
import { join } from "node:path";

test("prepared launcher navigates, reveals after readiness, reuses the singleton and handles failure", async () => {
  // Isolate the Electron boundary double so it cannot pollute other suites.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/window-probe.ts")], {
    env: { ...process.env, PNEUMA_BOOT_PROFILE: "0" }, stdout: "pipe", stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  expect(await child.exited, output + error).toBe(0);
});
