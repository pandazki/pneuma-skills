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
 */
export function contentUrl(
  contentSet: string,
  uri: string,
  imageVersion: number,
): string {
  const prefix = contentSet ? `${encodeContentPath(contentSet)}/` : "";
  return `/content/${prefix}${encodeContentPath(uri)}?v=${imageVersion}`;
}
