import { useMemo } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";

/**
 * ClipCraft viewer (bootstrap).
 * Wraps the craft provider so all descendant craft hooks/components work,
 * but renders a placeholder — no real UI yet.
 */
const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  return (
    <PneumaCraftProvider assetResolver={assetResolver}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#a1a1aa",
          fontFamily: "system-ui",
          fontSize: 14,
          background: "#09090b",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8, color: "#f97316" }}>
            ClipCraft
          </div>
          <div>craft-backed viewer bootstrap — {files.length} file(s) synced</div>
        </div>
      </div>
    </PneumaCraftProvider>
  );
};

export default ClipCraftPreview;
