/**
 * Auto-updater state machine — pure, no electron imports.
 *
 * The desktop app updates itself silently: a check runs on a timer, the
 * download happens in the background, and only a finished download is
 * announced (dock badge / tray / notification). That policy is three small
 * decisions — may a scheduled check run, what does an event do to the state,
 * and what should the tray show — and all three are here so they can be
 * pinned by `bun test` without an electron runtime. `updater.ts` owns every
 * side effect (electron-updater, badges, tray, notifications, dialogs).
 */

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string; at: number };

/** Silent re-check cadence. Long enough to be invisible, short enough that a
 *  release published while the app is running is picked up the same day. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 h
/** Delay before the first check so the launcher process has settled. */
export const FIRST_CHECK_DELAY_MS = 15_000;
/** After waking from sleep, skip the check when one ran less than this ago. */
export const RESUME_MIN_GAP_MS = 10 * 60 * 1000;

/**
 * Whether a scheduled (silent) check should run now.
 *
 * Never while a download is running or an update is already waiting to be
 * installed, and never sooner than `minGap` after the previous check (the
 * resume hook passes {@link RESUME_MIN_GAP_MS}, the interval timer passes 0).
 *
 * `checking` is deliberately *not* a refusal: it is a transient state, and a
 * check that never resolves must not disable the interval forever.
 */
export function shouldCheck(
  state: UpdateState,
  lastCheckAt: number | null,
  now: number,
  minGap: number,
): boolean {
  if (state.kind === "downloading" || state.kind === "ready") return false;
  if (lastCheckAt === null) return true;
  // A backwards clock jump reads as "just checked" rather than as a huge gap.
  if (now < lastCheckAt) return false;
  return now - lastCheckAt >= minGap;
}

// ── Transition table ─────────────────────────────────────────────────────────
// Every helper is total: it takes the current state plus the event payload and
// returns the next state. The invariant across all of them is that a *finished*
// download is never silently lost — only a newer version or an actual install
// may replace `ready`.

/** A check is starting. */
export function onChecking(state: UpdateState): UpdateState {
  if (state.kind === "ready" || state.kind === "downloading") return state;
  return { kind: "checking" };
}

/** `update-available` — with `autoDownload` the download has already begun. */
export function onAvailable(state: UpdateState, version: string): UpdateState {
  // Re-discovering the version we already hold on disk changes nothing.
  if (state.kind === "ready" && state.version === version) return state;
  return { kind: "downloading", version, percent: 0 };
}

/** `download-progress`. Percent is clamped and rounded once, here. */
export function onProgress(state: UpdateState, percent: number): UpdateState {
  if (state.kind !== "downloading") return state;
  if (!Number.isFinite(percent)) return state;
  const clamped = Math.round(Math.min(100, Math.max(0, percent)));
  if (clamped === state.percent) return state;
  return { kind: "downloading", version: state.version, percent: clamped };
}

/** `update-downloaded` — the installer is on disk and waiting for a restart. */
export function onDownloaded(_state: UpdateState, version: string): UpdateState {
  return { kind: "ready", version };
}

/** `update-not-available`. */
export function onNotAvailable(state: UpdateState): UpdateState {
  if (state.kind === "ready" || state.kind === "downloading") return state;
  return { kind: "idle" };
}

/**
 * `error`. A failed re-check must not hide an update that is already
 * downloaded, so `ready` is preserved. A failure *during* a download does
 * become an error: leaving the state on `downloading` would make
 * {@link shouldCheck} refuse every future check.
 */
export function onError(state: UpdateState, message: string, now: number): UpdateState {
  if (state.kind === "ready") return state;
  return { kind: "error", message, at: now };
}

// ── Tray composition ─────────────────────────────────────────────────────────

/**
 * What the tray should show, composed with background-session activity.
 * A working spinner wins (the user is waiting on that), then a ready update,
 * then finished sessions. The spinner frames live in `tray.ts`; a `running`
 * result returns an empty title and lets that animation own it.
 */
export function trayIndicator(input: {
  running: number;
  done: number;
  update: { version: string } | null;
}): { title: string; tooltip: string } {
  const { running, done, update } = input;
  if (running > 0) {
    return {
      title: "",
      tooltip: `Pneuma Skills — ${running} session${running > 1 ? "s" : ""} working…`,
    };
  }
  if (update) {
    return {
      title: "↑",
      tooltip: `Pneuma Skills — v${update.version} downloaded, click to restart and update`,
    };
  }
  if (done > 0) {
    return {
      title: "✓",
      tooltip: `Pneuma Skills — ${done} session${done > 1 ? "s" : ""} ready to view`,
    };
  }
  return { title: "", tooltip: "Pneuma Skills" };
}
