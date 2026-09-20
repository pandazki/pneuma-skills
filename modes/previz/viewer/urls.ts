/**
 * Every byte the previz stage shows comes through here.
 *
 * A project is a content set (a top-level directory) and every path recorded
 * in `shot.json` — `greybox/greybox.mp4`, `takes/take-01.mp4`,
 * `greybox/scene.glb` — is relative to that shot's directory. The served path
 * is therefore `<base>/content/<project>/shots/<shot>/<path>`, with an empty
 * project for a root-level film.
 *
 * `base` is passed in rather than imported so these stay pure: in the browser
 * it is `getApiBase()` (the API origin in dev, same-origin in production); in
 * a test it is `""`.
 *
 * THE CACHE BUSTER IS THE REVISION, NOT A TIMESTAMP. A re-render rewrites the
 * SAME path (`greybox/greybox.mp4`) and `previz.mjs` bumps
 * `greybox.revision` in the same write, so `?rev=<n>` changes exactly when
 * the bytes do. Media is not watched (a watched `.mp4` would be read into the
 * file store as text), which is why the number has to come from `shot.json`.
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

/**
 * A shot-relative asset (`greybox/greybox.mp4`, `takes/take-01.mp4`).
 *
 * `shotDir` is workspace-relative (`first-light/shots/lab-walk`), so it is
 * appended to `/content` directly. Returns null for a missing path so callers
 * render a named empty lane rather than requesting `/content/<dir>/null`.
 */
export function shotAssetUrl(
  base: string,
  shotDir: string,
  path: string | null | undefined,
  revision: number,
): string | null {
  if (!path) return null;
  const prefix = shotDir ? `${encodeContentPath(shotDir)}/` : "";
  return `${base}/content/${prefix}${encodeContentPath(path)}?rev=${revision}`;
}
