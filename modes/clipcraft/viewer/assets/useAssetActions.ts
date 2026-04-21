import { useCallback } from "react";
import { useDispatch } from "@pneuma-craft/react";
import type { Actor, AssetType } from "@pneuma-craft/core";
import type { FsEntry } from "./reconcile.js";
import { useAssetErrors } from "./useAssetErrors.js";

const ACTOR: Actor = "human";

function classifyAssetType(file: File): AssetType | null {
  const mime = file.type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
  return null;
}

function classifyAssetTypeByUri(uri: string): AssetType | null {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
  return null;
}

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
            metadata: {},
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

  return { upload, remove, importOrphan };
}
