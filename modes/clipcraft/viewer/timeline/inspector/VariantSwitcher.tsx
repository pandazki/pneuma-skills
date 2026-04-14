import { useCallback } from "react";
import { useDispatch, useVariants, useAsset } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { theme } from "../../theme/tokens.js";

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
  const allVariants = variants.length > 0 ? variants : [asset];
  const hasAlternatives = allVariants.some((a) => a.id !== clip.assetId);
  if (!hasAlternatives && allVariants.length <= 1) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space1,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          color: theme.color.ink4,
          textTransform: "uppercase",
          letterSpacing: theme.text.trackingCaps,
          fontWeight: theme.text.weightSemibold,
        }}
      >
        Variants
      </span>
      <div style={{ display: "flex", gap: theme.space.space1, flexWrap: "wrap" }}>
        {allVariants.map((v) => {
          const active = v.id === clip.assetId;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(v.id)}
              disabled={active}
              title={v.name ?? v.id}
              aria-pressed={active}
              style={{
                background: active ? theme.color.accentSoft : theme.color.surface2,
                border: active
                  ? `1px solid ${theme.color.accentBorder}`
                  : `1px solid ${theme.color.borderWeak}`,
                color: active ? theme.color.accentBright : theme.color.ink2,
                borderRadius: theme.radius.sm,
                padding: `3px ${theme.space.space2}px`,
                fontFamily: theme.font.ui,
                fontSize: theme.text.xs,
                fontWeight: active
                  ? theme.text.weightSemibold
                  : theme.text.weightMedium,
                letterSpacing: theme.text.trackingBase,
                cursor: active ? "default" : "pointer",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
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
