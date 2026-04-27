import { useCallback } from "react";
import { useDispatch } from "@pneuma-craft/react";
import type { Actor } from "@pneuma-craft/core";
import type { FsEntry } from "./reconcile.js";
import { useAssetErrors } from "./useAssetErrors.js";
import { classifyAssetType, classifyByUri as classifyAssetTypeByUri } from "./classify.js";

const ACTOR: Actor = "human";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function makeAssetId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSafeFilename(originalName: string, assetId: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
  return ext ? `${assetId}.${ext}` : assetId;
}

export function useAssetActions() {
  const dispatch = useDispatch();
  const { setError, clearError } = useAssetErrors();

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const type = classifyAssetType(file);
      if (!type) {
        console.warn("[clipcraft] upload rejected — unknown asset type", file.name);
        return null;
      }

      const assetId = makeAssetId();
      const filename = makeSafeFilename(file.name, assetId);
      const workspacePath = `assets/${filename}`;

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/files?origin=external", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: workspacePath, content: dataUrl }),
        });
        if (!res.ok) {
          setError(assetId, `upload failed: ${res.status}`);
          return null;
        }
      } catch (e) {
        setError(assetId, `upload failed: ${(e as Error).message}`);
        return null;
      }

      try {
        dispatch(ACTOR, {
          type: "asset:register",
          asset: {
            id: assetId,
            type,
            uri: workspacePath,
            name: file.name,
            metadata: { size: file.size },
          },
        });
        dispatch(ACTOR, {
          type: "provenance:set-root",
          assetId,
          operation: {
            type: "import",
            actor: "human",
            timestamp: Date.now(),
            label: `uploaded ${file.name}`,
            params: {
              source: "upload",
              originalName: file.name,
              mimeType: file.type,
            },
          },
        });
        clearError(assetId);
        return assetId;
      } catch (e) {
        setError(assetId, `register failed: ${(e as Error).message}`);
        return null;
      }
    },
    [dispatch, setError, clearError],
  );

  const remove = useCallback(
    (assetId: string) => {
      try {
        dispatch(ACTOR, { type: "asset:remove", assetId });
        clearError(assetId);
      } catch (e) {
        setError(assetId, `remove failed: ${(e as Error).message}`);
      }
    },
    [dispatch, setError, clearError],
  );

  const trashFiles = useCallback(
    async (
      uris: string[],
      registeredAssetIds: string[] = [],
    ): Promise<{
      trashed: string[];
      failed: Array<{ uri: string; error: string }>;
    }> => {
      if (uris.length === 0) return { trashed: [], failed: [] };

      let body: {
        trashed: string[];
        failed: Array<{ uri: string; error: string }>;
      };
      try {
        const res = await fetch("/api/assets/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris }),
        });
        const data = await res.json();
        if (!res.ok) {
          return {
            trashed: data?.trashed ?? [],
            failed:
              data?.failed ??
              uris.map((uri) => ({ uri, error: `HTTP ${res.status}` })),
          };
        }
        body = {
          trashed: data.trashed ?? [],
          failed: data.failed ?? [],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          trashed: [],
          failed: uris.map((uri) => ({ uri, error: message })),
        };
      }

      // After the server moves files to trash, unregister any
      // registered assets for the ones that were successfully
      // trashed. Best-effort — if unregister fails here, the file is
      // already in the trash; the dangling registry entry will show
      // as "missing" and the user can clean it up via Unregister.
      for (const assetId of registeredAssetIds) {
        try {
          dispatch(ACTOR, { type: "asset:remove", assetId });
        } catch {
          // Swallow; see comment above.
        }
      }
      // Note: caller is responsible for calling refetchFs() after this
      // resolves so the fs listing reflects the change.
      return body;
    },
    [dispatch],
  );

  const importOrphan = useCallback(
    (entry: FsEntry): string | null => {
      const type = classifyAssetTypeByUri(entry.uri);
      if (!type) {
        console.warn("[clipcraft] importOrphan rejected — unknown asset type", entry.uri);
        return null;
      }

      const assetId = makeAssetId();

      try {
        dispatch(ACTOR, {
          type: "asset:register",
          asset: {
            id: assetId,
            type,
            uri: entry.uri,
            name: entry.uri.split("/").pop() ?? entry.uri,
            metadata: { size: entry.size },
          },
        });
        dispatch(ACTOR, {
          type: "provenance:set-root",
          assetId,
          operation: {
            type: "import",
            actor: "human",
            timestamp: Date.now(),
            label: `imported ${entry.uri}`,
            params: {
              source: "fs-orphan",
            },
          },
        });
        clearError(assetId);
        return assetId;
      } catch (e) {
        setError(assetId, `register failed: ${(e as Error).message}`);
        return null;
      }
    },
    [dispatch, setError, clearError],
  );

  return { upload, remove, importOrphan, trashFiles };
}
