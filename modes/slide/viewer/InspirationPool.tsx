/**
 * InspirationPool — Curated style preset browser for slide mode.
 *
 * Renders as a modal overlay with a grid of preset cards.
 * Each card shows a color-coded preview, preset name, and description.
 * When the user selects a preset, the theme CSS is fetched and passed
 * to the agent as a design starting point.
 */

import { useState, useEffect, useCallback } from "react";

interface PresetInfo {
  id: string;
  name: string;
  description: string;
  moods: string[];
  fonts: { display: string; body: string };
  preview: { bg: string; accent: string; fg: string };
}

interface InspirationPoolProps {
  open: boolean;
  onClose: () => void;
  onSelect: (presetId: string, presetName: string, themeCSS: string) => void;
  apiBase: string;
}

export default function InspirationPool({ open, onClose, onSelect, apiBase }: InspirationPoolProps) {
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || presets.length > 0) return;
    setLoading(true);
    fetch(`${apiBase}/api/slide-presets`)
      .then((r) => r.json())
      .then((data) => setPresets(data.presets || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, apiBase, presets.length]);

  const handleSelect = useCallback(async (preset: PresetInfo) => {
    try {
      const res = await fetch(`${apiBase}/api/slide-presets/${preset.id}/theme`);
      const { css } = await res.json();
      onSelect(preset.id, preset.name, css || "");
    } catch {
      onSelect(preset.id, preset.name, "");
    }
  }, [apiBase, onSelect]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl w-[720px] max-w-[90vw] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cc-border">
          <div>
            <h2 className="text-sm font-semibold text-cc-fg">Inspiration Pool</h2>
            <p className="text-xs text-cc-muted mt-0.5">Choose a style as a starting point — the agent will adapt it to your content</p>
          </div>
          <button onClick={onClose} className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer p-1 rounded hover:bg-cc-hover">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-cc-muted py-12 text-sm">Loading presets...</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {presets.map((p) => (
                <PresetCard key={p.id} preset={p} onSelect={handleSelect} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset, onSelect }: { preset: PresetInfo; onSelect: (p: PresetInfo) => void }) {
  const isLight = isLightColor(preset.preview.bg);

  return (
    <button
      onClick={() => onSelect(preset)}
      className="group text-left rounded-lg border border-cc-border hover:border-cc-primary/50 transition-all cursor-pointer overflow-hidden"
    >
      {/* Color preview */}
      <div className="h-28 relative overflow-hidden" style={{ background: preset.preview.bg }}>
        {/* Accent bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: preset.preview.accent }} />
        {/* Decorative accent shape */}
        <div
          className="absolute top-3 right-3 w-8 h-8 rounded-full opacity-30"
          style={{ background: preset.preview.accent }}
        />
        {/* Typography preview */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
          <div className="text-xl font-bold tracking-tight" style={{ color: preset.preview.fg }}>Aa</div>
          <div
            className="text-[10px] mt-1.5 font-medium"
            style={{ color: preset.preview.fg, opacity: 0.5 }}
          >
            {preset.fonts.display}
            {preset.fonts.display !== preset.fonts.body && ` + ${preset.fonts.body}`}
          </div>
        </div>
        {/* Mood tags */}
        <div className="absolute bottom-2.5 left-2.5 flex gap-1">
          {preset.moods.map((m) => (
            <span
              key={m}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
                color: preset.preview.fg,
                opacity: 0.7,
              }}
            >
              {m}
            </span>
          ))}
        </div>
      </div>
      {/* Info */}
      <div className="p-3 bg-cc-bg">
        <div className="text-xs font-semibold text-cc-fg group-hover:text-cc-primary transition-colors">{preset.name}</div>
        <div className="text-[11px] text-cc-muted mt-0.5 line-clamp-2">{preset.description}</div>
      </div>
    </button>
  );
}

/** Simple luminance check to determine if a hex color is "light" */
function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}
