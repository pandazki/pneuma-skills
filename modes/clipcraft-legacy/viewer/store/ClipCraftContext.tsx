import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
} from "react";
import type { ViewerFileContent } from "../../../../core/types/viewer-contract.js";
import type { ClipCraftState, ClipCraftAction, AssetFile } from "./types.js";
import { clipCraftReducer, initialState, classifyFileType } from "./reducer.js";

// ── Context ───────────────────────────────────────────────────────────────────

const ClipCraftContext = createContext<{
  state: ClipCraftState;
  dispatch: React.Dispatch<ClipCraftAction>;
} | null>(null);

// ── Asset scanner ─────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

/** Recursively flatten a file tree into asset files, grouped by subdirectory. */
function flattenTree(nodes: TreeNode[], prefix: string): Record<string, AssetFile[]> {
  const groups: Record<string, AssetFile[]> = {};

  for (const node of nodes) {
    if (node.type === "directory" && node.children) {
      // First-level directories under assets/ become group names
      const groupKey = node.name;
      const files: AssetFile[] = [];

      for (const child of node.children) {
        if (child.type === "file" && child.name !== ".gitkeep") {
          files.push({
            path: `${prefix}${groupKey}/${child.name}`,
            name: child.name,
            type: classifyFileType(child.name),
          });
        }
      }

      if (files.length > 0) {
        groups[groupKey] = files;
      }
    }
  }

  return groups;
}

async function scanAssets(): Promise<Record<string, AssetFile[]>> {
  try {
    const res = await fetch("/api/files/tree");
    if (!res.ok) return {};
    const data: { tree: TreeNode[] } = await res.json();
    // Find the assets/ directory node in the workspace tree
    const assetsNode = data.tree.find((n) => n.name === "assets" && n.type === "directory");
    if (!assetsNode?.children) return {};
    return flattenTree(assetsNode.children, "assets/");
  } catch {
    return {};
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ClipCraftProvider({
  children,
  files,
  imageVersion,
}: {
  children: ReactNode;
  files: ViewerFileContent[];
  imageVersion: number;
}) {
  const [state, dispatch] = useReducer(clipCraftReducer, initialState);

  // Sync text files (project.json, storyboard.json) from pneuma's files prop
  useEffect(() => {
    dispatch({ type: "SYNC_FILES", files, imageVersion });
  }, [files, imageVersion]);

  // Scan assets via API when imageVersion changes (covers binary files not in files array)
  useEffect(() => {
    scanAssets().then((assets) => {
      dispatch({ type: "SYNC_ASSETS", assets, imageVersion });
    });
  }, [imageVersion]);

  return (
    <ClipCraftContext.Provider value={{ state, dispatch }}>
      {children}
    </ClipCraftContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Access both state and dispatch from ClipCraftProvider. */
export function useClipCraft() {
  const ctx = useContext(ClipCraftContext);
  if (!ctx)
    throw new Error("useClipCraft must be used within ClipCraftProvider");
  return ctx;
}

/** Convenience: access state only. */
export function useClipCraftState() {
  return useClipCraft().state;
}

/** Convenience: access dispatch only. */
export function useClipCraftDispatch() {
  return useClipCraft().dispatch;
}
