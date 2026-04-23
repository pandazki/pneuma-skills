import React, { createContext, useContext, useMemo, useState } from "react";

export interface SharedZoomState {
  pixelsPerSecond: number;
  scrollLeft: number;
}

interface ZoomContextValue {
  zoom: SharedZoomState;
  setZoom: (updater: (prev: SharedZoomState) => SharedZoomState) => void;
}

const ZoomContext = createContext<ZoomContextValue | null>(null);

// Initial pixelsPerSecond=0 is the "uninitialized" sentinel — the first
// useTimelineZoom call to attach to a real container will auto-fit to
// its viewport width and write the result back into shared state.
// Subsequent consumers (Timeline → TimelineOverview3D, etc.) inherit it.
const INITIAL: SharedZoomState = { pixelsPerSecond: 0, scrollLeft: 0 };

export function TimelineZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoom, setZoomState] = useState<SharedZoomState>(INITIAL);
  const setZoom = (updater: (prev: SharedZoomState) => SharedZoomState) => {
    setZoomState((prev) => updater(prev));
  };
  const value = useMemo(() => ({ zoom, setZoom }), [zoom]);
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>;
}

export function useSharedZoom() {
  const ctx = useContext(ZoomContext);
  if (!ctx) throw new Error("useSharedZoom must be used inside <TimelineZoomProvider>");
  return ctx;
}
