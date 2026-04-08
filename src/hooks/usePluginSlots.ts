import { useState, useEffect } from "react";
import { getApiBase } from "../utils/api.js";
import type { FormSlotDeclaration } from "../../core/types/plugin.js";

export interface ComponentSlotDeclaration {
  type: "component";
  importUrl: string;
}

export type ResolvedSlotDeclaration = string | FormSlotDeclaration | ComponentSlotDeclaration;

export interface SlotEntry {
  pluginName: string;
  declaration: ResolvedSlotDeclaration;
}

/**
 * Fetch slot entries for a given slot name from the plugin registry.
 * Returns an array of { pluginName, declaration } for all plugins
 * that register content for this slot.
 */
export function usePluginSlots(slotName: string): SlotEntry[] {
  const [entries, setEntries] = useState<SlotEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/slots/${encodeURIComponent(slotName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.entries) {
          setEntries(data.entries);
        }
      })
      .catch(() => {
        // Soft error: plugin slots not available, don't break the UI
      });
    return () => { cancelled = true; };
  }, [slotName]);

  return entries;
}
