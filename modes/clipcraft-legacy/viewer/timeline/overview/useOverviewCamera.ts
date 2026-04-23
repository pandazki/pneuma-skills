import { useState, useCallback, useMemo } from "react";

export interface CameraState {
  rotateX: number;
  rotateY: number;
  perspective: number;
  perspectiveOriginX: number;
  perspectiveOriginY: number;
  translateX: number;  // % horizontal offset to center content after rotation
}

export type CameraPreset = "exploded" | "front" | "side";

const PRESETS: Record<CameraPreset, CameraState> = {
  exploded: {
    // Placeholder — ExplodedView handles its own camera
    rotateX: 0, rotateY: 0, perspective: 800,
    perspectiveOriginX: 50, perspectiveOriginY: 50, translateX: 0,
  },
  front: {
    rotateX: -5,
    rotateY: 0,
    perspective: 1600,
    perspectiveOriginX: 50,
    perspectiveOriginY: 50,
    translateX: 0,
  },
  side: {
    rotateX: -8,
    rotateY: 28,
    perspective: 750,
    perspectiveOriginX: 50,
    perspectiveOriginY: 48,
    translateX: 15,
  },
};

const PRESET_ORDER: CameraPreset[] = ["exploded", "front", "side"];

/**
 * Camera preset hook.
 * When called without arguments, manages its own state (used by TimelineShell).
 * When called with a preset, returns that preset's camera (used by TimelineOverview3D).
 */
export function useOverviewCamera(fixedPreset?: CameraPreset) {
  const [internalPreset, setPreset] = useState<CameraPreset>("front");
  const preset = fixedPreset ?? internalPreset;

  const camera = PRESETS[preset];

  const nextPreset = useCallback(() => {
    setPreset((p) => {
      const idx = PRESET_ORDER.indexOf(p);
      return PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
    });
  }, []);

  const selectPreset = useCallback((p: CameraPreset) => {
    setPreset(p);
  }, []);

  return useMemo(
    () => ({ camera, preset, nextPreset, selectPreset, PRESET_ORDER }),
    [camera, preset, nextPreset, selectPreset],
  );
}
