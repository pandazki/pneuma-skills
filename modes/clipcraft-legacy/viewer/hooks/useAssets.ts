import { useCallback } from "react";
import { useClipCraftDispatch } from "../store/ClipCraftContext.js";

/**
 * Asset management hook -- upload and delete operations.
 * Components dispatch SET_UPLOADING; the actual file operations go through /api/files.
 */
export function useAssetActions() {
  const dispatch = useClipCraftDispatch();

  const upload = useCallback(
    async (file: File, targetDir: string): Promise<boolean> => {
      dispatch({ type: "SET_UPLOADING", uploading: true });
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: `${targetDir}${file.name}`,
            content: dataUrl,
          }),
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        dispatch({ type: "SET_UPLOADING", uploading: false });
      }
    },
    [dispatch],
  );

  const remove = useCallback(async (path: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { upload, remove };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
