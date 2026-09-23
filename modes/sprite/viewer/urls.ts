/**
 * Every byte the sprite stage shows comes through here.
 *
 * An asset's `uri` in `project.json` is relative to the CHARACTER directory
 * (`motions/idle/frames/00.png`), and the character directory is the content
 * set — so the served path is `<contentSet>/<uri>`, with an empty content set
 * for a root-level project. Each segment is encoded on its own: a character
 * called `ルミ` or a motion the agent named with a space must still resolve,
 * and `encodeURIComponent` over the whole path would eat the separators.
 *
 * `imageVersion` is the framework's global image counter (bumped whenever any
 * image on disk changes). It rides every URL as `?v=` because a regenerated
 * motion writes the SAME paths — without the query the browser would keep
 * showing the previous run's frames and the user would think the pipeline did
 * nothing. Text-shaped assets (atlas.json) get it too; they are rewritten by
 * the same runs.
 *
 * Frames are the exception to "the counter moves when the file does": the
 * per-frame directories are outside the file watcher (see the manifest's
 * `ignorePatterns`), so no frame write bumps `imageVersion`. A frame url also
 * carries `r=<createdAt>` — the time `register-run` recorded the frame — so a
 * run that lands at the same paths is still new bytes to the browser.
 */

/** Percent-encode each segment of a `/`-separated path, keeping the slashes. */
export function encodeContentPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * The URL for one asset of one character.
 *
 * @param contentSet Directory prefix of the character; `""` for a root project.
 * @param uri        Asset uri, relative to the character directory.
 * @param imageVersion Framework image counter, used as a cache buster.
 * @param registeredAt The asset's `createdAt`, for assets the watcher does
 *                     not follow (frames). Omitted when 0 or absent.
 */
export function contentUrl(
  contentSet: string,
  uri: string,
  imageVersion: number,
  registeredAt?: number,
): string {
  const prefix = contentSet ? `${encodeContentPath(contentSet)}/` : "";
  const run = registeredAt ? `&r=${registeredAt}` : "";
  return `/content/${prefix}${encodeContentPath(uri)}?v=${imageVersion}${run}`;
}
