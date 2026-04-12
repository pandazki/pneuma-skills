import { useMemo } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectHydration } from "./hooks/useProjectHydration.js";
import { StateDump } from "./StateDump.js";

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  return (
    <PneumaCraftProvider assetResolver={assetResolver}>
      <HydratedBody files={files} />
    </PneumaCraftProvider>
  );
};

/**
 * Hydration must happen inside the provider so `usePneumaCraftStore` works.
 * Splitting it into a child component keeps the provider's children stable.
 */
function HydratedBody({ files }: { files: ViewerPreviewProps["files"] }) {
  const { error } = useProjectHydration(files);
  return <StateDump hydrationError={error} />;
}

export default ClipCraftPreview;
