/**
 * Build-time projections of the launcher skeleton (src/components/LauncherSkeleton.tsx).
 *
 * - `index.html` carries the skeleton as a template plus a boot script that
 *   shows it on launcher URLs before any bundle loads, with the user's theme
 *   already applied, so the page's first paint is the launcher's shape.
 * - `dist/launcher-skeleton.html` is a self-contained page the desktop app
 *   shows while its launcher service starts (it cannot reach the service yet).
 *
 * React's first commit clears the static copy and renders the same component,
 * so the handoff from either copy is invisible.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LAUNCHER_SKELETON_PERIOD_MS, LauncherPageSkeleton } from "../src/components/LauncherSkeleton.js";

export const LAUNCHER_SKELETON_TEMPLATE_ID = "pneuma-launcher-skeleton";
/** File name of the desktop's pre-start page inside `dist/`. */
export const LAUNCHER_SKELETON_PAGE = "launcher-skeleton.html";
/** The logo font is visible in the skeleton's first frame; fetch it with the stylesheet. */
const WORDMARK_FONT = "/fonts/fraunces/v38-normal-latin.woff2";

export function launcherSkeletonMarkup(logoSrc = "/logo.png"): string {
  // React 19 prepends resource hints (an image preload for the logo); the
  // static copies carry only the page element itself.
  return renderToStaticMarkup(createElement(LauncherPageSkeleton, { logoSrc })).replace(/^(?:<link [^>]*>)+/, "");
}

/**
 * Runs during parsing, after `#root`. It repeats `readEntryParams().opensLauncher`
 * (src/launcher-route.ts) and `resolveInitialTheme()` (src/hooks/useAppTheme.ts):
 * this code runs before any bundle exists, so it cannot import them.
 */
export const LAUNCHER_SKELETON_BOOT_SCRIPT = `(function () {
  var root = document.getElementById("root");
  var template = document.getElementById(${JSON.stringify(LAUNCHER_SKELETON_TEMPLATE_ID)});
  if (!root || !template || root.firstElementChild) return;
  var params = new URLSearchParams(location.search);
  var session = params.has("session"), mode = params.has("mode");
  if (!params.has("launcher") && (session || mode)) return;
  if (params.has("project") && params.get("project") && !session && !mode) return;
  var preference = "system";
  try {
    var saved = localStorage.getItem("pneuma-launcher-theme");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch (error) {}
  var light = preference === "system" ? matchMedia("(prefers-color-scheme: light)").matches : preference === "light";
  var source = template.content.querySelector('[data-launcher-skeleton="page"]');
  if (!source) return;
  var page = source.cloneNode(true);
  if (light) page.classList.add("cc-theme-light", "launcher-light");
  if (window.pneumaDesktop) page.setAttribute("data-desktop", "");
  page.style.setProperty("--launcher-skeleton-delay", -(Date.now() % ${LAUNCHER_SKELETON_PERIOD_MS}) + "ms");
  root.appendChild(page);
})();`;

/** Tag descriptors for Vite's `transformIndexHtml` (structurally `HtmlTagDescriptor[]`). */
export function launcherSkeletonIndexTags() {
  return [
    { tag: "link", attrs: { rel: "preload", href: WORDMARK_FONT, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" as const },
    { tag: "template", attrs: { id: LAUNCHER_SKELETON_TEMPLATE_ID }, children: launcherSkeletonMarkup(), injectTo: "body" as const },
    { tag: "script", children: LAUNCHER_SKELETON_BOOT_SCRIPT, injectTo: "body" as const },
  ];
}

/**
 * The desktop's pre-start page. It is opened from disk, so the app stylesheet
 * is inlined with its root-relative URLs made relative to `dist/`, and the
 * theme arrives as `?theme=light|dark` from the settings the desktop read.
 * Its head script styles `<html>` (nothing replaces this document in place).
 */
export function launcherSkeletonPage(css: string): string {
  const relativeCss = css.replace(/url\((['"]?)\//g, "url($1./");
  const boot = `(function () {
  var html = document.documentElement;
  if (new URLSearchParams(location.search).get("theme") === "light") html.classList.add("cc-theme-light", "launcher-light");
  if (window.pneumaDesktop) html.setAttribute("data-desktop", "");
  html.style.setProperty("--launcher-skeleton-delay", -(Date.now() % ${LAUNCHER_SKELETON_PERIOD_MS}) + "ms");
})();`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pneuma Skills</title>
    <style>${relativeCss}</style>
    <script>${boot}</script>
  </head>
  <body>
    <div id="root">${launcherSkeletonMarkup("./logo.png")}</div>
  </body>
</html>
`;
}
