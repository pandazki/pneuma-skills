import React, { Suspense, useMemo } from "react";
import { FormSlotRenderer } from "./FormSlotRenderer.js";
import type { SlotEntry, ComponentSlotDeclaration } from "../hooks/usePluginSlots.js";
import type { FormSlotDeclaration } from "../../core/types/plugin.js";

interface SlotRendererProps {
  entries: SlotEntry[];
  /** Callback with { [pluginName]: { fieldName: value } } */
  onChange?: (allValues: Record<string, Record<string, unknown>>) => void;
  /** Extra props passed to custom components */
  componentProps?: Record<string, unknown>;
}

/** Dynamically imported component wrapper */
function DynamicSlotComponent({ importUrl, pluginName, componentProps }: {
  importUrl: string;
  pluginName: string;
  componentProps?: Record<string, unknown>;
}) {
  const LazyComponent = useMemo(
    () => React.lazy(() =>
      import(/* @vite-ignore */ importUrl).then((mod) => ({
        default: mod.default ?? mod,
      })).catch((err) => {
        console.warn(`[plugin:${pluginName}] failed to load component from ${importUrl}:`, err);
        return { default: () => null };
      })
    ),
    [importUrl, pluginName],
  );

  return (
    <Suspense fallback={<div className="text-[10px] text-cc-muted/30 animate-pulse">Loading plugin UI...</div>}>
      <LazyComponent {...(componentProps ?? {})} />
    </Suspense>
  );
}

/**
 * Renders all slot entries for a given slot point.
 * - FormSlotDeclaration → auto-rendered via FormSlotRenderer
 * - ComponentSlotDeclaration → dynamically imported React component
 */
export function SlotRenderer({ entries, onChange, componentProps }: SlotRendererProps) {
  // Track form values per plugin
  const valuesRef = React.useRef<Record<string, Record<string, unknown>>>({});

  if (entries.length === 0) return null;

  const handleFormChange = (pluginName: string, values: Record<string, unknown>) => {
    valuesRef.current = { ...valuesRef.current, [pluginName]: values };
    onChange?.({ ...valuesRef.current });
  };

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const decl = entry.declaration;

        // ComponentSlotDeclaration — dynamic import
        if (typeof decl === "object" && "type" in decl && decl.type === "component") {
          const compDecl = decl as ComponentSlotDeclaration;
          return (
            <DynamicSlotComponent
              key={entry.pluginName}
              importUrl={compDecl.importUrl}
              pluginName={entry.pluginName}
              componentProps={componentProps}
            />
          );
        }

        // FormSlotDeclaration — declarative form
        if (typeof decl === "object" && "type" in decl && decl.type === "form") {
          const formDecl = decl as FormSlotDeclaration;
          return (
            <div key={entry.pluginName}>
              <FormSlotRenderer
                declaration={formDecl}
                onChange={(values) => handleFormChange(entry.pluginName, values)}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
