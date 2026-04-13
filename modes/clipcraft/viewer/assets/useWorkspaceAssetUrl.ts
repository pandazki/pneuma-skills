import { useAsset } from "@pneuma-craft/react";

/**
 * Resolve an asset id to a workspace-relative content URL for <img>/<video>
 * consumption. Returns null if the asset is not yet materialized (uri === "").
 *
 * Accepts `null` so callers can pass a transiently-absent id
 * (e.g. `activeClip?.assetId ?? null`) without conditionally calling the hook.
 * Internally short-circuits to `useAsset("")` — the craft asset registry
 * returns `undefined` for an empty id.
 */
export function useWorkspaceAssetUrl(assetId: string | null): string | null {
  const asset = useAsset(assetId ?? "");
  if (!assetId || !asset) return null;
  if (!asset.uri || asset.uri.length === 0) return null;
  return `/content/${asset.uri.split("/").map(encodeURIComponent).join("/")}`;
}
