/**
 * Tests for `core/github-cli.ts`.
 *
 * `detectGh` shells out to the real local `gh` binary. We avoid brittle
 * `mock.module("bun", ...)` here — instead we probe PATH at test setup
 * time and gate the assertions on what's actually available.
 *
 * That honesty is exactly why this file is **live tier**: every assertion
 * below costs a real `gh` spawn, and `gh auth status` reads the macOS
 * keychain, which measured 1.5–5.3s per call depending on load. The routine
 * suite skips it; `bun run test:all` runs it. See `./test-tier.ts`.
 */

import { describe, expect, test } from "bun:test";
import { detectGh, createRepo } from "../github-cli.js";
import { LIVE_TIER, LIVE_TIER_LABEL, announceLiveTierSkip } from "./test-tier.js";

announceLiveTierSkip("the real `gh` binary probe and every assertion built on it");

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

// Top-level `await` runs during collection, before any `skipIf` is consulted
// — so the probe itself has to be gated, or a routine run pays for it while
// skipping everything it was meant to inform.
const ghAvailable = LIVE_TIER ? await probeGhInstalled() : false;

describe.skipIf(!LIVE_TIER)(`detectGh ${LIVE_TIER_LABEL}`, () => {
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
    // detectGh shells out to `gh auth status`, which reads the macOS
    // keychain (~2.6s measured; slower under full-suite load) — the default
    // 5s budget flakes without asserting anything about speed.
    20_000,
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
  }, 20_000);
});

describe.skipIf(!LIVE_TIER)(`createRepo ${LIVE_TIER_LABEL}`, () => {
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
    // createRepo runs the full detectGh probe first, and `gh auth status`
    // reads the macOS keychain (~2.6s measured; slower under load) before
    // the invalid call even starts — the default 5s budget flakes on a
    // machine with keychain-backed auth while asserting nothing about speed.
    20_000,
  );
});
