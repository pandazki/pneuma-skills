import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ProjectScene } from "../../persistence.js";

interface SceneContextValue {
  scenes: ProjectScene[];
  setScenes: (updater: (prev: ProjectScene[]) => ProjectScene[]) => void;
  selectedSceneId: string | null;
  setSelectedSceneId: (id: string | null) => void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export interface SceneProviderProps {
  initialScenes: ProjectScene[];
  onScenesChange?: (next: ProjectScene[]) => void;
  children: React.ReactNode;
}

/**
 * Holds the mode-local scenes[] array. Scenes are ordered by `order` at
 * read time via `useScenes()`. In Plan 6 there is no edit path; `setScenes`
 * exists only so Plan 7 can wire it up without breaking this interface.
 */
export function SceneProvider({ initialScenes, onScenesChange, children }: SceneProviderProps) {
  const [scenes, setScenesState] = useState<ProjectScene[]>(initialScenes);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    initialScenes[0]?.id ?? null,
  );

  const setScenes = useCallback(
    (updater: (prev: ProjectScene[]) => ProjectScene[]) => {
      setScenesState((prev) => {
        const next = updater(prev);
        onScenesChange?.(next);
        return next;
      });
    },
    [onScenesChange],
  );

  const value = useMemo<SceneContextValue>(
    () => ({ scenes, setScenes, selectedSceneId, setSelectedSceneId }),
    [scenes, setScenes, selectedSceneId],
  );

  return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
}

export function useScenes(): ProjectScene[] {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScenes must be used inside <SceneProvider>");
  return useMemo(
    () => [...ctx.scenes].sort((a, b) => a.order - b.order),
    [ctx.scenes],
  );
}

export function useSceneSelection() {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useSceneSelection must be used inside <SceneProvider>");
  return {
    selectedSceneId: ctx.selectedSceneId,
    setSelectedSceneId: ctx.setSelectedSceneId,
  };
}

export function useSetScenes() {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useSetScenes must be used inside <SceneProvider>");
  return ctx.setScenes;
}
