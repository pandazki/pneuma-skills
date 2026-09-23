/**
 * The hosted player's own mode registry.
 *
 * The player is always built from this repository, where every mode's source
 * is present — so it compiles the viewers it can render straight into
 * `dist-player/`, regardless of which modes the npm package bundles. It
 * cannot use `core/mode-loader.ts`'s builtin registry: that one lists the
 * BUNDLED set only (`modes/distribution.json`), and most playable modes
 * (doc, draw, bansho, wordtaste, sprite, eli5) are catalog modes that a
 * released app downloads at runtime. The player has no runtime to download
 * into — it is static files on a CDN.
 *
 * The entries here are therefore the *build list* for the player bundle, and
 * they must stay equal to `WEB_PLAYER_SUPPORTED_MODES`: a mode in the
 * whitelist without an entry here loads nothing and hard-errors the share
 * link, and an entry without a whitelist membership silently inflates the
 * bundle. `src/player/__tests__/player-modes.test.ts` fails on either.
 *
 * Adding a mode: add it to `core/player-support.ts` (the semantic decision,
 * shared with the exporter), add it here (the build decision), then run
 * `scripts/deploy-player.sh` — CI never deploys the player.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import { WEB_PLAYER_SUPPORTED_MODES } from "../../core/player-support.js";

/**
 * Static `import()` per mode — Vite follows these at build time, which is
 * exactly the intent. Do not turn this into a computed specifier.
 */
const playerModes: Record<string, () => Promise<ModeDefinition>> = {
  bansho: () => import("../../modes/bansho/pneuma-mode.js").then((m) => m.default),
  cosmos: () => import("../../modes/cosmos/pneuma-mode.js").then((m) => m.default),
  diagram: () => import("../../modes/diagram/pneuma-mode.js").then((m) => m.default),
  doc: () => import("../../modes/doc/pneuma-mode.js").then((m) => m.default),
  draw: () => import("../../modes/draw/pneuma-mode.js").then((m) => m.default),
  eli5: () => import("../../modes/eli5/pneuma-mode.js").then((m) => m.default),
  illustrate: () => import("../../modes/illustrate/pneuma-mode.js").then((m) => m.default),
  kami: () => import("../../modes/kami/pneuma-mode.js").then((m) => m.default),
  remotion: () => import("../../modes/remotion/pneuma-mode.js").then((m) => m.default),
  slide: () => import("../../modes/slide/pneuma-mode.js").then((m) => m.default),
  sprite: () => import("../../modes/sprite/pneuma-mode.js").then((m) => m.default),
  webcraft: () => import("../../modes/webcraft/pneuma-mode.js").then((m) => m.default),
  wordtaste: () => import("../../modes/wordtaste/pneuma-mode.js").then((m) => m.default),
};

/** Mode names this player build can mount. */
export const PLAYER_MODE_NAMES: readonly string[] = Object.keys(playerModes);

/**
 * Load a whitelisted viewer. Throws with the mode name when this build has
 * no viewer for it — the player shell turns that into the "could not be
 * loaded" screen rather than an empty frame.
 */
export async function loadPlayerMode(name: string): Promise<ModeDefinition> {
  const loader = playerModes[name];
  if (!loader) {
    throw new Error(
      `This player build cannot render "${name}" (supported: ${PLAYER_MODE_NAMES.join(", ")}).`,
    );
  }
  return loader();
}

/** Whether this build carries a viewer for `name`. Cheap, synchronous. */
export function hasPlayerMode(name: string | undefined | null): boolean {
  return !!name && name in playerModes;
}

/** Re-exported so the parity test compares against one import. */
export { WEB_PLAYER_SUPPORTED_MODES };
