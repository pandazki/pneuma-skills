import { app, ipcMain, Notification, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { createModeWindow, revealModeWindow } from "./window-manager.js";
import { setBackgroundSessions, type BackgroundSessionView } from "./tray.js";

// ── Background Sessions ──────────────────────────────────────────────────────
// External-handoff sessions run inside a HIDDEN Electron window so the user can
// keep working elsewhere. This module owns their lifecycle: it spawns the hidden
// window, watches the renderer-relayed turn status, fires a system notification
// when a session finishes, and reveals the window on demand (notification click,
// tray menu, or any failure path). Once a session is revealed it becomes a
// normal window and is dropped from background tracking.

/** How long to wait for the first "running" status before assuming the
 *  background session is wedged and surfacing its window to the user. */
const WATCHDOG_MS = 60_000;

/** Max number of `loadURL` retries while the session server is still binding
 *  its port right after spawn. */
const MAX_LOAD_ATTEMPTS = 6;

/** Delay between `loadURL` retries. */
const LOAD_RETRY_MS = 800;

interface BackgroundSessionRecord {
  id: string;
  url: string;
  mode: string;
  intent?: string;
  window: BrowserWindow;
  webContentsId: number;
  status: "starting" | "running" | "done";
  /** True once the renderer has reported at least one "running" status. */
  sawRunning: boolean;
  /** Guards notifyDone so the completion notice fires exactly once. */
  notified: boolean;
  /** Fires if the session never reports "running" — see WATCHDOG_MS. */
  watchdog?: NodeJS.Timeout;
  /** Number of `loadURL` retries already spent on did-fail-load. */
  loadAttempts: number;
  /**
   * Whether to surface this window on the first `running → idle`. `true` for a
   * normal background handoff (the user's foreground IS this finished session,
   * so auto-reveal). `false` for a BORROW sub-session (design §6.2): the user's
   * foreground is the *host* session A; revealing the borrow would yank them
   * away from the very session that's still in charge. A borrow signals
   * completion through the host's `<pneuma:borrow-returned>` chat tag, not by
   * its own window appearing. A non-revealing session still fires the
   * completion Notification (a passive cue) and still reveals on a FAILURE path
   * (load failure / crash / watchdog) — stranding the user is worse than a
   * stray window.
   */
  reveal: boolean;
}

// Two indexes over the same records: `id` is the public handle (tray, reveal),
// `webContents.id` is how the shared IPC listener routes a status report back
// to its record.
const byId = new Map<string, BackgroundSessionRecord>();
const byWebContentsId = new Map<number, BackgroundSessionRecord>();

/**
 * Register the single shared IPC listener for renderer turn-status reports.
 * Call once at startup. Foreground windows and the launcher also send this
 * channel; reports that don't map to a tracked background record are ignored.
 */
export function initBackgroundSessions(): void {
  ipcMain.on(
    "pneuma:session-status",
    (event, status: "running" | "idle") => {
      const record = byWebContentsId.get(event.sender.id);
      // Not a background session (foreground window / launcher) — harmless.
      if (!record) return;
      handleStatus(record, status);
    },
  );
}

/**
 * Spawn a new background session: a hidden mode window plus the watchdog and
 * resilience listeners that keep a broken session from stranding the user.
 */
export function startBackgroundSession(opts: {
  url: string;
  mode: string;
  intent?: string;
  /**
   * Suppress the auto-reveal on completion (borrow sub-session — design §6.2).
   * Defaults to `true` (normal background handoff reveals when it finishes).
   */
  reveal?: boolean;
}): void {
  const { url, mode, intent } = opts;
  // Named distinctly from the module-level `reveal()` function it feeds — a
  // bare `reveal` const would shadow that function inside this scope.
  const shouldReveal = opts.reveal !== false;
  const id = randomUUID();
  const win = createModeWindow(url, { background: true });

  const record: BackgroundSessionRecord = {
    id,
    url,
    mode,
    intent,
    window: win,
    webContentsId: win.webContents.id,
    status: "starting",
    sawRunning: false,
    notified: false,
    loadAttempts: 0,
    reveal: shouldReveal,
  };
  byId.set(id, record);
  byWebContentsId.set(record.webContentsId, record);

  // The session server may still be binding its port immediately after spawn,
  // so a failed load is expected for the first few attempts — retry quietly.
  win.webContents.on("did-fail-load", (_e, errorCode) => {
    // -3 (ABORTED) fires on superseded loads; a finished session shouldn't
    // retry or be surfaced again.
    if (errorCode === -3) return;
    if (record.status === "done") return;

    if (record.loadAttempts < MAX_LOAD_ATTEMPTS) {
      record.loadAttempts += 1;
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(url);
      }, LOAD_RETRY_MS);
      return;
    }
    // Retries exhausted — a background session that can't load must never
    // strand the user; bring it to the foreground so they can react.
    reveal(record.id);
  });

  // A crashed renderer can't report status — surface the window.
  win.webContents.on("render-process-gone", () => {
    reveal(record.id);
  });

  win.on("closed", () => removeRecord(record));

  // If the session never reports "running", assume it's wedged and reveal it.
  record.watchdog = setTimeout(() => {
    if (!record.sawRunning && record.status !== "done") {
      reveal(record.id);
    }
  }, WATCHDOG_MS);

  renderTray();
}

/**
 * Public reveal entry — bring a tracked background session to the foreground
 * (e.g. from the tray menu).
 */
export function revealBackgroundSession(id: string): void {
  reveal(id);
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Handle a renderer-reported turn-status change for a tracked record. */
function handleStatus(
  record: BackgroundSessionRecord,
  status: "running" | "idle",
): void {
  // A finished session no longer changes state.
  if (record.status === "done") return;

  if (status === "running") {
    record.sawRunning = true;
    clearWatchdog(record);
    if (record.status !== "running") {
      record.status = "running";
      renderTray();
    }
    return;
  }

  // status === "idle"
  // An idle reported before the first turn is just the initial state, not a
  // completion — wait for real work before treating idle as "done".
  if (!record.sawRunning) return;

  record.status = "done";
  clearWatchdog(record);
  // Background mode auto-surfaces the result the instant the agent backend
  // goes idle — a passive tray glyph is too easy to forget. `reveal` shows
  // the window and drops the record (which also refreshes the tray).
  //
  // A BORROW sub-session (design §6.2) must NOT steal the foreground: the
  // user is working in the *host* session, and the borrow's result reaches
  // them as a `<pneuma:borrow-returned>` chat tag in the host — not by this
  // hidden window popping up. So we fire the completion Notification (a
  // passive cue) and quietly finalize the record WITHOUT pulling the app
  // forward. The host stays in front; the borrow window closes itself when
  // its child process exits.
  notifyDone(record);
  if (record.reveal) {
    reveal(record.id);
  } else {
    finalizeWithoutReveal(record);
  }
}

/**
 * Finalize a completed NON-revealing background session: drop it from tracking
 * (which refreshes the tray) without bringing the app forward. Used for borrow
 * sub-sessions so the host session keeps the foreground. The hidden window is
 * left to close on its own when the child process exits — closing it eagerly
 * here would race the renderer's own teardown.
 */
function finalizeWithoutReveal(record: BackgroundSessionRecord): void {
  removeRecord(record);
}

/**
 * Fire the one-time completion notification. The window itself auto-reveals
 * on completion — this is a secondary cue (Notification Center record, or a
 * hint if the window surfaced on another Space).
 */
function notifyDone(record: BackgroundSessionRecord): void {
  if (record.notified) return;
  record.notified = true;
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: `Pneuma — ${record.mode} session finished`,
    body: record.intent ? `"${truncate(record.intent, 80)}"` : "Your session is ready.",
  });
  // The window auto-reveals on completion; clicking the notification just
  // re-focuses it in case it landed behind another window or on another Space.
  notification.on("click", () => {
    if (process.platform === "darwin") void app.dock?.show();
    app.focus({ steal: true });
    if (!record.window.isDestroyed()) revealModeWindow(record.window);
  });
  notification.show();
}

/**
 * Bring a background session to the foreground and drop it from background
 * tracking — once revealed it is an ordinary window (window-manager still
 * tracks it for kill-on-close).
 */
function reveal(id: string): void {
  const record = byId.get(id);
  if (!record) return;

  // Pull the app out of the background so the revealed window is actually seen.
  if (process.platform === "darwin") void app.dock?.show();
  app.focus({ steal: true });

  if (!record.window.isDestroyed()) revealModeWindow(record.window);
  removeRecord(record);
}

/** Clear the watchdog timer (if any) and forget it. */
function clearWatchdog(record: BackgroundSessionRecord): void {
  if (record.watchdog) {
    clearTimeout(record.watchdog);
    record.watchdog = undefined;
  }
}

/** Remove a record from both indexes and refresh the tray. */
function removeRecord(record: BackgroundSessionRecord): void {
  clearWatchdog(record);
  byId.delete(record.id);
  byWebContentsId.delete(record.webContentsId);
  renderTray();
}

/** Push the current set of live background sessions onto the tray. */
function renderTray(): void {
  const view: BackgroundSessionView[] = Array.from(byId.values()).map(
    (record) => ({
      id: record.id,
      label: record.intent
        ? `${record.mode} · ${truncate(record.intent, 40)}`
        : record.mode,
      status: record.status === "done" ? "done" : "running",
    }),
  );
  setBackgroundSessions(view);
}

/** Truncate `s` to at most `n` characters, appending an ellipsis when cut. */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
