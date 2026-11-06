/**
 * Every byte the sticker viewer shows comes through here.
 *
 * Media is never watched (see the manifest): takes, art and exports are read
 * from `/content/<uri>`, and the URL carries the craft asset's `createdAt`
 * so a file landed again is new bytes to the browser. The encoding and the
 * stamp are the shared craft module's (`resolveAssetUri`), not a second
 * copy. In the hosted player the content service worker answers the same
 * URLs from the package.
 *
 * `base` is passed in so this stays pure: `getApiBase()` in the browser
 * (the API origin in dev, same-origin in production), `""` in a test.
 */

import type { CraftAsset } from "../../_shared/scripts/craft-project.mjs";
import { resolveAssetUri } from "../../_shared/scripts/craft-project.mjs";
import type { AssetBrief } from "../domain.js";

export function mediaUrl(base: string, brief: AssetBrief | null | undefined): string | null {
  if (!brief || brief.status !== "ready" || !brief.uri) return null;
  const asset = {
    id: brief.id,
    type: brief.type,
    uri: brief.uri,
    name: brief.name,
    metadata: {},
    createdAt: brief.createdAt,
    status: "ready",
  } satisfies CraftAsset;
  return resolveAssetUri(`${base}/content`, asset);
}

/** A workspace file that is not a craft asset (the upload archives). */
export function fileUrl(base: string, uri: string, stamp?: number): string {
  const path = uri
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/content/${path}${stamp ? `?r=${stamp}` : ""}`;
}
