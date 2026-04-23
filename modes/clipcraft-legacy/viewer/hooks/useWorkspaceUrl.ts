import { useCallback } from "react";
import { useClipCraftState } from "../store/ClipCraftContext.js";

/**
 * Returns a function that converts a workspace-relative path to a browser-loadable URL.
 * Handles the /content/ prefix and imageVersion cache busting automatically.
 *
 * Usage:
 *   const url = useWorkspaceUrl();
 *   <img src={url("assets/images/foo.jpg")} />
 */
export function useWorkspaceUrl() {
  const { imageVersion } = useClipCraftState();
  return useCallback(
    (path: string) => `/content/${path}?v=${imageVersion}`,
    [imageVersion],
  );
}
