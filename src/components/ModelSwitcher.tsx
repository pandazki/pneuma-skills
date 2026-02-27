import { useState, useRef, useEffect } from "react";
import { useStore } from "../store.js";
import { sendSetModel } from "../ws.js";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet", icon: "S" },
  { id: "claude-opus-4-6", label: "Opus", icon: "O" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku", icon: "H" },
];

function modelDisplay(modelId: string): { label: string; icon: string } {
  const found = MODELS.find((m) => modelId.includes(m.id.split("-").slice(1, 2)[0]));
  if (found) return found;
  // Fuzzy match: check if model string contains sonnet/opus/haiku
  if (modelId.toLowerCase().includes("sonnet")) return { label: "Sonnet", icon: "S" };
  if (modelId.toLowerCase().includes("opus")) return { label: "Opus", icon: "O" };
  if (modelId.toLowerCase().includes("haiku")) return { label: "Haiku", icon: "H" };
  return { label: modelId.split("-").slice(0, 2).join("-"), icon: "?" };
}

export default function ModelSwitcher() {
  const model = useStore((s) => s.session?.model ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = modelDisplay(model);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
        title={model}
      >
        <span className="w-4 h-4 rounded bg-neutral-700 flex items-center justify-center text-[10px] font-bold text-neutral-300">
          {current.icon}
        </span>
        <span>{current.label}</span>
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 bg-neutral-800 border border-neutral-700 rounded-md shadow-lg overflow-hidden z-50">
          {MODELS.map((m) => {
            const active = model.includes(m.id.split("-").slice(1, 2)[0]) || model === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  sendSetModel(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                  active
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-750 hover:text-neutral-200"
                }`}
              >
                <span className="w-5 h-5 rounded bg-neutral-600 flex items-center justify-center text-[11px] font-bold text-neutral-200">
                  {m.icon}
                </span>
                <span>{m.label}</span>
                <span className="ml-auto text-neutral-600 text-[10px]">{m.id}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
