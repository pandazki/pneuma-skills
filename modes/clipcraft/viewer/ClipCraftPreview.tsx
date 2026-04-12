import { useCallback, useMemo, useRef, useState } from "react";
import type { ComponentType, MutableRefObject } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectSync } from "./hooks/useProjectSync.js";
import { StateDump } from "./StateDump.js";

export { isExternalEdit } from "./externalEdit.js";

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  // Parent-owned "last applied content" — the echo-skip guard. useProjectSync
  // updates it after hydration and after its own writes. On external edits
  // the hook calls onExternalEdit BEFORE touching the ref, so the parent
  // can still see the pre-edit value and remount cleanly.
  const lastAppliedRef = useRef<string | null>(null);

  // providerKey is bumped ONLY when useProjectSync reports an external edit
  // on a live store. Own-write echoes skip this path entirely because the
  // hook short-circuits on `diskContent === lastAppliedRef.current`.
  const [providerKey, setProviderKey] = useState(0);

  const onLocalWrite = useCallback((_content: string) => {
    // no-op — lastAppliedRef is updated inside useProjectSync
  }, []);

  const onExternalEdit = useCallback(() => {
    // Clear the applied ref before remounting so the fresh hook instance
    // doesn't mistake the new disk content for another external edit and
    // infinite-loop. The fresh hook will re-claim it after hydration.
    lastAppliedRef.current = null;
    setProviderKey((k) => k + 1);
  }, []);

  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
      <SyncedBody
        files={files}
        lastAppliedRef={lastAppliedRef}
        onLocalWrite={onLocalWrite}
        onExternalEdit={onExternalEdit}
      />
    </PneumaCraftProvider>
  );
};

function SyncedBody({
  files,
  lastAppliedRef,
  onLocalWrite,
  onExternalEdit,
}: {
  files: ViewerPreviewProps["files"];
  lastAppliedRef: MutableRefObject<string | null>;
  onLocalWrite: (content: string) => void;
  onExternalEdit: () => void;
}) {
  const { error } = useProjectSync(files, {
    lastAppliedRef,
    onLocalWrite,
    onExternalEdit,
  });
  return <StateDump hydrationError={error} />;
}

export default ClipCraftPreview;
