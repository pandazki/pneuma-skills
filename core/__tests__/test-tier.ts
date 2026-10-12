/**
 * Test tiers — which suite a test belongs to.
 *
 * The routine suite (`bun run test`) has one job: be fast enough that nobody
 * is tempted to skip it. Tests that drive authenticated external tools or
 * machine-dependent runtimes pay for the network and machine-local
 * auth state (a keychain read alone measured 5.25s), and what they assert
 * depends on what happens to be installed on the box. Those live in the
 * **live tier**, alongside `backends/` — which the routine suite already
 * leaves out by path. Expensive local frame processing is the separate media
 * tier below, enabled for the affected modes rather than every ordinary run.
 *
 * `bun run test:all` enables both live and media tiers to run every test.
 * `bun run test:backends` enables the live tier for the backend suites only.
 *
 * How to put a file in the live tier:
 *
 *   1. Gate **every** `describe` on `skipIf(!LIVE_TIER)`. A file with one
 *      ungated block still pays its cost, and a block whose assertions assume
 *      "the binary is missing" will FAIL on a box where it is present.
 *   2. Gate any module-level probe too — top-level `await` runs during
 *      collection, before a single `skipIf` is consulted.
 *   3. Name the reason in the describe title (see `LIVE_TIER_LABEL`) **and**
 *      call `announceLiveTierSkip()` at module scope. bun's default console
 *      reporter prints a bare `N skip` count and no names, so the title alone
 *      only reaches the JUnit report — the announcement is what keeps the
 *      skip from being silent in the terminal.
 */

/** True when the caller asked for the live tier (`PNEUMA_TEST_LIVE=1`). */
export const LIVE_TIER = process.env.PNEUMA_TEST_LIVE === "1";

/**
 * Suffix for a live-tier `describe` title. Keep it in the title rather than a
 * comment: a skip has to explain itself in the output, not in the source.
 */
export const LIVE_TIER_LABEL = "[live tier — set PNEUMA_TEST_LIVE=1, or run bun run test:all]";

/**
 * Say out loud, once per file, that a live-tier file was left out. bun groups
 * console output under the file that produced it, so this renders as a named,
 * attributable line in the routine run instead of an anonymous skip count.
 *
 * @param what - what was skipped, in the reader's terms ("the real `gh`
 *   binary probe and every assertion that depends on it").
 */
export function announceLiveTierSkip(what: string): void {
  if (LIVE_TIER) return;
  console.log(`[test-tier] skipped ${what} ${LIVE_TIER_LABEL}`);
}

/**
 * Local media processing is independent of paid/network integration tests.
 * Enable every mode with PNEUMA_TEST_MEDIA=1, or select comma-separated mode
 * names. Read at call time so a runner can pass an explicit selection without
 * relying on import order. A missing setting never opts into media work.
 * Gate module-level binary probes as well as the tests that run the pipeline;
 * put fixture construction in beforeAll because skipped describe bodies run.
 */
export function mediaTierEnabled(modeName: string): boolean {
  const setting = process.env.PNEUMA_TEST_MEDIA?.trim() ?? "";
  if (setting === "1") return true;
  return modeName.length > 0 && setting.split(",").some((name) => name.trim() === modeName);
}

export function announceMediaTierSkip(modeName: string, what: string): void {
  if (mediaTierEnabled(modeName)) return;
  console.log(
    `[test-tier] skipped ${what} [media tier — set PNEUMA_TEST_MEDIA=${modeName} or 1, or run bun run test:all]`,
  );
}
