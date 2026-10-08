import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureModeDependencies, isTransientInstallError } from "../mode-dependencies.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mode-deps-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{}');
  return dir;
}

test("a certificate failure retries, and a successful install is reused", async () => {
  const dir = fixture();
  let attempts = 0;
  const delays: number[] = [];
  const run = async () => {
    attempts++;
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    return attempts < 3
      ? { exitCode: 1, stderr: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR downloading package manifest react" }
      : { exitCode: 0, stderr: "" };
  };
  await ensureModeDependencies(dir, { run, wait: async (ms) => { delays.push(ms); } });
  await ensureModeDependencies(dir, { run });
  expect(attempts).toBe(3);
  expect(delays).toEqual([500, 1500]);
  expect(existsSync(join(dir, ".pneuma-install-pending"))).toBe(false);
});

test("exhausted retries report the error and a later attempt repairs partial node_modules", async () => {
  const dir = fixture();
  let attempts = 0;
  await expect(ensureModeDependencies(dir, {
    run: async () => {
      attempts++;
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      return { exitCode: 1, stderr: "ECONNRESET" };
    },
    wait: async () => {},
  })).rejects.toThrow("ECONNRESET");
  expect(attempts).toBe(3);
  await ensureModeDependencies(dir, {
    run: async () => { attempts++; return { exitCode: 0, stderr: "" }; },
  });
  expect(attempts).toBe(4);
});

test("invalid versions and process failures do not spin or masquerade as success", async () => {
  expect(isTransientInstallError("TLS error\nerror: postinstall script from widget exited with 1")).toBe(false);
  expect(isTransientInstallError("Dependency installation timed out.\nResolving dependencies")).toBe(false);
  const dir = fixture();
  let attempts = 0;
  await expect(ensureModeDependencies(dir, {
    run: async () => { attempts++; return { exitCode: 1, stderr: "No version matching 999.0.0" }; },
  })).rejects.toThrow("No version matching");
  expect(attempts).toBe(1);
  await expect(ensureModeDependencies(dir, { run: async () => { throw new Error("spawn denied"); } }))
    .rejects.toThrow("spawn denied");
  expect(existsSync(join(dir, ".pneuma-install-pending"))).toBe(true);
});

test("explicit recovery repairs a legacy partial install without a pending marker", async () => {
  const dir = fixture();
  mkdirSync(join(dir, "node_modules"));
  let installed = false;
  await ensureModeDependencies(dir, { force: true, run: async () => {
    installed = true;
    return { exitCode: 0, stderr: "" };
  } });
  expect(installed).toBe(true);
});

test("the real installer drains a verbose local lifecycle script without blocking exit", async () => {
  const dir = fixture();
  // No dependencies or network. More than a pipe buffer of stderr pins the
  // ordering: waiting for exit before reading stderr would deadlock here.
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "local-install-fixture", scripts: { preinstall: "bun ./install-fixture.mjs" },
  }));
  writeFileSync(join(dir, "install-fixture.mjs"), 'process.stderr.write("x".repeat(256 * 1024));');
  await ensureModeDependencies(dir);
  expect(existsSync(join(dir, ".pneuma-install-pending"))).toBe(false);
}, 20_000);
