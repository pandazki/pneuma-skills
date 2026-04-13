import { useAsset } from "@pneuma-craft/react";

/**
 * Resolve an asset id to a workspace-relative content URL for <img>/<video>
 * consumption. Returns null if the asset is not yet materialized (uri === "").
 */
export function useWorkspaceAssetUrl(assetId: string): string | null {
  const asset = useAsset(assetId);
  if (!asset) return null;
  if (!asset.uri || asset.uri.length === 0) return null;
  return `/content/${asset.uri.split("/").map(encodeURIComponent).join("/")}`;
}
