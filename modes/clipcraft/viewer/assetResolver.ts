import type { AssetResolver } from "@pneuma-craft/video";

/**
 * Workspace AssetResolver for ClipCraft.
 *
 * Maps craft `assetId` values to workspace-relative URIs served by pneuma's
 * file server (exposed at `/content/<path>`). Craft asset ids are opaque
 * (e.g. `seed-asset-sample`) — they are NOT file paths — so the resolver
 * keeps an internal id → uri map that callers refresh via `setAssets`
 * whenever the project's asset list changes.
 *
 * The object returned is an `AssetResolver` by structural type, with an
 * extra `setAssets` method. The resolver reference is stable across calls
 * to `setAssets`, which matters because `PneumaCraftProvider` requires its
 * `assetResolver` prop to be a stable reference — mutating the internal
 * map doesn't break that contract.
 *
 * Asset entries whose `uri` is empty (e.g. pending generations) are skipped
 * — trying to fetch them would 404 before the generation completes.
 */
export interface WorkspaceAssetResolver extends AssetResolver {
  setAssets(assets: readonly { id: string; uri: string }[]): void;
}

export function createWorkspaceAssetResolver(): WorkspaceAssetResolver {
  const uriById = new Map<string, string>();

  const urlFor = (assetId: string): string => {
    const uri = uriById.get(assetId);
    if (!uri) return `/content/${encodeURI(assetId)}`;
    return `/content/${encodeURI(uri)}`;
  };

  return {
    setAssets(assets) {
      uriById.clear();
      for (const a of assets) {
        if (a.uri) uriById.set(a.id, a.uri);
      }
    },
    resolveUrl(assetId: string): string {
      return urlFor(assetId);
    },
    async fetchBlob(assetId: string): Promise<Blob> {
      const res = await fetch(urlFor(assetId));
      if (!res.ok) throw new Error(`fetchBlob ${assetId}: ${res.status}`);
      return await res.blob();
    },
  };
}
