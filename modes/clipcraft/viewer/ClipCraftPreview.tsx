import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, MutableRefObject } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";
import { useProjectSync } from "./hooks/useProjectSync.js";
import { StateDump } from "./StateDump.js";
import { isExternalEdit } from "./externalEdit.js";

export { isExternalEdit } from "./externalEdit.js";

const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  // Parent-owned "last applied content" — the single source of truth for
  // loop protection. Both the providerKey bump logic (below) and the
  // useProjectSync hook (inside the provider) read and write it.
  const lastAppliedRef = useRef<string | null>(null);

  // providerKey is bumped ONLY when an external edit is detected. Our own
  // writes update lastAppliedRef.current before they hit the wire, so the
  // echo arrives with diskContent === lastAppliedRef.current and doesn't
  // trigger a bump. Net effect: own writes don't remount, external edits do.
  const [providerKey, setProviderKey] = useState(0);

  const projectFile = files.find(
    (f) => f.path === "project.json" || f.path.endsWith("/project.json"),
  );
  const diskContent = projectFile?.content ?? null;

  useEffect(() => {
    if (isExternalEdit(diskContent, lastAppliedRef.current)) {
      setProviderKey((k) => k + 1);
    }
  }, [diskContent]);

  // onLocalWrite is called by useProjectSync after a successful write. It
  // doesn't need to do anything here — lastAppliedRef was already updated
  // inside the hook. Callback kept for future expansion (status banner,
  // dirty indicator, etc.) and because hooks like to have stable callbacks
  // even when empty.
  const onLocalWrite = useCallback((_content: string) => {
    // no-op — lastAppliedRef is updated inside useProjectSync
  }, []);

  return (
    <PneumaCraftProvider key={providerKey} assetResolver={assetResolver}>
      <SyncedBody
        files={files}
        lastAppliedRef={lastAppliedRef}
        onLocalWrite={onLocalWrite}
      />
    </PneumaCraftProvider>
  );
};

function SyncedBody({
  files,
  lastAppliedRef,
  onLocalWrite,
}: {
  files: ViewerPreviewProps["files"];
  lastAppliedRef: MutableRefObject<string | null>;
  onLocalWrite: (content: string) => void;
}) {
  const { error } = useProjectSync(files, { lastAppliedRef, onLocalWrite });
  return <StateDump hydrationError={error} />;
}

export default ClipCraftPreview;
