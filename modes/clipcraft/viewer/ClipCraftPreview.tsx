import { useMemo } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectHydration } from "./hooks/useProjectHydration.js";
import { StateDump } from "./StateDump.js";

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  // Key the provider on project.json content. Any external edit remounts the
  // provider, which wipes craft's in-memory store — matching Plan 2's
  // read-only "rebuild from disk on every change" semantics. The undo stack
  // is sacrificed because Plan 2 has no user-initiated dispatches; Plan 3
  // will replace this with a diff-and-dispatch strategy that preserves undo.
  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const providerKey = projectFile?.content ?? "no-project";

  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
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
