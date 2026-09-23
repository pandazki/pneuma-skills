/**
 * page-document — how the webcraft preview shows one page of the site, and
 * where that page is.
 *
 * The preview iframe navigates to the page's real content URL,
 * `<origin>/content/<set>/<page>?<query>#<hash>`. That one URL means the same
 * thing in every place the viewer runs: the session server serves `/content/*`
 * in production, Vite proxies it in dev, and the hosted player's service
 * worker (`public/player-content-sw.js`) answers it from the play package.
 * Because the page is an ordinary navigation on the viewer's origin:
 *
 * - `location.search`, `.hash` and `.pathname` read as when the site is opened
 *   directly, and the browser scrolls to the fragment itself;
 * - relative links, stylesheets, scripts and images all resolve against the
 *   page's own URL — as they do when the exported ZIP is deployed — and every
 *   request the page makes goes where a request from that URL goes (in the
 *   player: through the service worker);
 * - a page that reloads itself, submits a GET form or sets `location` lands on
 *   another real URL, and the viewer just follows it.
 *
 * The viewer's own tools (selection, text editing, the thin scrollbar) are
 * added by the parent to every document the iframe loads, on its `load` event
 * (`instrumentPage`), so a reload or a navigation the page made itself is
 * instrumented the same way as one the viewer made. Everything added carries
 * `PREVIEW_MARK`, which is what edit mode skips and a text-edit handle strips —
 * nothing the page authored carries it or sits inside a node that does. The
 * document itself is flagged with the separate `INSTRUMENTED_MARK`, so
 * `closest(PREVIEW_MARK)` never matches the page's own elements.
 *
 * History: this replaced `iframe.srcdoc` (whose `about:srcdoc` URL can never
 * carry a query) and a short-lived `document.open()` loader (whose written
 * document's requests bypassed the player's service worker, and whose
 * reloads came back uninstrumented).
 */

/** Attribute carried by every node the viewer adds to a preview page. */
export const PREVIEW_MARK = "data-pneuma-preview";

/** Attribute on the `<html>` of a document the viewer has instrumented. */
export const INSTRUMENTED_MARK = "data-pneuma-instrumented";

/**
 * URL pathname of a page of a content set: `/content/<set>/<file>`, percent-
 * encoded the way `location.pathname` reports it so the two compare equal.
 */
export function pagePath(contentSet: string | null | undefined, file: string): string {
  const raw = `/content/${contentSet ? `${contentSet}/` : ""}${file}`;
  // `?` and `#` in a file name would otherwise start a query / fragment.
  const escaped = raw.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
  return new URL(escaped, "http://pneuma.invalid").pathname;
}

/**
 * The content-set-relative page a URL shows, or null when it is not inside
 * the content set rooted at `rootUrl` (`<origin>/content/<set>/`). A directory
 * URL means its `index.html`, as a static host serves it.
 */
export function pageFromUrl(href: string, rootUrl: string): string | null {
  let target: URL;
  let root: URL;
  try {
    target = new URL(href);
    root = new URL(rootUrl);
  } catch {
    return null;
  }
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return null;
  let file: string;
  try {
    file = decodeURIComponent(target.pathname.slice(root.pathname.length));
  } catch {
    return null;
  }
  if (file === "" || file.endsWith("/")) file = `${file}index.html`;
  return file;
}

/** The body of a `<script>…</script>` / `<style>…</style>` string. */
export function elementBody(tagged: string): string {
  const open = tagged.indexOf(">");
  const close = tagged.lastIndexOf("</");
  return open >= 0 && close > open ? tagged.slice(open + 1, close) : tagged;
}

/**
 * Marks the iframe busy as soon as the page starts to leave — a reload, a
 * link, a script setting `location` — so `capture` never shoots a document
 * that is on its way out. The viewer clears it on the next `load`.
 */
export const LEAVE_SCRIPT =
  "addEventListener('pagehide',function(){try{if(frameElement)frameElement.setAttribute('aria-busy','true');}catch(_){}});";

/**
 * Add the viewer's scripts and styles to a loaded preview page. Idempotent per
 * document: a document that already carries them is left alone. Returns
 * whether anything was added.
 */
export function instrumentPage(
  doc: Document,
  parts: { scripts: readonly string[]; styles: readonly string[] },
  docId = "",
): boolean {
  const root = doc.documentElement;
  if (!root || root.hasAttribute(INSTRUMENTED_MARK)) return false;
  // The value names this loaded document, so what its scripts report (a text
  // edit) is tied to the file it was loaded from, not to whatever is current.
  root.setAttribute(INSTRUMENTED_MARK, docId);
  const head = doc.head ?? root;
  for (const css of parts.styles) {
    const style = doc.createElement("style");
    style.setAttribute(PREVIEW_MARK, "");
    style.textContent = css;
    head.appendChild(style);
  }
  const host = doc.body ?? root;
  for (const js of parts.scripts) {
    const script = doc.createElement("script");
    script.setAttribute(PREVIEW_MARK, "");
    script.textContent = js;
    host.appendChild(script);
  }
  return true;
}

/**
 * The content-set files a loaded page has requested so far — the document
 * itself, its stylesheets, scripts, images, fonts and fetches — read from the
 * page's Navigation and Resource Timing entries, as workspace paths mapped to
 * the epoch time (ms) the EARLIEST request for each started. `complete` is
 * false when the Resource Timing buffer is full (it keeps 250 entries by
 * default) and the list may be missing files.
 */
export function contentRequests(win: Window): { started: Map<string, number>; complete: boolean } {
  const perf = win.performance;
  const resources = perf?.getEntriesByType?.("resource") ?? [];
  const navigation = perf?.getEntriesByType?.("navigation") ?? [];
  const origin = perf?.timeOrigin ?? 0;
  const started = new Map<string, number>();
  for (const entry of [...navigation, ...resources]) {
    try {
      const url = new URL(entry.name);
      if (url.origin !== win.location.origin || !url.pathname.startsWith("/content/")) continue;
      let path = decodeURIComponent(url.pathname.slice("/content/".length));
      if (path === "" || path.endsWith("/")) path += "index.html";
      const at = origin + (entry.startTime ?? 0);
      const seen = started.get(path);
      if (seen === undefined || at < seen) started.set(path, at);
    } catch { /* not a URL we serve */ }
  }
  return { started, complete: resources.length < 250 };
}

/**
 * Workspace paths of the content-set files a loaded page has requested so far,
 * or `"all"` when the Resource Timing buffer is full and the list may be
 * incomplete. See `contentRequests`.
 */
export function referencedContentPaths(win: Window): Set<string> | "all" {
  const { started, complete } = contentRequests(win);
  return complete ? new Set(started.keys()) : "all";
}

/**
 * Of the files that changed while a page was loading (`changed`: workspace
 * path → epoch ms the viewer saw the change), those the loaded page may show
 * in their OLD version: it requested them no later than the change was seen,
 * or its request list is incomplete and they belong to its content set
 * (`setPrefix`, e.g. "gazette/"). Files it never requested are not its concern.
 */
export function staleAfterLoad(
  changed: ReadonlyMap<string, number>,
  requests: { started: ReadonlyMap<string, number>; complete: boolean },
  setPrefix: string,
): string[] {
  const stale: string[] = [];
  for (const [path, seenAt] of changed) {
    const at = requests.started.get(path);
    if (at !== undefined ? at <= seenAt : !requests.complete && path.startsWith(setPrefix)) stale.push(path);
  }
  return stale;
}
