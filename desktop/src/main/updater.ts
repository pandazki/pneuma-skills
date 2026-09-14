/**
 * Auto-update: silent background download, announced only when it has landed.
 *
 * The app checks on a timer (and after waking from sleep), downloads without
 * asking, and stays quiet until the installer is on disk. Then it raises three
 * signals — a dock badge (a window overlay icon on Windows), a "↑" in the tray
 * with a `Restart to Update…` item, and one native notification — and every one
 * of them restarts the app into the new version.
 *
 * The explicit "Check for Updates…" command still talks in dialogs: the user
 * asked, so they get an answer.
 *
 * State transitions and the schedule gate live in `./update-state.js` (pure,
 * unit-tested); everything with a side effect lives here.
 */
import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { getLauncherWindow } from "./window-manager.js";
import { setUpdateReady } from "./tray.js";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RESUME_MIN_GAP_MS,
  onAvailable,
  onChecking,
  onDownloaded,
  onError,
  onNotAvailable,
  onProgress,
  shouldCheck,
  type UpdateState,
} from "./update-state.js";

/**
 * GitHub raw URL for the project CHANGELOG. Used to surface release
 * highlights in the auto-updater dialogs so users see *what* changed
 * before deciding to restart — not just a version-number bump.
 */
const CHANGELOG_RAW_URL =
  "https://raw.githubusercontent.com/pandazki/pneuma-skills/main/CHANGELOG.md";
const CHANGELOG_WEB_URL =
  "https://github.com/pandazki/pneuma-skills/blob/main/CHANGELOG.md";

/** Percentages worth one log line each — a silent download still leaves a trail. */
const PROGRESS_MILESTONES = [0, 25, 50, 75, 100];

let state: UpdateState = { kind: "idle" };
let lastCheckAt: number | null = null;
/** True while an explicitly requested check is in flight (dialogs allowed). */
let manualCheck = false;
/** False while a check is in flight; guards against double terminal events. */
let checkSettled = true;
/** Version already announced by a notification — at most one per version. */
let notifiedVersion: string | null = null;
const loggedMilestones = new Set<number>();

export function getUpdateState(): UpdateState {
  return state;
}

// ── Setup ────────────────────────────────────────────────────────────────────

export function initAutoUpdater(): void {
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // e2e hook: a dev build normally refuses to update. With PNEUMA_DEV_UPDATE=1
  // electron-updater reads `desktop/dev-app-update.yml` and treats the running
  // package.json version as the installed one, so the whole schedule can be
  // exercised against real GitHub releases without packaging the app.
  if (!app.isPackaged && process.env.PNEUMA_DEV_UPDATE === "1") {
    autoUpdater.forceDevUpdateConfig = true;
    console.log(
      `[auto-updater] dev update config forced (v${app.getVersion()}, userData: ${app.getPath("userData")})`,
    );
  }

  wireEvents();

  // Windows has no dock badge; a window created while an update is waiting
  // gets the overlay icon too.
  app.on("browser-window-created", (_event, win) => {
    if (state.kind === "ready") applyOverlayIcon(win);
  });

  void app.whenReady().then(() => {
    setTimeout(() => scheduledCheck(0), FIRST_CHECK_DELAY_MS);
    const timer = setInterval(() => scheduledCheck(0), CHECK_INTERVAL_MS);
    // Never hold the process alive just for the update timer.
    timer.unref?.();
  });

  powerMonitor.on("resume", () => scheduledCheck(RESUME_MIN_GAP_MS));
}

function wireEvents(): void {
  autoUpdater.on("update-available", (info) => {
    const manual = settleCheck() && manualCheck;
    manualCheck = false;
    state = onAvailable(state, info.version);
    loggedMilestones.clear();
    console.log(
      `[auto-updater] v${info.version} available — downloading in the background`,
    );
    if (manual) void showManualAvailableDialog(info.version);
  });

  autoUpdater.on("update-not-available", () => {
    const manual = settleCheck() && manualCheck;
    manualCheck = false;
    state = onNotAvailable(state);
    if (manual) {
      void showUpdateDialog({
        type: "info",
        title: "No Updates",
        message: "You're up to date!",
        detail: `Current version: v${app.getVersion()}`,
        buttons: ["OK"],
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    state = onProgress(state, progress.percent);
    if (state.kind !== "downloading") return;
    for (const milestone of PROGRESS_MILESTONES) {
      if (state.percent >= milestone && !loggedMilestones.has(milestone)) {
        loggedMilestones.add(milestone);
        console.log(
          `[auto-updater] downloading v${state.version}: ${milestone}%`,
        );
      }
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    settleCheck();
    manualCheck = false;
    state = onDownloaded(state, info.version);
    announceReady(info.version);
  });

  autoUpdater.on("error", (err) => handleUpdateError(err));
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/**
 * A check nobody asked for. Refused while a download runs, while an update is
 * already waiting, and within `minGap` of the previous check. The platform
 * asset gate still applies: CI uploads one platform at a time, so a fresh tag
 * can exist minutes before this platform's metadata does.
 */
function scheduledCheck(minGap: number): void {
  if (!shouldCheck(state, lastCheckAt, Date.now(), minGap)) return;
  void isPlatformAssetReady().then((ready) => {
    if (!ready) {
      console.log("[auto-updater] scheduled check skipped — platform asset not published yet");
      return;
    }
    runCheck("scheduled");
  });
}

function runCheck(reason: "scheduled" | "manual"): void {
  state = onChecking(state);
  lastCheckAt = Date.now();
  checkSettled = false;
  console.log(`[auto-updater] checking for updates (${reason})`);
  autoUpdater.checkForUpdates().catch((err) => {
    // electron-updater emits "error" for most failures and that handler has
    // already settled the check; only a rejection it did not report lands here.
    if (!checkSettled) handleUpdateError(err);
  });
}

/** True for the first terminal event of the check that is in flight. */
function settleCheck(): boolean {
  if (checkSettled) return false;
  checkSettled = true;
  return true;
}

function handleUpdateError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const manual = settleCheck() && manualCheck;
  manualCheck = false;
  // `ready` means the installer is already on disk, so the failure came from
  // the install/staging step (Squirrel), not from a check.
  const phase =
    state.kind === "downloading" ? "download" : state.kind === "ready" ? "install" : "check";
  state = onError(state, message, Date.now());
  console.error(`[auto-updater] ${phase} failed: ${message}`);
  if (manual) {
    void showUpdateDialog({
      type: "error",
      title: "Update Error",
      message: "Failed to check for updates",
      detail: message,
      buttons: ["OK"],
    });
  }
}

// ── Ready signals ────────────────────────────────────────────────────────────

/**
 * The download has landed. Three signals, all of which mean the same thing:
 * click to restart into the new version.
 */
function announceReady(version: string): void {
  const badge = setReadyBadge(true);
  setUpdateReady({ version });
  const notified = showReadyNotification(version);
  console.log(
    `[auto-updater] ready: ${badge}, tray set, notification ${notified}`,
  );
}

/**
 * Dock badge (macOS / Linux Unity) or a window overlay icon (Windows).
 * Returns what happened, for the single ready log line.
 */
function setReadyBadge(on: boolean): string {
  if (process.platform === "win32") {
    for (const win of BrowserWindow.getAllWindows()) {
      if (on) applyOverlayIcon(win);
      else if (!win.isDestroyed()) win.setOverlayIcon(null, "");
    }
    return on ? "overlay icon set" : "overlay icon cleared";
  }
  app.setBadgeCount(on ? 1 : 0);
  return on ? "badge set" : "badge cleared";
}

function applyOverlayIcon(win: BrowserWindow): void {
  if (process.platform !== "win32" || win.isDestroyed()) return;
  win.setOverlayIcon(updateDotIcon(), "Update ready");
}

/** One native notification per version per process. */
function showReadyNotification(version: string): string {
  if (notifiedVersion === version) return "skipped (already shown)";
  if (!Notification.isSupported()) return "skipped (unsupported)";
  notifiedVersion = version;
  const notification = new Notification({
    title: `Pneuma Skills v${version} is ready`,
    body: "Click to restart and update.",
  });
  notification.on("click", () => restartToInstall());
  notification.show();
  return "shown";
}

/**
 * 16×16 orange (#f97316) dot for the Windows taskbar overlay — the same
 * fallback-icon trick tray.ts uses. Raw bitmap buffers are BGRA, so the
 * channels are written blue-green-red-alpha.
 */
let dotIcon: Electron.NativeImage | null = null;
function updateDotIcon(): Electron.NativeImage {
  if (dotIcon) return dotIcon;
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
      if (dist > r) continue;
      const alpha = dist < r - 1 ? 255 : Math.max(0, Math.round(255 * (r - dist)));
      buf[idx] = 22; // B
      buf[idx + 1] = 115; // G
      buf[idx + 2] = 249; // R
      buf[idx + 3] = alpha;
    }
  }
  dotIcon = nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1 });
  return dotIcon;
}

/**
 * Restart into the downloaded update. Wired to the tray item, the
 * notification click and the manual dialog's "Restart Now".
 */
export function restartToInstall(): void {
  if (state.kind !== "ready") {
    console.log(`[auto-updater] restart requested with no update ready (state: ${state.kind})`);
    return;
  }
  console.log(`[auto-updater] restarting to install v${state.version}`);
  setReadyBadge(false);
  autoUpdater.quitAndInstall(false, true);
}

// ── Manual check ─────────────────────────────────────────────────────────────

/**
 * The "Check for Updates…" command (app menu and tray). The user asked, so
 * every outcome gets a dialog — including the one where the update is already
 * downloaded and only needs a restart.
 */
export function checkForUpdatesManual(): void {
  if (state.kind === "ready") {
    void showReadyDialog(state.version);
    return;
  }
  if (state.kind === "downloading") {
    const { version, percent } = state;
    void showUpdateDialog({
      type: "info",
      title: "Downloading Update",
      message: `Downloading v${version} (${percent}%)…`,
      detail:
        "You'll see a badge on the app icon and a ↑ in the tray when it is ready to install.",
      buttons: ["OK"],
    });
    return;
  }

  manualCheck = true;
  void isPlatformAssetReady().then((ready) => {
    if (!ready) {
      manualCheck = false;
      void showUpdateDialog({
        type: "info",
        title: "No Updates",
        message: "You're up to date!",
        detail: `Current version: v${app.getVersion()}\n\n(A new release may be building — check back in a few minutes.)`,
        buttons: ["OK"],
      });
      return;
    }
    runCheck("manual");
  });
}

async function showReadyDialog(version: string): Promise<void> {
  const headlines = await fetchChangelogHeadlines(app.getVersion(), version);
  const highlightsBlock = formatHighlightsBlock(headlines);
  const buttons = headlines.length
    ? ["Restart Now", "View Changelog", "Later"]
    : ["Restart Now", "Later"];
  const { response } = await showUpdateDialog({
    type: "info",
    title: "Update Ready",
    message: `v${version} has been downloaded`,
    detail: `The update will be installed when you restart the app.${highlightsBlock}`,
    buttons,
    defaultId: 0,
    cancelId: headlines.length ? 2 : 1,
  });
  if (response === 0) restartToInstall();
  else if (headlines.length && response === 1) void shell.openExternal(CHANGELOG_WEB_URL);
}

async function showManualAvailableDialog(version: string): Promise<void> {
  const currentVersion = app.getVersion();
  const headlines = await fetchChangelogHeadlines(currentVersion, version);
  const highlightsBlock = formatHighlightsBlock(headlines);
  const buttons = headlines.length ? ["OK", "View Changelog"] : ["OK"];
  const { response } = await showUpdateDialog({
    type: "info",
    title: "Update Available",
    message: `v${version} found — downloading in the background`,
    detail: `Current version: v${currentVersion}${highlightsBlock}\n\nYou'll see a badge on the app icon and a ↑ in the tray when it is ready to install.`,
    buttons,
    defaultId: 0,
    cancelId: 0,
  });
  if (headlines.length && response === 1) void shell.openExternal(CHANGELOG_WEB_URL);
}

/**
 * Show a dialog attached to a visible window to avoid macOS app-modal freeze.
 * On macOS, dialog.showMessageBox() without a parent window creates an
 * app-modal dialog that freezes the entire process when no window is focused.
 * As a last resort we create a tiny off-screen window as the dialog parent.
 */
function showUpdateDialog(
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  const launcher = getLauncherWindow();
  if (launcher && !launcher.isDestroyed()) {
    if (!launcher.isVisible()) launcher.show();
    return dialog.showMessageBox(launcher, options);
  }
  // Fallback: find any visible window
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
  if (win) return dialog.showMessageBox(win, options);

  // Last resort: create a temporary hidden window as dialog parent to prevent
  // macOS app-modal freeze when no windows exist
  const tmp = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true });
  return dialog.showMessageBox(tmp, options).finally(() => {
    if (!tmp.isDestroyed()) tmp.destroy();
  });
}

// ── Release metadata ─────────────────────────────────────────────────────────

/**
 * Check if the platform-specific update metadata file exists on the latest release.
 * CI builds each platform artifact separately, so the release tag may exist
 * before the current platform's asset is uploaded (10+ min window).
 * Returns true if the asset is reachable, false otherwise.
 */
async function isPlatformAssetReady(): Promise<boolean> {
  const metaFile =
    process.platform === "darwin"
      ? "latest-mac.yml"
      : process.platform === "win32"
        ? "latest.yml"
        : "latest-linux.yml";
  const url = `https://github.com/pandazki/pneuma-skills/releases/latest/download/${metaFile}`;
  try {
    const resp = await net.fetch(url, { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

function semverCmp(a: string, b: string): number {
  const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Pull the bullet headlines (the **bolded** prefix of each `- **X** —`
 * line) from CHANGELOG.md sections strictly greater than `fromVer` and
 * up to and including `toVer`. Returns an empty array on any error so
 * the dialog falls back to the version-only message.
 */
async function fetchChangelogHeadlines(fromVer: string, toVer: string): Promise<string[]> {
  try {
    const res = await fetch(CHANGELOG_RAW_URL);
    if (!res.ok) return [];
    const text = await res.text();
    const headlines: string[] = [];
    let inRange = false;
    for (const line of text.split("\n")) {
      const versionMatch = line.match(/^##\s*\[(\d+\.\d+\.\d+)\]/);
      if (versionMatch) {
        const v = versionMatch[1];
        inRange = semverCmp(v, fromVer) > 0 && semverCmp(v, toVer) <= 0;
        continue;
      }
      if (!inRange) continue;
      const bulletMatch = line.match(/^-\s*\*\*(.+?)\*\*/);
      if (bulletMatch) headlines.push(bulletMatch[1].trim());
    }
    return headlines;
  } catch {
    return [];
  }
}

function formatHighlightsBlock(headlines: string[], max = 6): string {
  if (headlines.length === 0) return "";
  const shown = headlines.slice(0, max);
  const rest = headlines.length - shown.length;
  let out = "\n\nWhat's new:\n" + shown.map((h) => `  • ${h}`).join("\n");
  if (rest > 0) out += `\n  • …and ${rest} more`;
  return out;
}
