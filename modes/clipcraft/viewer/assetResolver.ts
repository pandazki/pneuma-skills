import type { AssetResolver } from "@pneuma-craft/video";

/**
 * Minimal AssetResolver — resolves asset ids to URLs served by pneuma's
 * workspace file server (exposed at `/content/<path>`).
 *
 * Note: @pneuma-craft/video declares `resolveUrl` as SYNCHRONOUS
 * (returns string, not Promise<string>). Matching that signature exactly.
 *
 * Asset ids are treated as workspace-relative paths in the bootstrap —
 * real content addressing will land with the provenance layer in a later plan.
 */
export function createWorkspaceAssetResolver(): AssetResolver {
  return {
    resolveUrl(assetId: string): string {
      return `/content/${assetId}`;
    },
    async fetchBlob(assetId: string): Promise<Blob> {
      const res = await fetch(`/content/${assetId}`);
      if (!res.ok) throw new Error(`fetchBlob ${assetId}: ${res.status}`);
      return await res.blob();
    },
  };
}
