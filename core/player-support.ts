/**
 * Modes the hosted static player can render read-only. Shared by:
 *  - the play-package materializer (`server/play-export.ts`) to set
 *    `PlayPackageIndex.supported`, and
 *  - the player shell to decide whether to mount the viewer or show the
 *    "open in local client" fallback.
 *
 * Grows as per-mode support lands. v1 shipped the "regular" tier; diagram /
 * remotion / cosmos followed (each needed host config or a vendored
 * dependency). bansho and wordtaste joined after browser verification against
 * real packages: bansho's progressive reveal, seek, chalk textures, chart
 * layers, KaTeX-mathml formulas and narration audio all resolve through the
 * content service worker (`/api/file` probes 404-degrade by design), and
 * wordtaste's file-backed sources degrade to defaults when a file is absent
 * from the package (`.pneuma/*.json` never ships — shadow git excludes it).
 * clipcraft, mode-maker, gridboard and any custom mode
 * are intentionally NOT web-playable — they fall back to the local client.
 *
 * No React / Bun imports — importable from both backend and frontend.
 */
export const WEB_PLAYER_SUPPORTED_MODES: readonly string[] = [
  "draw",
  "doc",
  "illustrate",
  "slide",
  "webcraft",
  "kami",
  // Follow-up tier — work in the player because the deploy sets no restrictive
  // CSP (remotion's in-browser Babel eval is allowed) and lets the diagram
  // draw.io / rough.js CDN scripts load. Verified on the hosted player.
  "diagram",
  "remotion",
  "cosmos",
  // eli5's pages are self-contained documents rendered in sandboxed srcdoc
  // iframes; the only network dependency is the Google Fonts link inside each
  // page, which the player's permissive CSP allows. Verified on the local
  // player harness against both seed topics.
  "eli5",
  // Self-contained viewers — no CDN, no eval; fonts and KaTeX assets bundle
  // into player-assets/. Verified locally against seed-built packages
  // (bansho: tech-zh board + slate chalk theme + a narrated real lecture;
  // wordtaste: math-heavy draft at the layout gate).
  "bansho",
  "wordtaste",
];

export function isModeWebPlayable(mode: string | undefined | null): boolean {
  return !!mode && WEB_PLAYER_SUPPORTED_MODES.includes(mode);
}

/**
 * Whether the PLAYER SHELL should mount the viewer for a fetched package.
 *
 * A package's `supported` stamp is frozen at export time, so a package
 * exported before its mode entered the whitelist says `false` forever — and
 * the player build that CAN render it must not bounce it to the local-client
 * fallback. The union reads: trust a positive stamp (a future exporter may
 * know modes this build does not — `loadMode` still arbitrates), and widen a
 * negative one when the live whitelist knows better.
 *
 * The exporter keeps stamping via `isModeWebPlayable` — this widening is
 * shell-side only.
 */
export function isPackagePlayable(
  mode: string | undefined | null,
  stampedSupported: boolean | undefined | null,
): boolean {
  return stampedSupported === true || isModeWebPlayable(mode);
}
