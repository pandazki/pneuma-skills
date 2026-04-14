import { useCallback, useMemo, useState } from "react";
import { useAssets, type Asset, type AssetType } from "@pneuma-craft/react";
import { AssetGroup } from "./AssetGroup.js";
import { AssetLightbox } from "./AssetLightbox.js";
import { ScriptTab } from "./ScriptTab.js";
import { useAssetActions } from "./useAssetActions.js";
import { theme } from "../theme/tokens.js";

type Tab = "assets" | "script";

interface GroupSpec {
  label: string;
  type: AssetType;
  display: "thumbnail" | "list";
  accept: string;
}

const GROUPS: GroupSpec[] = [
  { label: "Images", type: "image", display: "thumbnail", accept: "image/*" },
  { label: "Clips", type: "video", display: "thumbnail", accept: "video/*" },
  { label: "Audio", type: "audio", display: "list", accept: "audio/*" },
  { label: "Text", type: "text", display: "list", accept: "text/*" },
];

export function AssetPanel() {
  const assets = useAssets();
  const { upload, remove } = useAssetActions();
  const [tab, setTab] = useState<Tab>("assets");
  const [preview, setPreview] = useState<Asset | null>(null);

  const grouped = useMemo(() => {
    const byType = new Map<AssetType, Asset[]>();
    for (const a of assets) {
      const arr = byType.get(a.type) ?? [];
      arr.push(a);
      byType.set(a.type, arr);
    }
    return byType;
  }, [assets]);

  const handleUpload = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        await upload(file);
      }
    },
    [upload],
  );

  return (
    <div
      style={{
        width: 232,
        minWidth: 232,
        background: theme.color.surface1,
        borderRight: `1px solid ${theme.color.borderWeak}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontFamily: theme.font.ui,
      }}
    >
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${theme.color.borderWeak}`,
          flexShrink: 0,
        }}
      >
        {(["assets", "script"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={active}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                borderBottom: active
                  ? `2px solid ${theme.color.accent}`
                  : "2px solid transparent",
                color: active ? theme.color.ink0 : theme.color.ink3,
                fontFamily: theme.font.ui,
                fontSize: theme.text.xs,
                fontWeight: theme.text.weightSemibold,
                letterSpacing: theme.text.trackingCaps,
                textTransform: "uppercase",
                padding: `${theme.space.space2}px 0`,
                cursor: "pointer",
                transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
              }}
            >
              {t === "assets" ? "Assets" : "Script"}
            </button>
          );
        })}
      </div>

      {tab === "assets" ? (
        <div
          style={{
            padding: `${theme.space.space3}px ${theme.space.space3}px`,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {GROUPS.map((g) => (
            <AssetGroup
              key={g.type}
              label={g.label}
              type={g.type}
              display={g.display}
              accept={g.accept}
              assets={grouped.get(g.type) ?? []}
              onOpen={setPreview}
              onDelete={remove}
              onUpload={handleUpload}
            />
          ))}
        </div>
      ) : (
        <ScriptTab />
      )}

      {preview && (
        <AssetLightbox asset={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
