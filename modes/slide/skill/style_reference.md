# Style Reference — Slide Design System

Default design system for Pneuma Slide Mode presentations. Use these conventions when the user has no explicit style preferences.

---

## Default Design Philosophy

**Apple HIG-inspired minimalism**: Clean, professional, spacious. Content speaks for itself.

- Generous whitespace over dense layouts
- Clear visual hierarchy via size, weight, and color
- Subtle depth via shadows and surface colors (not gradients)
- Consistent spacing scale throughout

---

## Color Palettes

### Dark Mode (Default)

```css
:root {
  --color-bg: #0f0f0f;
  --color-fg: #e8e6df;
  --color-primary: #6ea8fe;     /* Blue accent */
  --color-secondary: #a78bfa;   /* Purple secondary */
  --color-accent: #34d399;      /* Green accent */
  --color-muted: #6b7280;       /* Gray for secondary text */
  --color-surface: #1a1a1a;     /* Card/container background */
  --color-border: #2a2a2a;      /* Subtle borders */
}
```

### Light Mode

```css
:root {
  --color-bg: #ffffff;
  --color-fg: #1e293b;          /* Slate-800 */
  --color-primary: #2563eb;     /* Blue-600 */
  --color-secondary: #64748b;   /* Slate-500 */
  --color-accent: #0ea5e9;      /* Sky-500 */
  --color-muted: #94a3b8;       /* Slate-400 */
  --color-surface: #f8fafc;     /* Slate-50 */
  --color-border: #e2e8f0;      /* Slate-200 */
}
```

### Color Usage Rules

| Role | Usage | Proportion |
|------|-------|-----------|
| Background | Slide background, large areas | 60-70% |
| Foreground | Primary text, headings | 20-25% |
| Primary | Accent elements, links, key highlights | 5-10% |
| Muted | Secondary text, captions, metadata | 5-10% |
| Surface | Cards, containers, code blocks | As needed |
| Border | Dividers, card borders | Minimal |

---

## Typography

### Font Stack

```css
--font-sans: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
```

### Size Scale

| Element | Size | Weight | Line Height | Use |
|---------|------|--------|-------------|-----|
| Slide title (h1) | 48px (3rem) | 700 | 1.2 | Cover page main title |
| Page heading (h1) | 36px (2.25rem) | 700 | 1.2 | Content page title |
| Section header (h2) | 28px (1.75rem) | 600 | 1.3 | Subsections |
| Subheading (h3) | 22px (1.375rem) | 600 | 1.4 | Card headers, labels |
| Body text (p) | 20px (1.25rem) | 400 | 1.7 | Paragraphs, descriptions |
| List items (li) | 20px (1.25rem) | 400 | 1.8 | Bullet points |
| Caption/label | 14-16px | 500 | 1.5 | Tags, metadata, footnotes |
| Small text | 12-14px | 400 | 1.5 | Barely used — minimum readable |

### Typography Rules

- **Minimum body text**: 18px — anything smaller is hard to read on projected slides
- **Maximum title**: 56px — larger titles on cover pages only
- **Letter spacing**: -0.02em for headings, default for body
- **Font smoothing**: Always use `-webkit-font-smoothing: antialiased`

---

## Spacing System

### Slide Padding

```css
--slide-padding: 64px;  /* Default content page padding */
```

- **Cover pages**: 0px or custom (full-bleed backgrounds)
- **Content pages**: 64px all sides → 1152×592px available area (for 1280×720 canvas)

### Gap Scale

| Token | Size | Use |
|-------|------|-----|
| xs | 8px | Between related inline items |
| sm | 16px | Between list items, tight groups |
| md | 24px | Between content sections |
| lg | 32px | Between major blocks |
| xl | 48px | Between split columns, hero spacing |

### Margin Patterns

- Between heading and first content: 16-24px
- Between content paragraphs: 12-16px
- Between cards in a grid: 16-24px
- Between major sections: 32-48px

---

## Visual Elements

### Cards

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;       /* rounded-lg */
  padding: 24px;
  /* Optional shadow for depth: */
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
```

### Tags / Badges

```css
.tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 6px;        /* rounded-md */
  font-size: 13px;
  font-weight: 500;
  background: var(--color-primary);
  color: white;
}
```

### Dividers

```css
.divider {
  height: 1px;
  background: var(--color-border);
  margin: 24px 0;
}
```

### Icon Usage

- Use **Lucide icons** (CDN) or **inline SVG** for consistency
- Icon size: 20-24px for inline, 32-48px for feature icons
- **Never use emoji** for professional presentations
- Color icons with `var(--color-primary)` or `var(--color-muted)`

### Chart Guidelines (ECharts)

When including data visualizations:
- Initialize with explicit width/height matching the container
- Use the deck's color palette for chart colors
- Include clear axis labels and legends
- Prefer bar/line charts for trends, pie/donut for composition
- Add a `<div id="chart-{n}" style="width: 100%; height: Xpx;"></div>` container
- Initialize with `<script>` at the end of the slide fragment

---

## Layout Templates

### Cover Page

Full-canvas, centered, minimal:
```
┌──────────────────────────────────────────┐
│                                          │
│              [Tag/Label]                 │
│                                          │
│         Main Title (48px)                │
│                                          │
│         Subtitle (20px, muted)           │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

### Single Column Content

Standard for text-heavy slides:
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  • Bullet point one                      │
│  • Bullet point two                      │
│  • Bullet point three                    │
│  • Bullet point four                     │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

### Two-Column Split

For comparison, feature + detail, or text + image:
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  ┌──────────────┐  ┌──────────────┐     │
│  │  Left Column │  │ Right Column │     │
│  │  Text/list   │  │ Image/chart  │     │
│  │              │  │              │     │
│  └──────────────┘  └──────────────┘     │
│                                          │
└──────────────────────────────────────────┘
```

### Card Grid

For 3-4 equal items (features, team, metrics):
```
┌──────────────────────────────────────────┐
│  Page Heading (h2)                       │
│                                          │
│  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │ Card │  │ Card │  │ Card │          │
│  │  1   │  │  2   │  │  3   │          │
│  └──────┘  └──────┘  └──────┘          │
│                                          │
└──────────────────────────────────────────┘
```

### Full Visual

Image or chart dominates, minimal text:
```
┌──────────────────────────────────────────┐
│  ┌──────────────────────────────────┐    │
│  │                                  │    │
│  │        Large Image/Chart         │    │
│  │                                  │    │
│  └──────────────────────────────────┘    │
│  Caption or source (small, muted)        │
└──────────────────────────────────────────┘
```
