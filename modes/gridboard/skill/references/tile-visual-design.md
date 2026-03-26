# Tile Visual Design

Tiles are small, self-contained interfaces. Every pixel matters because the canvas is shared. A well-designed tile draws the eye without demanding it.

## Inline SVG as Primary Visual Tool

Tiles run in isolated Shadow DOM — no external icon libraries, no image requests. Inline SVG in JSX is your only visual primitive, and it's a powerful one.

**When to use SVG:**
- Weather condition icons (sun, cloud, rain, snow, lightning)
- Trend arrows and directional indicators
- Progress rings, gauges, and arcs
- Sparklines and mini charts
- Category badges and status dots
- Decorative accents (subtle background patterns, dividers)

**SVG sizing rules:**
- Use `viewBox` for scalability, set `width`/`height` in pixels
- Match `stroke="currentColor"` or use CSS variables for theme integration
- `strokeWidth` between 1.5-2 for icons at 16-24px; thinner at larger sizes

**Example — weather condition icon:**
```tsx
function SunIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="5" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 12 + 8 * Math.cos(rad), y1 = 12 + 8 * Math.sin(rad);
        const x2 = 12 + 10 * Math.cos(rad), y2 = 12 + 10 * Math.sin(rad);
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </svg>
  );
}
```

## Data-Driven Color

Color should respond to the data it represents, not be decorative by default.

| Data Type | Color Strategy |
|-----------|---------------|
| Temperature | Warm-to-cool gradient: amber at high, blue at low |
| Positive/negative | `var(--success)` / `var(--error)` — semantic, not arbitrary |
| Categories | Deterministic hue from category name hash — consistent across renders |
| Progress | Single accent color at varying opacity: 100% filled, 20% remaining |
| Severity | Intensity scaling: muted for info, saturated for critical |

**Don't** assign colors randomly. **Don't** use more than 3-4 colors in a single tile. **Don't** use color as the only differentiator — pair with shape or position.

**Color within theme constraints:**
```tsx
// Temperature-driven background
const tempColor = temp > 30 ? "rgba(249,115,22,0.08)"
                : temp > 20 ? "rgba(234,179,8,0.06)"
                : temp > 10 ? "rgba(59,130,246,0.05)"
                : "rgba(96,165,250,0.08)";
```

## Typography in Tiles

Tile typography serves a single purpose: make data scannable at a glance.

**Hierarchy pattern:**
1. **Primary value** — largest, boldest, `var(--font-mono)`. The number the user came to see.
2. **Label** — small, muted, `var(--font-family)`. Identifies what the value is.
3. **Secondary data** — medium, `var(--text-secondary)`. Supporting context.
4. **Metadata** — smallest, `var(--text-muted)`. Timestamps, sources, units.

**Concrete sizes:**
| Tier | Font Size | Weight | Color |
|------|-----------|--------|-------|
| Primary value | 1.5-3rem (scales with tile) | 700 | `var(--text-primary)` |
| Label | 0.6-0.75rem | 400-500 | `var(--text-muted)` |
| Secondary | 0.75-0.9rem | 500 | `var(--text-secondary)` |
| Metadata | 0.55-0.65rem | 400 | `var(--text-muted)` |

**Don't** use more than 3 font sizes in a compact tile. **Don't** center-align data tiles — left or right alignment creates cleaner scan lines.

## Data Visualization Patterns

All visualization is inline SVG. No libraries, no canvas — just `<svg>` in JSX.

### Sparkline
```tsx
function Sparkline({ values, width, height, color }: Props) {
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) =>
    `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

### Progress Arc
```tsx
function Arc({ value, max, size, color }: Props) {
  const pct = Math.min(value / max, 1);
  const r = (size - 4) / 2, c = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }}>
      <circle cx={c} cy={c} r={r} fill="none"
        stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
      <circle cx={c} cy={c} r={r} fill="none"
        stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={dashoffset} />
    </svg>
  );
}
```

### Mini Bar Chart
```tsx
function Bars({ values, width, height, color }: Props) {
  const max = Math.max(...values) || 1;
  const barW = Math.max(2, (width / values.length) * 0.7);
  const gap = (width - barW * values.length) / (values.length - 1 || 1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {values.map((v, i) => {
        const h = (v / max) * height;
        return <rect key={i} x={i * (barW + gap)} y={height - h}
          width={barW} height={h} rx={1} fill={color} opacity={0.7 + 0.3 * (v / max)} />;
      })}
    </svg>
  );
}
```

## Anti-Patterns

- **Emoji as icons**: They render inconsistently across platforms and look unpolished. Draw SVG.
- **Generic rounded cards**: Every tile already has a border from the grid. Don't add another card inside.
- **Decoration without data**: A gradient background that doesn't represent anything is visual noise.
- **Same layout every time**: If your weather tile looks like your stock tile looks like your todo tile, the design language is too homogeneous.
