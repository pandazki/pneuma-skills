import { app, nativeTheme } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type LauncherTheme = "light" | "dark";

/** `--color-cc-bg` for each theme (src/index.css), so the window never paints another colour first. */
export const LAUNCHER_BACKGROUND: Record<LauncherTheme, string> = { dark: "#09090b", light: "#fbf6f1" };

/**
 * The user's launcher theme, read from where the launcher service keeps it
 * (`~/.pneuma/settings.json`, core/user-theme.ts) so the window can open in it
 * before that service runs. The desktop build's rootDir keeps it from
 * importing core; the file format is the shared contract.
 */
export function resolveLauncherTheme(): LauncherTheme {
  let preference: unknown;
  try {
    const home = process.env.PNEUMA_HOME || path.join(homedir(), ".pneuma");
    preference = (JSON.parse(readFileSync(path.join(home, "settings.json"), "utf-8")) as { theme?: unknown }).theme;
  } catch { /* no settings yet: follow the system */ }
  if (preference === "light" || preference === "dark") return preference;
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

/**
 * The launcher skeleton page the frontend build emits (snapshot/launcher-skeleton.ts),
 * or null when this checkout has no production build (desktop development).
 */
export function launcherSkeletonPage(): string | null {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "pneuma", "dist", "launcher-skeleton.html")
    : path.join(__dirname, "..", "..", "..", "dist", "launcher-skeleton.html");
  return existsSync(file) ? file : null;
}
