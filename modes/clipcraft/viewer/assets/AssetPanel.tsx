import { useCallback, useMemo, useState } from "react";
import { useAssets, type Asset, type AssetType } from "@pneuma-craft/react";
import { AssetGroup } from "./AssetGroup.js";
import { AssetLightbox } from "./AssetLightbox.js";
import { ScriptTab } from "./ScriptTab.js";
import { useAssetActions } from "./useAssetActions.js";

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
        width: 220,
        minWidth: 220,
        background: "#111113",
        borderRight: "1px solid #27272a",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", borderBottom: "1px solid #27272a", flexShrink: 0 }}>
        {(["assets", "script"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              borderBottom:
                tab === t ? "2px solid #f97316" : "2px solid transparent",
              color: tab === t ? "#e4e4e7" : "#71717a",
              fontSize: 12,
              fontWeight: 500,
              padding: "8px 0",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t === "assets" ? "Assets" : "Script"}
          </button>
        ))}
      </div>

      {tab === "assets" ? (
        <div style={{ padding: "8px 10px", overflowY: "auto", flex: 1 }}>
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
