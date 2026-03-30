/**
 * InspirationPool — Curated style preset browser for slide mode.
 *
 * Split layout: left scrollable list of compact preset cards,
 * right side shows large preview of the selected preset's slides
 * rendered in iframes with the preset's theme CSS.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface PresetInfo {
  id: string;
  name: string;
  description: string;
  moods: string[];
  fonts: { display: string; body: string };
  preview: { bg: string; accent: string; fg: string };
}

interface PreviewSlide {
  id: string;
  label: string;
  html: string;
}

interface InspirationPoolProps {
  open: boolean;
  onClose: () => void;
  onSelect: (presetId: string, presetName: string, themeCSS: string) => void;
  apiBase: string;
}

export default function InspirationPool({ open, onClose, onSelect, apiBase }: InspirationPoolProps) {
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [previewSlides, setPreviewSlides] = useState<PreviewSlide[]>([]);
  const [themeCSSCache, setThemeCSSCache] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  // Load presets + preview slides on first open
  useEffect(() => {
    if (!open || presets.length > 0) return;
    setLoading(true);
    Promise.all([
      fetch(`${apiBase}/api/slide-presets`).then((r) => r.json()),
      fetch(`${apiBase}/api/slide-presets/preview-slides`).then((r) => r.json()),
    ])
      .then(([presetsData, slidesData]) => {
        const p = presetsData.presets || [];
        setPresets(p);
        setPreviewSlides(slidesData.slides || []);
        if (p.length > 0) setSelectedId(p[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, apiBase, presets.length]);

  // Fetch theme CSS on selection change
  useEffect(() => {
    if (!selectedId || themeCSSCache[selectedId]) return;
    fetch(`${apiBase}/api/slide-presets/${selectedId}/theme`)
      .then((r) => r.json())
      .then(({ css }) => {
        if (css) setThemeCSSCache((prev) => ({ ...prev, [selectedId]: css }));
      })
      .catch(() => {});
  }, [selectedId, apiBase, themeCSSCache]);

  const handleApply = useCallback(async () => {
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) return;
    const css = themeCSSCache[selectedId!] || "";
    onSelect(preset.id, preset.name, css);
  }, [presets, selectedId, themeCSSCache, onSelect]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const selectedPreset = presets.find((p) => p.id === selectedId);
  const currentThemeCSS = selectedId ? themeCSSCache[selectedId] : undefined;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(960px, 90vw)", height: "min(640px, 85vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-cc-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-cc-fg">Inspiration Pool</h2>
            <p className="text-xs text-cc-muted mt-0.5">Browse styles, preview live, then apply</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedPreset && (
              <button
                onClick={handleApply}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-cc-primary text-white hover:bg-cc-primary-hover transition-colors cursor-pointer"
              >
                Apply "{selectedPreset.name}"
              </button>
            )}
            <button onClick={onClose} className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer p-1 rounded hover:bg-cc-hover">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-cc-muted text-sm">Loading presets...</div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Left: preset list */}
            <div className="w-[220px] shrink-0 border-r border-cc-border overflow-y-auto">
              {presets.map((p) => (
                <PresetListItem
                  key={p.id}
                  preset={p}
                  selected={p.id === selectedId}
                  onSelect={() => { setSelectedId(p.id); setActiveSlideIdx(0); }}
                />
              ))}
            </div>

            {/* Right: preview area */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedPreset && currentThemeCSS != null ? (
                <>
                  {/* Slide tab bar */}
                  <div className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0">
                    {previewSlides.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveSlideIdx(i)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          i === activeSlideIdx
                            ? "bg-cc-primary/20 text-cc-primary"
                            : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Live preview iframe */}
                  <div className="flex-1 px-4 pb-4 min-h-0">
                    <div className="w-full h-full rounded-lg overflow-hidden border border-cc-border bg-neutral-900">
                      <SlidePreviewFrame
                        themeCSS={currentThemeCSS}
                        slideHtml={previewSlides[activeSlideIdx]?.html || ""}
                        fonts={selectedPreset.fonts}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-cc-muted text-sm">
                  {selectedId ? "Loading preview..." : "Select a style"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact preset card for the left sidebar list */
function PresetListItem({ preset, selected, onSelect }: { preset: PresetInfo; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-b border-cc-border/50 transition-colors cursor-pointer flex items-start gap-2.5 ${
        selected ? "bg-cc-primary/10" : "hover:bg-cc-hover"
      }`}
    >
      {/* Color swatch */}
      <div
        className="w-8 h-8 rounded-md shrink-0 mt-0.5 relative overflow-hidden"
        style={{ background: preset.preview.bg }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: preset.preview.accent }} />
      </div>
      {/* Text */}
      <div className="min-w-0">
        <div className={`text-xs font-semibold truncate ${selected ? "text-cc-primary" : "text-cc-fg"}`}>
          {preset.name}
        </div>
        <div className="text-[10px] text-cc-muted mt-0.5 line-clamp-2 leading-tight">
          {preset.description}
        </div>
      </div>
    </button>
  );
}

/** Renders a slide in an iframe with the given theme CSS */
function SlidePreviewFrame({ themeCSS, slideHtml, fonts }: { themeCSS: string; slideHtml: string; fonts: { display: string; body: string } }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcdoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${themeCSS}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body {
  font-family: var(--font-sans, system-ui, sans-serif);
  background: var(--color-bg, #0f0f0f);
  color: var(--color-fg, #e8e6df);
  -webkit-font-smoothing: antialiased;
}
.slide {
  width: 1280px;
  height: 720px;
  transform-origin: top left;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
</style>
</head>
<body>
${slideHtml}
<script>
(function(){
  var s = document.querySelector('.slide');
  if (!s) return;
  function fit() {
    var sx = window.innerWidth / 1280;
    var sy = window.innerHeight / 720;
    var scale = Math.min(sx, sy);
    s.style.transform = 'scale(' + scale + ')';
    s.style.position = 'absolute';
    s.style.left = ((window.innerWidth - 1280 * scale) / 2) + 'px';
    s.style.top = ((window.innerHeight - 720 * scale) / 2) + 'px';
  }
  fit();
  window.addEventListener('resize', fit);
})();
<\/script>
</body>
</html>`;
  }, [themeCSS, slideHtml]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      className="w-full h-full border-0"
      sandbox="allow-scripts"
      title="Style preview"
    />
  );
}
