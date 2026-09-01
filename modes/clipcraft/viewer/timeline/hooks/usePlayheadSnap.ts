import { useCallback } from "react";
import { useComposition } from "@pneuma-craft/react";
import { snapPlayheadTime, type PlayheadSnapResult } from "../playheadSnap.js";

/**
 * Binds `snapPlayheadTime` to the live composition. Consumers pass the
 * candidate time, the current zoom, and whether snapping is enabled for
 * this gesture (Shift bypasses it).
 */
export function usePlayheadSnap(): (
  time: number,
  pixelsPerSecond: number,
  enabled: boolean,
) => PlayheadSnapResult {
  const composition = useComposition();
  return useCallback(
    (time, pixelsPerSecond, enabled) =>
      snapPlayheadTime(composition, time, pixelsPerSecond, enabled),
    [composition],
  );
}
