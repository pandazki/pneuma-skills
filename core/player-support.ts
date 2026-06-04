/**
 * Modes the hosted static player can render read-only. Shared by:
 *  - the play-package materializer (`server/play-export.ts`) to set
 *    `PlayPackageIndex.supported`, and
 *  - the player shell to decide whether to mount the viewer or show the
 *    "open in local client" fallback.
 *
 * Grows as per-mode support lands. v1 ships the "regular" tier; diagram /
 * remotion / cosmos arrive in follow-up PRs (each needs host config or a
 * vendored dependency). clipcraft, mode-maker, gridboard and any custom mode
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
];

export function isModeWebPlayable(mode: string | undefined | null): boolean {
  return !!mode && WEB_PLAYER_SUPPORTED_MODES.includes(mode);
}
