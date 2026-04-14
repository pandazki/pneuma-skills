import { useCallback } from "react";
import { useDispatch, useVariants, useAsset } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";

/**
 * Compact sibling-variant picker for the currently selected clip.
 * Reads useVariants(asset.id) and dispatches composition:rebind-clip
 * when the user picks a sibling.
 *
 * Returns null when the clip's asset has no siblings — keeps the
 * inspector dense.
 */
export function VariantSwitcher({ clip }: { clip: Clip }) {
  const dispatch = useDispatch();
  const asset = useAsset(clip.assetId);
  const variants = useVariants(clip.assetId);

  const onPick = useCallback(
    (variantId: string) => {
      if (variantId === clip.assetId) return;
      dispatch("human", {
        type: "composition:rebind-clip",
        clipId: clip.id,
        assetId: variantId,
      });
    },
    [dispatch, clip.id, clip.assetId],
  );

  if (!asset) return null;
  // useVariants returns siblings OR the asset itself — we want to
  // render the current asset + any siblings as chips. If there's
  // only the current asset, there are no alternatives; hide.
  const allVariants = variants.length > 0 ? variants : [asset];
  const hasAlternatives = allVariants.some((a) => a.id !== clip.assetId);
  if (!hasAlternatives && allVariants.length <= 1) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
        variants
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {allVariants.map((v) => {
          const active = v.id === clip.assetId;
          return (
            <button
              key={v.id}
              onClick={() => onPick(v.id)}
              disabled={active}
              title={v.name ?? v.id}
              style={{
                background: active ? "#f97316" : "#18181b",
                border: active ? "1px solid #f97316" : "1px solid #27272a",
                color: active ? "#0a0a0b" : "#a1a1aa",
                borderRadius: 3,
                padding: "2px 8px",
                fontSize: 9,
                cursor: active ? "default" : "pointer",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {v.name ?? v.id.slice(0, 6)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
