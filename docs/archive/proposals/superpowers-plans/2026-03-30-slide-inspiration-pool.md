# Slide Inspiration Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Inspiration Pool" panel to the slide viewer that shows curated style presets with thumbnails, letting users who don't know what they want discover a style visually — while keeping the agent's creative freedom as the default path.

**Architecture:** Presets are static data (JSON + CSS files) packaged inside `modes/slide/skill/presets/`. A new `InspirationPool` React component renders as a toggleable overlay panel in the viewer. When the user selects a preset, the viewer sends a notification to the agent with the preset's theme CSS content, which the agent uses as a design starting point.

**Tech Stack:** React 19, Tailwind CSS 4, existing viewer contract (`onNotifyAgent`)

---

### Task 1: Create Preset Data Files

**Files:**
- Create: `modes/slide/skill/presets/index.json`
- Create: `modes/slide/skill/presets/themes/bold-signal.css`
- Create: `modes/slide/skill/presets/themes/electric-studio.css`
- Create: `modes/slide/skill/presets/themes/creative-voltage.css`
- Create: `modes/slide/skill/presets/themes/dark-botanical.css`
- Create: `modes/slide/skill/presets/themes/notebook-tabs.css`
- Create: `modes/slide/skill/presets/themes/neon-cyber.css`
- Create: `modes/slide/skill/presets/themes/swiss-modern.css`
- Create: `modes/slide/skill/presets/themes/paper-ink.css`

- [ ] **Step 1: Create `index.json` with 8 presets**

```json
[
  {
    "id": "bold-signal",
    "name": "Bold Signal",
    "description": "Confident, bold, modern — colored card on dark gradient with large section numbers",
    "moods": ["confident", "bold"],
    "fonts": { "display": "Archivo Black", "body": "Space Grotesk" },
    "preview": { "bg": "#1a1a1a", "accent": "#FF5722", "fg": "#ffffff" }
  },
  {
    "id": "electric-studio",
    "name": "Electric Studio",
    "description": "Bold, clean, professional — split panel with white top and blue bottom",
    "moods": ["confident", "professional"],
    "fonts": { "display": "Manrope", "body": "Manrope" },
    "preview": { "bg": "#0a0a0a", "accent": "#4361ee", "fg": "#ffffff" }
  },
  {
    "id": "creative-voltage",
    "name": "Creative Voltage",
    "description": "Bold, creative, energetic — electric blue with neon yellow accents",
    "moods": ["energized", "creative"],
    "fonts": { "display": "Syne", "body": "Space Mono" },
    "preview": { "bg": "#1a1a2e", "accent": "#0066ff", "fg": "#ffffff" }
  },
  {
    "id": "dark-botanical",
    "name": "Dark Botanical",
    "description": "Elegant, sophisticated, premium — serif on dark with warm accents",
    "moods": ["inspired", "elegant"],
    "fonts": { "display": "Cormorant", "body": "IBM Plex Sans" },
    "preview": { "bg": "#0f0f0f", "accent": "#d4a574", "fg": "#e8e4df" }
  },
  {
    "id": "notebook-tabs",
    "name": "Notebook Tabs",
    "description": "Editorial, organized, tactile — cream paper card with colorful section tabs",
    "moods": ["calm", "organized"],
    "fonts": { "display": "Bodoni Moda", "body": "DM Sans" },
    "preview": { "bg": "#2d2d2d", "accent": "#98d4bb", "fg": "#1a1a1a" }
  },
  {
    "id": "neon-cyber",
    "name": "Neon Cyber",
    "description": "Futuristic, techy, confident — deep navy with cyan glow and grid patterns",
    "moods": ["energized", "bold"],
    "fonts": { "display": "Clash Display", "body": "Satoshi" },
    "preview": { "bg": "#0a0f1c", "accent": "#00ffcc", "fg": "#ffffff" }
  },
  {
    "id": "swiss-modern",
    "name": "Swiss Modern",
    "description": "Clean, precise, Bauhaus-inspired — pure white, pure black, red accent",
    "moods": ["calm", "professional"],
    "fonts": { "display": "Archivo", "body": "Nunito" },
    "preview": { "bg": "#ffffff", "accent": "#ff3300", "fg": "#000000" }
  },
  {
    "id": "paper-ink",
    "name": "Paper & Ink",
    "description": "Editorial, literary, thoughtful — warm cream with charcoal and crimson",
    "moods": ["inspired", "calm"],
    "fonts": { "display": "Cormorant Garamond", "body": "Source Serif 4" },
    "preview": { "bg": "#faf9f7", "accent": "#c41e3a", "fg": "#1a1a1a" }
  }
]
```

- [ ] **Step 2: Create theme CSS files**

Each theme CSS follows Pneuma's `--color-*` / `--font-*` variable convention. Create all 8 files. Example for `bold-signal.css`:

```css
/* Bold Signal — Confident, bold, modern */
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&display=swap');

:root {
  --color-bg: #1a1a1a;
  --color-fg: #ffffff;
  --color-primary: #FF5722;
  --color-secondary: #FF8A65;
  --color-accent: #FFD740;
  --color-muted: rgba(255, 255, 255, 0.5);
  --color-surface: #2d2d2d;
  --color-border: rgba(255, 255, 255, 0.1);
  --font-sans: "Space Grotesk", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;
  --slide-padding: 64px;
}

h1, h2, h3 {
  font-family: "Archivo Black", var(--font-sans);
}
```

Create similar files for all 8 presets, mapping frontend-slides' color/font specs to our CSS variable format. Each file should include the Google Fonts `@import` and set all standard `--color-*` and `--font-*` variables.

- [ ] **Step 3: Commit**

```bash
git add modes/slide/skill/presets/
git commit -m "feat(slide): add inspiration pool preset data (8 styles)"
```

---

### Task 2: Create InspirationPool Component

**Files:**
- Create: `modes/slide/viewer/InspirationPool.tsx`

- [ ] **Step 1: Create the InspirationPool component**

A panel component that displays preset cards in a grid. Each card shows a color-coded placeholder thumbnail (using the preset's `preview` colors), the preset name, and the description.

```tsx
import { useState, useEffect } from "react";

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
  onSelect: (presetId: string, themeCSS: string) => void;
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

  const handleSelect = async (preset: PresetInfo) => {
    try {
      const res = await fetch(`${apiBase}/api/slide-presets/${preset.id}/theme`);
      const { css } = await res.json();
      onSelect(preset.id, css);
    } catch {
      // fallback: select without CSS
      onSelect(preset.id, "");
    }
  };

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
          <button onClick={onClose} className="text-cc-muted hover:text-cc-fg transition-colors cursor-pointer p-1">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center text-cc-muted py-12 text-sm">Loading presets...</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className="group text-left rounded-lg border border-cc-border hover:border-cc-primary/50 transition-all cursor-pointer overflow-hidden"
                >
                  {/* Color preview placeholder */}
                  <div
                    className="h-28 relative overflow-hidden"
                    style={{ background: p.preview.bg }}
                  >
                    {/* Accent bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: p.preview.accent }} />
                    {/* Typography preview */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
                      <div className="text-lg font-bold tracking-tight" style={{ color: p.preview.fg }}>Aa</div>
                      <div className="text-[10px] mt-1 opacity-60" style={{ color: p.preview.fg }}>
                        {p.fonts.display} + {p.fonts.body}
                      </div>
                    </div>
                  </div>
                  {/* Info */}
                  <div className="p-3 bg-cc-bg">
                    <div className="text-xs font-semibold text-cc-fg group-hover:text-cc-primary transition-colors">{p.name}</div>
                    <div className="text-[11px] text-cc-muted mt-0.5 line-clamp-2">{p.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add modes/slide/viewer/InspirationPool.tsx
git commit -m "feat(slide): add InspirationPool viewer component"
```

---

### Task 3: Add Server API for Preset Data

**Files:**
- Modify: `server/index.ts`

The presets data (JSON + CSS) lives in `modes/slide/skill/presets/`. The server needs two endpoints to serve them to the viewer.

- [ ] **Step 1: Add preset API routes**

In `server/index.ts`, inside the non-launcher mode block (where session routes live), add:

```typescript
// ── Slide Preset API ──────────────────────────────────────────────────────
app.get("/api/slide-presets", async (c) => {
  try {
    const presetsPath = join(import.meta.dirname, "../modes/slide/skill/presets/index.json");
    const data = await Bun.file(presetsPath).text();
    return c.json({ presets: JSON.parse(data) });
  } catch {
    return c.json({ presets: [] });
  }
});

app.get("/api/slide-presets/:id/theme", async (c) => {
  const id = c.req.param("id");
  // Sanitize: only allow alphanumeric + hyphens
  if (!/^[a-z0-9-]+$/.test(id)) return c.json({ error: "Invalid preset ID" }, 400);
  try {
    const cssPath = join(import.meta.dirname, `../modes/slide/skill/presets/themes/${id}.css`);
    const css = await Bun.file(cssPath).text();
    return c.json({ css });
  } catch {
    return c.json({ error: "Preset not found" }, 404);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/index.ts
git commit -m "feat(slide): add server API for slide presets"
```

---

### Task 4: Integrate InspirationPool into SlidePreview

**Files:**
- Modify: `modes/slide/viewer/SlidePreview.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `SlidePreview.tsx`, add the import:

```typescript
import InspirationPool from "./InspirationPool.js";
```

Inside the main `SlidePreview` component function, add state:

```typescript
const [showInspirationPool, setShowInspirationPool] = useState(false);
```

- [ ] **Step 2: Add the InspirationPool handler**

Add a handler that sends the selected preset to the agent via `onNotifyAgent`:

```typescript
const handlePresetSelect = useCallback((presetId: string, themeCSS: string) => {
  setShowInspirationPool(false);
  if (onNotifyAgent) {
    onNotifyAgent({
      type: "inspirationPreset",
      message: `User selected style preset "${presetId}" from the Inspiration Pool. The theme CSS for this preset is provided below. Use it as a design starting point — adapt the colors, fonts, and styling to the user's content based on your design knowledge. Do not apply it mechanically.\n\n<preset-theme-css>\n${themeCSS}\n</preset-theme-css>`,
      summary: `Style preset selected: ${presetId}`,
    });
  }
}, [onNotifyAgent]);
```

- [ ] **Step 3: Add the lightbulb button to SlideToolbar**

Pass `showInspirationPool` state and toggle to `SlideToolbar`. In the toolbar's right section, before the grid/fullscreen buttons, add:

```tsx
<button
  onClick={onToggleInspirationPool}
  className={`flex items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer ${
    showInspirationPool ? "bg-cc-primary/20 text-cc-primary" : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
  }`}
  title="Inspiration Pool — browse style presets"
>
  <LightbulbIcon />
</button>
<div className="w-px h-4 bg-cc-border" />
```

Add `LightbulbIcon` to the icons section:

```tsx
function LightbulbIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M6 14h4M6.5 12h3M8 1a5 5 0 013 9c-.4.4-.8 1.1-1 2H6c-.2-.9-.6-1.6-1-2A5 5 0 018 1z" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Render the InspirationPool component**

Before the `</div>` closing the main SlidePreview container, add:

```tsx
<InspirationPool
  open={showInspirationPool}
  onClose={() => setShowInspirationPool(false)}
  onSelect={handlePresetSelect}
  apiBase={apiBase}
/>
```

Where `apiBase` comes from the existing `getApiBase()` utility used elsewhere in the viewer.

- [ ] **Step 5: Add apiBase resolution**

Add `apiBase` computation at the top of the component (if not already present):

```typescript
const apiBase = useMemo(() => {
  const port = new URLSearchParams(window.location.search).get("port");
  return port ? `http://localhost:${port}` : "";
}, []);
```

- [ ] **Step 6: Commit**

```bash
git add modes/slide/viewer/SlidePreview.tsx
git commit -m "feat(slide): integrate InspirationPool into viewer toolbar"
```

---

### Task 5: Update SKILL.md for Agent Awareness

**Files:**
- Modify: `modes/slide/skill/SKILL.md`

- [ ] **Step 1: Add Inspiration Pool section to SKILL.md**

After the "Workflow: Editing an Existing Deck" section, add:

```markdown
---

## Inspiration Pool (Style Presets)

The viewer includes an **Inspiration Pool** — a panel of curated style presets the user can browse when they need design direction. This is opt-in; most users will describe their vision directly.

When the user selects a preset, you receive a notification with:
- The preset name (e.g. "Bold Signal", "Dark Botanical")
- A `<preset-theme-css>` block containing the preset's theme.css

**How to use preset selections:**
1. Read the provided theme CSS as a **design reference**, not a template to copy verbatim
2. Apply the color palette and font choices to the current deck's `theme.css`
3. Adapt the styling to fit the content — a preset designed for bold keynotes may need adjustment for a data-heavy deck
4. Follow the design principles in `{SKILL_PATH}/references/design-guide.md` to make informed adaptations
5. If the deck already has slides, update them to match the new theme

**Do NOT** mechanically copy-paste the preset CSS. The presets are starting points that should be interpreted through the lens of the user's content and purpose.
```

- [ ] **Step 2: Commit**

```bash
git add modes/slide/skill/SKILL.md
git commit -m "feat(slide): document Inspiration Pool in agent skill"
```

---

### Task 6: Build, Test, Verify

- [ ] **Step 1: Run the build**

```bash
bun run build
```

Expected: Build succeeds with no new errors.

- [ ] **Step 2: Start dev server and verify**

```bash
bun run dev slide
```

1. Open the slide viewer in browser
2. Verify the lightbulb icon appears in the toolbar
3. Click it — the Inspiration Pool panel should open
4. Verify all 8 presets load with color previews
5. Click a preset — panel closes, agent receives the notification

- [ ] **Step 3: Final commit and push**

```bash
git push origin feat/slide-inspiration-pool
```
