import React, { createContext, useContext, useMemo, useState } from "react";

export type TimelineMode = "collapsed" | "overview" | "exploded" | "dive";
export type LayerType = "video" | "audio" | "caption";

interface TimelineModeContextValue {
  timelineMode: TimelineMode;
  setTimelineMode: (mode: TimelineMode) => void;
  diveLayer: LayerType | null;
  setDiveLayer: (layer: LayerType | null) => void;
  focusedLayer: LayerType | null;
  setFocusedLayer: (layer: LayerType | null) => void;
  diveFocusedNodeId: string | null;
  setDiveFocusedNodeId: (id: string | null) => void;
  /** Shared layer-visibility set used by Overview (Front / Side)
   *  AND Exploded view. Default all three on; user can manually
   *  toggle off and the state persists across view switches. */
  activeLayers: Set<LayerType>;
  toggleLayer: (layer: LayerType) => void;
}

const TimelineModeContext = createContext<TimelineModeContextValue | null>(null);

const DEFAULT_ACTIVE_LAYERS: Set<LayerType> = new Set(["video", "caption", "audio"]);

export function TimelineModeProvider({ children }: { children: React.ReactNode }) {
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("collapsed");
  const [diveLayer, setDiveLayer] = useState<LayerType | null>(null);
  const [focusedLayer, setFocusedLayer] = useState<LayerType | null>(null);
  const [diveFocusedNodeId, setDiveFocusedNodeId] = useState<string | null>(null);
  const [activeLayers, setActiveLayers] = useState<Set<LayerType>>(
    () => new Set(DEFAULT_ACTIVE_LAYERS),
  );

  const toggleLayer = React.useCallback((layer: LayerType) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        // Keep at least one layer on — deselecting the last would
        // leave the 3D views with nothing to render.
        if (next.size > 1) next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  const value = useMemo<TimelineModeContextValue>(
    () => ({
      timelineMode,
      setTimelineMode,
      diveLayer,
      setDiveLayer,
      focusedLayer,
      setFocusedLayer,
      diveFocusedNodeId,
      setDiveFocusedNodeId,
      activeLayers,
      toggleLayer,
    }),
    [timelineMode, diveLayer, focusedLayer, diveFocusedNodeId, activeLayers, toggleLayer],
  );

  return (
    <TimelineModeContext.Provider value={value}>
      {children}
    </TimelineModeContext.Provider>
  );
}

export function useTimelineMode() {
  const ctx = useContext(TimelineModeContext);
  if (!ctx) throw new Error("useTimelineMode must be used inside <TimelineModeProvider>");
  return ctx;
}
