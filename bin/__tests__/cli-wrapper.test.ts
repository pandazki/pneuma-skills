/**
 * PNEUMA_CLI wrapper tests.
 *
 * The env var must be ONE spaceless executable path: fish never word-splits
 * a variable (a two-token value becomes the command name → exit 127), and
 * bash word-splits a spaced install path (`/Applications/Pneuma Skills.app/…`)
 * into garbage. These tests pin the wrapper's shape, its idempotence, the
 * degraded fallback, and — with a real spawn — that a spaced entry path
 * survives the trip through the wrapper intact.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWrapperScript, ensureCliWrapper, legacyCliInvocation } from "../cli-wrapper.js";

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-cli-wrapper-"));
  prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("buildWrapperScript", () => {
  test("quotes both paths and forwards all arguments", () => {
    const script = buildWrapperScript("/opt/my bun/bun", "/Applications/Pneuma Skills.app/bin/pneuma.ts");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain('exec "/opt/my bun/bun" "/Applications/Pneuma Skills.app/bin/pneuma.ts" "$@"');
  });

  test("escapes sh-significant characters inside double quotes", () => {
    const script = buildWrapperScript("/bin/bun", '/weird/pa"th/$HOME/pneuma.ts');
    expect(script).toContain('"/weird/pa\\"th/\\$HOME/pneuma.ts"');
  });
});

describe("ensureCliWrapper", () => {
  test.skipIf(process.platform === "win32")(
    "returns one spaceless executable path under ~/.pneuma/bin",
    () => {
      const cli = ensureCliWrapper({
        runtime: "/usr/local/bin/bun",
        entry: "/Applications/Pneuma Skills.app/Contents/Resources/bin/pneuma.ts",
      });
      expect(cli).toStartWith(join(tmpHome, ".pneuma", "bin") + "/");
      expect(cli).not.toContain(" ");
      expect(statSync(cli).mode & 0o111).toBeTruthy();
      const script = readFileSync(cli, "utf-8");
      expect(script).toContain('"/Applications/Pneuma Skills.app/Contents/Resources/bin/pneuma.ts"');
    },
  );

  test.skipIf(process.platform === "win32")("idempotent for the same install; distinct per install", () => {
    const a1 = ensureCliWrapper({ runtime: "/r/bun", entry: "/a/pneuma.ts" });
    const a2 = ensureCliWrapper({ runtime: "/r/bun", entry: "/a/pneuma.ts" });
    const b = ensureCliWrapper({ runtime: "/r/bun", entry: "/b/pneuma.ts" });
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);
  });

  test.skipIf(process.platform === "win32")(
    "a spaced entry path survives the wrapper intact when actually executed",
    () => {
      // /bin/echo as the "runtime" prints exactly the argv the wrapper
      // passed along — a real spawn, not an assertion about string shape.
      const cli = ensureCliWrapper({
        runtime: "/bin/echo",
        entry: "/Applications/Pneuma Skills.app/bin/pneuma.ts",
      });
      const proc = Bun.spawnSync([cli, "session", "refine"]);
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString().trim()).toBe(
        "/Applications/Pneuma Skills.app/bin/pneuma.ts session refine",
      );
    },
  );

  test("falls back to the legacy two-token string when HOME is unwritable", () => {
    // Point HOME below a regular FILE so mkdir must fail.
    const blocker = join(tmpHome, "not-a-dir");
    writeFileSync(blocker, "x", "utf-8");
    process.env.HOME = join(blocker, "home");
    const cli = ensureCliWrapper({ runtime: "/r/bun", entry: "/a/pneuma.ts" });
    expect(cli).toBe(legacyCliInvocation("/a/pneuma.ts"));
  });
});
