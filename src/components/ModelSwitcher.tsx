import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.js";
import { sendSetModel } from "../ws.js";
import type { ModelOption } from "../../core/types/agent-backend.js";

/**
 * Derive a short icon string from a model id, or from its display name when
 * the backend supplies one. Names are the friendlier source — Claude Code
 * reports "Opus (1M context)" / "Fable", whose initial reads far better than
 * the "cl" you'd get from slicing `claude-fable-5[1m]`.
 */
function modelIcon(id: string, name?: string): string {
  const initial = name?.trim().match(/[a-z0-9]/i)?.[0];
  if (initial) return initial.toUpperCase();
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

/**
 * A picker entry. `resolvedId` is present when the backend lists an alias
 * (`opus`, `default`) whose concrete model differs from the id we send back on
 * `set_model` — matching against it is what keeps the active entry highlighted
 * after `system.init` reports the resolved name.
 */
type SwitcherModel = ModelOption & { resolvedId?: string };

/**
 * Resolve the backend-reported model id to exactly one picker entry, in
 * descending confidence: the id we'd send back on `set_model`, then the model
 * an alias resolves to, then a loose substring guess. Single-winner by design
 * — Claude Code lists several aliases (`default`, `opus[1m]`) that resolve to
 * the same model, and highlighting all of them would read as broken.
 */
function findModel(modelId: string, models: SwitcherModel[]): SwitcherModel | undefined {
  if (!modelId) return undefined;
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact;
  const resolved = models.find((m) => m.resolvedId === modelId);
  if (resolved) return resolved;
  const lower = modelId.toLowerCase();
  return models.find(
    (m) => lower.includes(m.id.toLowerCase()) || lower.includes(m.label.toLowerCase()),
  );
}

function modelDisplay(modelId: string, models: SwitcherModel[]): { label: string; icon: string } {
  if (!modelId) return models[0] || { label: "?", icon: "?" };
  return findModel(modelId, models) ?? { label: modelLabel(modelId), icon: modelIcon(modelId) };
}

export default function ModelSwitcher() {
  const { t } = useTranslation("model-switcher");
  const model = useStore((s) => s.session?.model ?? "");
  const canSwitchModel = useStore((s) => s.session?.agent_capabilities?.modelSwitch ?? false);
  const availableModels = useStore((s) => s.session?.available_models);
  // Static fallback list shipped by the backend manifest. Every backend now
  // reports its real list over the wire — codex/kimi via their model-list RPCs,
  // claude-code via the `initialize` control response — so this only surfaces
  // when that probe finds nothing (e.g. a CLI too old to answer).
  const defaultModels = useStore((s) => s.session?.default_models);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Build model options: use dynamic list from backend if available, else
  // fall back to the manifest-declared static list, else just show current.
  const models: SwitcherModel[] = useMemo(() => {
    if (availableModels && availableModels.length > 0) {
      return availableModels.map((m) => ({
        id: m.id,
        label: modelLabel(m.id, m.name),
        icon: modelIcon(m.id, m.name),
        ...(m.resolvedId ? { resolvedId: m.resolvedId } : {}),
      }));
    }
    if (defaultModels && defaultModels.length > 0) return defaultModels;
    return model ? [{ id: model, label: modelLabel(model), icon: modelIcon(model) }] : [];
  }, [availableModels, defaultModels, model]);

  const current = useMemo(() => modelDisplay(model, models), [model, models]);
  const activeId = useMemo(() => findModel(model, models)?.id, [model, models]);

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
            const active = m.id === activeId;
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
