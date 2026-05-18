/**
 * User theme preference — persists alongside locale in ~/.pneuma/settings.json
 * so mode/session servers (which run as separate processes from the launcher)
 * can read the user's choice and propagate it to viewers for default content
 * set selection. Mirrors core/locale.ts's storage shape.
 *
 * `system` defers to the platform's `prefers-color-scheme`; explicit `light`
 * or `dark` overrides it. The matcher only needs a concrete light/dark value
 * — `resolveTheme()` resolves `system` into one by consulting the platform.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SUPPORTED_THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof SUPPORTED_THEMES)[number];
export type ResolvedTheme = "light" | "dark";

export function normalizeTheme(raw: string | undefined | null): ThemePreference | null {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (v === "system" || v === "light" || v === "dark") return v;
  return null;
}

function pneumaHome(): string {
  return process.env.PNEUMA_HOME || join(homedir(), ".pneuma");
}

function settingsPath(): string {
  return join(pneumaHome(), "settings.json");
}

interface SettingsFile {
  theme?: string;
  [key: string]: unknown;
}

function readSettingsRaw(): SettingsFile {
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return {};
  }
}

export function getUserTheme(): ThemePreference | null {
  const settings = readSettingsRaw();
  return normalizeTheme(settings.theme as string | undefined);
}

export function setUserTheme(theme: ThemePreference | null): void {
  const dir = pneumaHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const settings = readSettingsRaw();
  if (theme === null) {
    delete settings.theme;
  } else {
    settings.theme = theme;
  }
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
