import type LauncherComponent from "./components/Launcher.js";

let preloaded: typeof LauncherComponent | null = null;

/**
 * Load the launcher's code before the first render of a launcher URL. The page
 * already shows the launcher skeleton (index.html), and rendering the loaded
 * component directly lets React commit the launcher at once: a Suspense
 * fallback, once shown, is held for React's minimum reveal time (~300 ms),
 * which also held back the launcher's data requests. A failed load falls back
 * to the lazy path and its error handling.
 */
export function preloadLauncher(): Promise<void> {
  return import("./components/Launcher.js").then((module) => { preloaded = module.default; }, () => {});
}

export function preloadedLauncher(): typeof LauncherComponent | null {
  return preloaded;
}
