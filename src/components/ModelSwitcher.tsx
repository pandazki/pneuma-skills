import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { sendSetModel } from "../ws.js";
import type { ModelOption } from "../../core/types/agent-backend.js";

/** Derive a short icon string from a model id. */
function modelIcon(id: string): string {
  // Use first meaningful segment, max 2 chars
  const clean = id.replace(/^(openai\/|anthropic\/)/, "");
  const first = clean.split(/[-_]/)[0];
  return first.length <= 3 ? first : first.slice(0, 2);
}

/** Derive a display label from a model id or name. */
function modelLabel(id: string, name?: string): string {
  if (name && name !== id) return name;
  // Strip common prefixes
  return id.replace(/^(openai\/|anthropic\/)/, "");
}

function modelDisplay(modelId: string, models: ModelOption[]): { label: string; icon: string } {
  if (!modelId) return models[0] || { label: "?", icon: "?" };
  // Exact match
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact;
  // Fuzzy match
  const lower = modelId.toLowerCase();
  for (const m of models) {
    if (lower.includes(m.id.toLowerCase()) || lower.includes(m.label.toLowerCase())) {
      return m;
    }
  }
  return { label: modelLabel(modelId), icon: modelIcon(modelId) };
}

export default function ModelSwitcher() {
  const { t } = useTranslation("model-switcher");
  const model = useStore((s) => s.session?.model ?? "");
  const canSwitchModel = useStore((s) => s.session?.agent_capabilities?.modelSwitch ?? false);
  const availableModels = useStore((s) => s.session?.available_models);
  // Static fallback list shipped by the backend manifest. Backends that emit
  // their own list dynamically (codex, kimi-cli) leave this undefined; the
  // dynamic `available_models` branch above takes precedence either way.
  const defaultModels = useStore((s) => s.session?.default_models);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Build model options: use dynamic list from backend if available, else
  // fall back to the manifest-declared static list, else just show current.
  const models: ModelOption[] = useMemo(() => {
    if (availableModels && availableModels.length > 0) {
      return availableModels.map((m) => ({
        id: m.id,
        label: modelLabel(m.id, m.name),
        icon: modelIcon(m.id),
      }));
    }
    if (defaultModels && defaultModels.length > 0) return defaultModels;
    return model ? [{ id: model, label: modelLabel(model), icon: modelIcon(model) }] : [];
  }, [availableModels, defaultModels, model]);

  const current = useMemo(() => modelDisplay(model, models), [model, models]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!canSwitchModel) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-cc-muted bg-cc-user-bubble rounded"
        title={model || t("unavailable_tooltip")}
      >
        <span className="w-4 h-4 rounded bg-cc-fg/10 flex items-center justify-center text-[10px] font-bold text-cc-muted">
          {current.icon}
        </span>
        <span>{current.label}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-cc-fg/70 hover:text-cc-fg bg-cc-user-bubble hover:bg-cc-active rounded transition-colors cursor-pointer"
        title={model || models[0]?.id || ""}
      >
        <span className="w-4 h-4 rounded bg-cc-fg/10 flex items-center justify-center text-[10px] font-bold text-cc-fg/80">
          {current.icon}
        </span>
        <span>{current.label}</span>
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-cc-surface border border-cc-border rounded-md shadow-lg overflow-hidden z-50 max-h-64 overflow-y-auto">
          {models.map((m) => {
            const active = model === m.id || (model && model.toLowerCase().includes(m.label.toLowerCase()));
            return (
              <button
                key={m.id}
                onClick={() => {
                  sendSetModel(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? "bg-cc-active text-cc-fg"
                    : "text-cc-fg/70 hover:bg-cc-hover hover:text-cc-fg"
                }`}
              >
                <span className="w-5 h-4 rounded bg-cc-fg/10 flex items-center justify-center text-[9px] font-bold text-cc-fg shrink-0">
                  {m.icon}
                </span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
