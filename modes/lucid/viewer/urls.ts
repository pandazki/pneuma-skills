/**
 * Every byte the lucid stage shows comes through here.
 *
 * A project is a content set (a top-level directory), and every path recorded
 * in `lucid.json` — `target.png`, `rounds/01/capture.png`, a GLB under
 * `scene/models/` — is relative to that directory. The served path is
 * therefore `<base>/content/<dir>/<path>`, with an empty `dir` for a
 * root-level project.
 *
 * `base` is passed in rather than imported so these stay pure: in the browser
 * it is `getApiBase()` (the API origin in dev, same-origin in production);
 * in a test it is `""`.
 *
 * Two cache busters, on purpose:
 *   - `v=<imageVersion>` on images. A re-judged round rewrites the SAME path
 *     (`rounds/03/capture.png`), so without it the user keeps seeing the
 *     previous attempt and believes nothing happened.
 *   - `r=<nonce>` on the scene document. The iframe's `key` already remounts
 *     it, but a browser that has `index.html` cached would remount onto the
 *     same bytes; the nonce makes a reload mean a reload.
 */

/** Percent-encode each segment of a `/`-separated path, keeping the slashes. */
export function encodeContentPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** `/content/<dir>` for a project, `/content` for a root-level one. */
export function contentBase(base: string, dir: string): string {
  return dir ? `${base}/content/${encodeContentPath(dir)}` : `${base}/content`;
}

/** The scene document the Live view loads. `nonce` changes on every reload. */
export function sceneUrl(base: string, dir: string, nonce: number): string {
  return `${contentBase(base, dir)}/scene/index.html?r=${nonce}`;
}

/**
 * A project-relative asset (`target.png`, `rounds/01/capture.png`).
 * Returns null for a missing path so callers render an empty state rather
 * than requesting `/content/<dir>/null`.
 */
export function assetUrl(
  base: string,
  dir: string,
  path: string | null | undefined,
  imageVersion: number,
): string | null {
  if (!path) return null;
  return `${contentBase(base, dir)}/${encodeContentPath(path)}?v=${imageVersion}`;
}
