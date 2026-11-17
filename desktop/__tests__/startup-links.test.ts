import { expect, test } from "bun:test";
import { join } from "node:path";

for (const scenario of ["background", "mixed-open", "mixed-handoff", "foreground-cold"] as const) {
  test(scenario === "foreground-cold" ? "an ordinary launch shows the launcher skeleton in the window it then navigates" : `startup protocol requests preserve arrival order (${scenario})`, async () => {
    // Keep Electron boundary doubles isolated from other desktop suites.
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/startup-links-probe.ts")], {
      env: { ...process.env, PNEUMA_BOOT_PROFILE: "0", TEST_SCENARIO: scenario },
      stdout: "pipe", stderr: "pipe",
    });
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code, output + error).toBe(0);
  });
}
