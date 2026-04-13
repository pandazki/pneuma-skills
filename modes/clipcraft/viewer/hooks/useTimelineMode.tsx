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
}

const TimelineModeContext = createContext<TimelineModeContextValue | null>(null);

export function TimelineModeProvider({ children }: { children: React.ReactNode }) {
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("collapsed");
  const [diveLayer, setDiveLayer] = useState<LayerType | null>(null);
  const [focusedLayer, setFocusedLayer] = useState<LayerType | null>(null);

  const value = useMemo<TimelineModeContextValue>(
    () => ({
      timelineMode,
      setTimelineMode,
      diveLayer,
      setDiveLayer,
      focusedLayer,
      setFocusedLayer,
    }),
    [timelineMode, diveLayer, focusedLayer],
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
