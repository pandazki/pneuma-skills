/**
 * Tests for `core/github-cli.ts`.
 *
 * `detectGh` shells out to the real local `gh` binary. We avoid brittle
 * `mock.module("bun", ...)` here — instead we probe PATH at test setup
 * time and gate the assertions on what's actually available.
 */

import { describe, expect, test } from "bun:test";
import { detectGh, createRepo } from "../github-cli.js";

/** Returns true when `gh --version` exits 0 within a short timeout. */
async function probeGhInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["gh", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) =>
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          resolve(1);
        }, 5_000),
      ),
    ]);
    return exited === 0;
  } catch {
    return false;
  }
}

const ghAvailable = await probeGhInstalled();

describe("detectGh", () => {
  test.skipIf(!ghAvailable)(
    "reports installed: true with a version string when gh is on PATH",
    async () => {
      const status = await detectGh();
      expect(status.installed).toBe(true);
      expect(typeof status.version).toBe("string");
      expect(status.version!.length).toBeGreaterThan(0);
      // authenticated is a boolean either way — we don't constrain its
      // value because CI may or may not have a logged-in gh session.
      expect(typeof status.authenticated).toBe("boolean");
      if (status.authenticated) {
        // username is best-effort; if present it's a non-empty string.
        if (status.username !== undefined) {
          expect(typeof status.username).toBe("string");
          expect(status.username.length).toBeGreaterThan(0);
        }
      } else {
        expect(status.hint).toMatch(/gh auth login/);
      }
    },
  );

  test.skipIf(ghAvailable)(
    "reports installed: false with an install hint when gh is missing",
    async () => {
      const status = await detectGh();
      expect(status.installed).toBe(false);
      expect(status.authenticated).toBe(false);
      expect(status.hint).toMatch(/cli\.github\.com/);
    },
  );

  test("shape contract — every field has the expected type", async () => {
    const status = await detectGh();
    expect(typeof status.installed).toBe("boolean");
    expect(typeof status.authenticated).toBe("boolean");
    if (status.version !== undefined) {
      expect(typeof status.version).toBe("string");
    }
    if (status.hint !== undefined) {
      expect(typeof status.hint).toBe("string");
    }
    if (status.username !== undefined) {
      expect(typeof status.username).toBe("string");
    }
  });
});

describe("createRepo", () => {
  test.skipIf(ghAvailable)(
    "throws with the install hint when gh is missing",
    async () => {
      await expect(
        createRepo({
          name: "fake/fake",
          sourcePath: "/tmp/does-not-matter",
        }),
      ).rejects.toThrow(/cli\.github\.com|gh auth login/);
    },
  );

  test.skipIf(!ghAvailable)(
    "rejects when gh is installed but the call is obviously invalid (smoke)",
    async () => {
      // We do NOT actually want to create a real repo, so we point at a
      // source path that does not exist and a slug we will not collide with.
      // gh will fail; we just want the call to throw, not to hang.
      await expect(
        createRepo({
          name: "pneuma-tests-do-not-create-this/should-not-exist-" + Date.now(),
          sourcePath: "/tmp/__pneuma_definitely_not_a_real_path__" + Date.now(),
        }),
      ).rejects.toThrow();
    },
  );
});
