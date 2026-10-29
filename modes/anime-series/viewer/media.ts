/**
 * Every byte the series viewer shows comes through here.
 *
 * Media is never watched (see the manifest): sheets, storyboards, clips and
 * contact sheets are read from `/content/<uri>`, and the URL carries the
 * craft asset's `createdAt` so a file re-generated at the same path is new
 * bytes to the browser. The encoding and the stamp are the shared craft
 * module's (`resolveAssetUri`), not a second copy.
 *
 * `base` is passed in so this stays pure: `getApiBase()` in the browser
 * (the API origin in dev, same-origin in production), `""` in a test.
 */

import type { CraftAsset } from "../../_shared/scripts/craft-project.mjs";
import { resolveAssetUri } from "../../_shared/scripts/craft-project.mjs";
import type { AssetView } from "../domain.js";

export function mediaUrl(base: string, view: AssetView | null | undefined): string | null {
  if (!view || !view.exists || view.status !== "ready" || !view.uri) return null;
  const asset = {
    id: view.id,
    type: view.type ?? "image",
    uri: view.uri,
    name: view.name,
    metadata: {},
    createdAt: view.createdAt,
    status: "ready",
  } satisfies CraftAsset;
  return resolveAssetUri(`${base}/content`, asset);
}
