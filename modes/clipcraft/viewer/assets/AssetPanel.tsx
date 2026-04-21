import { useCallback, useMemo, useState } from "react";
import { useAssets, type Asset, type AssetType } from "@pneuma-craft/react";
import { AssetGroup } from "./AssetGroup.js";
import { AssetLightbox } from "./AssetLightbox.js";
import { AssetManagerModal } from "./AssetManagerModal.js";
import { ScriptTab } from "./ScriptTab.js";
import { useAssetActions } from "./useAssetActions.js";
import { useAssetFsListing } from "./useAssetFsListing.js";
import { reconcileAssets } from "./reconcile.js";
import { theme } from "../theme/tokens.js";
import { SparkleIcon } from "../icons/index.js";
import { useGenerationDialog } from "../generation/useGenerationDialog.js";

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
];

export function AssetPanel() {
  const assets = useAssets();
  const { upload, remove } = useAssetActions();
  const [tab, setTab] = useState<Tab>("assets");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const { openForCreate } = useGenerationDialog();

  const { entries: fsEntries, refetch: refetchFs } = useAssetFsListing();

  const grouped = useMemo(() => {
    const byType = new Map<AssetType, Asset[]>();
    for (const a of assets) {
      const arr = byType.get(a.type) ?? [];
      arr.push(a);
      byType.set(a.type, arr);
    }
    return byType;
  }, [assets]);

  const registeredForReconcile = useMemo(
    () => assets.map((a) => ({ assetId: a.id, uri: a.uri })),
    [assets],
  );

  const report = useMemo(
    () => reconcileAssets(fsEntries, registeredForReconcile),
    [fsEntries, registeredForReconcile],
  );

  const orphanCount = report.orphaned.length;

  const missingUris = useMemo(
    () => new Set(report.missing.map((m) => m.uri)),
    [report.missing],
  );

  const handleUpload = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        const id = await upload(file);
        if (id) refetchFs();
      }
    },
    [upload, refetchFs],
  );

  const openManager = useCallback(() => setManagerOpen(true), []);
  const closeManager = useCallback(() => setManagerOpen(false), []);

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

      {tab === "assets" && (
        <div
          style={{
            padding: `${theme.space.space2}px ${theme.space.space3}px`,
            borderBottom: `1px solid ${theme.color.borderWeak}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => openForCreate("image")}
            title="Open the generation dialog to create a new asset"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space2,
              width: "100%",
              height: 30,
              padding: `0 ${theme.space.space3}px`,
              background: theme.color.accentSoft,
              border: `1px solid ${theme.color.accentBorder}`,
              borderRadius: theme.radius.base,
              color: theme.color.accentBright,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightSemibold,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              cursor: "pointer",
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
          >
            <SparkleIcon size={13} />
            <span>Create with AI</span>
          </button>
        </div>
      )}

      {tab === "assets" ? (
        <div
          style={{
            padding: `${theme.space.space3}px ${theme.space.space3}px`,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {orphanCount > 0 && (
            <div
              style={{
                marginBottom: theme.space.space3,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={openManager}
                title="Open Asset Manager to import or unregister assets"
                className="asset-orphan-badge"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: `2px ${theme.space.space1}px`,
                  fontFamily: theme.font.ui,
                  fontSize: theme.text.xs,
                  color: theme.color.ink4,
                  letterSpacing: theme.text.trackingBase,
                  cursor: "pointer",
                  textDecoration: "underline dotted",
                  textUnderlineOffset: 3,
                  transition: `color ${theme.duration.quick}ms ${theme.easing.out}`,
                }}
              >
                {orphanCount} not imported
              </button>
            </div>
          )}
          {GROUPS.map((g) => (
            <AssetGroup
              key={g.type}
              label={g.label}
              type={g.type}
              display={g.display}
              accept={g.accept}
              assets={grouped.get(g.type) ?? []}
              missingUris={missingUris}
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

      <AssetManagerModal
        open={managerOpen}
        onClose={closeManager}
        report={report}
        refetchFs={refetchFs}
      />
    </div>
  );
}
