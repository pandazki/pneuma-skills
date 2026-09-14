/**
 * Pure-logic pin for the desktop auto-updater.
 *
 * `update-state.ts` deliberately imports no electron so the schedule gate,
 * the state table and the tray composition can be tested with plain
 * `bun test`. Everything that needs electron lives in `updater.ts`.
 */
import { describe, expect, test } from "bun:test";
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
  trayIndicator,
  type UpdateState,
} from "../src/main/update-state.js";

const IDLE: UpdateState = { kind: "idle" };
const CHECKING: UpdateState = { kind: "checking" };
const DOWNLOADING: UpdateState = { kind: "downloading", version: "3.48.0", percent: 42 };
const READY: UpdateState = { kind: "ready", version: "3.48.0" };
const ERROR: UpdateState = { kind: "error", message: "net down", at: 1_000 };

const NOW = 1_700_000_000_000;

describe("constants", () => {
  test("schedule constants match the documented strategy", () => {
    expect(CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
    expect(FIRST_CHECK_DELAY_MS).toBe(15_000);
    expect(RESUME_MIN_GAP_MS).toBe(10 * 60 * 1000);
  });
});

describe("shouldCheck", () => {
  test("refuses while a download is running", () => {
    expect(shouldCheck(DOWNLOADING, null, NOW, 0)).toBe(false);
    expect(shouldCheck({ kind: "downloading", version: "3.48.0", percent: 0 }, null, NOW, 0)).toBe(
      false,
    );
  });

  test("refuses while an update is already waiting to install", () => {
    expect(shouldCheck(READY, null, NOW, 0)).toBe(false);
    expect(shouldCheck(READY, NOW - CHECK_INTERVAL_MS, NOW, 0)).toBe(false);
  });

  test("allows a first check from idle, error and checking", () => {
    expect(shouldCheck(IDLE, null, NOW, 0)).toBe(true);
    expect(shouldCheck(ERROR, null, NOW, 0)).toBe(true);
    // `checking` is transient: a hung check must not disable the 4h interval
    // forever, so the gate does not refuse on it.
    expect(shouldCheck(CHECKING, null, NOW, 0)).toBe(true);
  });

  test("honours minGap against the previous check", () => {
    expect(shouldCheck(IDLE, NOW - 5 * 60 * 1000, NOW, RESUME_MIN_GAP_MS)).toBe(false);
    expect(shouldCheck(IDLE, NOW - RESUME_MIN_GAP_MS, NOW, RESUME_MIN_GAP_MS)).toBe(true);
    expect(shouldCheck(IDLE, NOW - RESUME_MIN_GAP_MS - 1, NOW, RESUME_MIN_GAP_MS)).toBe(true);
    expect(shouldCheck(ERROR, NOW - 1, NOW, RESUME_MIN_GAP_MS)).toBe(false);
  });

  test("a zero gap (the interval timer) ignores the last check time", () => {
    expect(shouldCheck(IDLE, NOW, NOW, 0)).toBe(true);
    expect(shouldCheck(IDLE, NOW - 1, NOW, 0)).toBe(true);
  });

  test("a clock that jumped backwards does not permanently block checks", () => {
    // now < lastCheckAt after a system clock change: treat as "just checked"
    // rather than as an enormous positive gap.
    expect(shouldCheck(IDLE, NOW + 60_000, NOW, RESUME_MIN_GAP_MS)).toBe(false);
  });
});

describe("transitions", () => {
  test("onChecking moves idle and error to checking", () => {
    expect(onChecking(IDLE)).toEqual({ kind: "checking" });
    expect(onChecking(ERROR)).toEqual({ kind: "checking" });
    expect(onChecking(CHECKING)).toEqual({ kind: "checking" });
  });

  test("onChecking never hides a downloaded or downloading update", () => {
    expect(onChecking(READY)).toEqual(READY);
    expect(onChecking(DOWNLOADING)).toEqual(DOWNLOADING);
  });

  test("onAvailable starts a download at 0%", () => {
    expect(onAvailable(CHECKING, "3.49.0")).toEqual({
      kind: "downloading",
      version: "3.49.0",
      percent: 0,
    });
    expect(onAvailable(IDLE, "3.49.0")).toEqual({
      kind: "downloading",
      version: "3.49.0",
      percent: 0,
    });
  });

  test("onAvailable for the version already downloaded stays ready", () => {
    expect(onAvailable(READY, "3.48.0")).toEqual(READY);
  });

  test("onAvailable for a newer version supersedes the downloaded one", () => {
    expect(onAvailable(READY, "3.49.0")).toEqual({
      kind: "downloading",
      version: "3.49.0",
      percent: 0,
    });
  });

  test("onProgress updates the percent while downloading", () => {
    expect(onProgress(DOWNLOADING, 77.4)).toEqual({
      kind: "downloading",
      version: "3.48.0",
      percent: 77,
    });
  });

  test("onProgress clamps to 0..100 and ignores non-downloading states", () => {
    expect(onProgress(DOWNLOADING, -5)).toEqual({
      kind: "downloading",
      version: "3.48.0",
      percent: 0,
    });
    expect(onProgress(DOWNLOADING, 140)).toEqual({
      kind: "downloading",
      version: "3.48.0",
      percent: 100,
    });
    expect(onProgress(DOWNLOADING, Number.NaN)).toEqual(DOWNLOADING);
    expect(onProgress(IDLE, 50)).toEqual(IDLE);
    expect(onProgress(READY, 50)).toEqual(READY);
  });

  test("onDownloaded always lands on ready for that version", () => {
    expect(onDownloaded(DOWNLOADING, "3.48.0")).toEqual({ kind: "ready", version: "3.48.0" });
    expect(onDownloaded(IDLE, "3.48.0")).toEqual({ kind: "ready", version: "3.48.0" });
  });

  test("onNotAvailable returns to idle but keeps ready and downloading", () => {
    expect(onNotAvailable(CHECKING)).toEqual({ kind: "idle" });
    expect(onNotAvailable(ERROR)).toEqual({ kind: "idle" });
    expect(onNotAvailable(IDLE)).toEqual({ kind: "idle" });
    expect(onNotAvailable(READY)).toEqual(READY);
    expect(onNotAvailable(DOWNLOADING)).toEqual(DOWNLOADING);
  });

  test("onError records the message and the time", () => {
    expect(onError(CHECKING, "boom", NOW)).toEqual({ kind: "error", message: "boom", at: NOW });
    expect(onError(IDLE, "boom", NOW)).toEqual({ kind: "error", message: "boom", at: NOW });
  });

  test("onError from downloading releases the gate so a later check can retry", () => {
    expect(onError(DOWNLOADING, "socket hang up", NOW)).toEqual({
      kind: "error",
      message: "socket hang up",
      at: NOW,
    });
    expect(shouldCheck(onError(DOWNLOADING, "socket hang up", NOW), null, NOW, 0)).toBe(true);
  });

  test("onError from ready stays ready — a failed re-check must not hide a downloaded update", () => {
    expect(onError(READY, "boom", NOW)).toEqual(READY);
  });
});

describe("trayIndicator", () => {
  test("a working session outranks everything", () => {
    expect(trayIndicator({ running: 1, done: 2, update: { version: "3.48.0" } })).toEqual({
      title: "",
      tooltip: "Pneuma Skills — 1 session working…",
    });
    expect(trayIndicator({ running: 3, done: 0, update: null })).toEqual({
      title: "",
      tooltip: "Pneuma Skills — 3 sessions working…",
    });
  });

  test("a ready update outranks finished sessions", () => {
    expect(trayIndicator({ running: 0, done: 2, update: { version: "3.48.0" } })).toEqual({
      title: "↑",
      tooltip: "Pneuma Skills — v3.48.0 downloaded, click to restart and update",
    });
  });

  test("finished sessions show the check mark", () => {
    expect(trayIndicator({ running: 0, done: 1, update: null })).toEqual({
      title: "✓",
      tooltip: "Pneuma Skills — 1 session ready to view",
    });
    expect(trayIndicator({ running: 0, done: 4, update: null })).toEqual({
      title: "✓",
      tooltip: "Pneuma Skills — 4 sessions ready to view",
    });
  });

  test("nothing to report clears the title", () => {
    expect(trayIndicator({ running: 0, done: 0, update: null })).toEqual({
      title: "",
      tooltip: "Pneuma Skills",
    });
  });
});
