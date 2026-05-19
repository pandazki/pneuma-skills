/**
 * Per-backend user preferences — currently just an enable/disable flag,
 * but the `BackendPref` shape leaves room for future per-backend knobs
 * (default model, opt-in features) without breaking the file schema.
 *
 * Stored as a top-level `backends` key in `~/.pneuma/settings.json` so it
 * lives next to existing preferences (`locale`, `plugins`, …) and follows
 * the same merge-don't-clobber convention.
 *
 * Disable semantics:
 *   - "disabled" = user explicitly hid this backend from session-creation
 *     pickers, **even when it's installed and ready**. The launcher
 *     settings UI still surfaces disabled backends so the user can re-
 *     enable them or manage their slash command.
 *   - Default is `enabled` (i.e. `disabled` absent or false). Adding a
 *     new backend (e.g. Kimi) doesn't require a migration — until the
 *     user toggles it off, it just shows up.
 *
 * Concurrency: same atomic-write pattern as `agent-command-installer.ts`.
 * Bun caches `os.homedir()` at process start, so `getHome()` consults
 * `process.env.HOME` first for testability.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

export interface BackendPref {
  /** When true, the backend is hidden from session-creation pickers. */
  disabled?: boolean;
}

export type BackendPrefs = Record<string, BackendPref>;

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function settingsPath(): string {
  return join(getHome(), ".pneuma", "settings.json");
}

function readRawSettings(): Record<string, unknown> {
  const path = settingsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeRawSettings(next: Record<string, unknown>): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function getBackendPrefs(): BackendPrefs {
  const raw = readRawSettings();
  const v = raw.backends;
  return typeof v === "object" && v !== null ? (v as BackendPrefs) : {};
}

export function isBackendDisabled(backendType: string): boolean {
  return getBackendPrefs()[backendType]?.disabled === true;
}

export function setBackendDisabled(backendType: string, disabled: boolean): BackendPrefs {
  const settings = readRawSettings();
  const current = typeof settings.backends === "object" && settings.backends !== null
    ? (settings.backends as BackendPrefs)
    : {};
  const next: BackendPrefs = {
    ...current,
    [backendType]: { ...(current[backendType] ?? {}), disabled },
  };
  writeRawSettings({ ...settings, backends: next });
  return next;
}
