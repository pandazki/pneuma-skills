# Resize Adaptation

Resize is the defining interaction of GridBoard. When a user drags a tile edge, they're asking: "show me what you can do with this space." Your answer should be a transformation, not a reflow.

## The Principle

**Small tiles compress to essence. Large tiles expand to experience.**

A weather tile at 2x2 is a temperature reading. At 4x3 it's a weather station — icons, forecast, atmospheric details. The data is the same; the craft is what changes.

## Size Tiers

Every tile should have at least 3 distinct visual treatments:

| Tier | Pixel Range | Design Goal | Example: Weather |
|------|------------|-------------|-----------------|
| **Compact** | <180px wide or <120px tall | Single key value, zero decoration | `13°C` with city name |
| **Medium** | 180-280px wide, 120-200px tall | Structured data, typographic hierarchy | Temperature + description + humidity/wind stats |
| **Expanded** | >280px wide and >200px tall | Full visual experience with craft | SVG weather icon, temperature-gradient background, detail grid, feels-like, wind direction indicator |

## What Changes Per Tier

### Compact → Medium
- Add secondary data points (humidity, wind, trends)
- Introduce typographic contrast (large number vs small label)
- Add subtle visual indicators (trend arrow SVGs, colored dots)

### Medium → Expanded
This is where most tiles under-deliver. What should change:

- **Add SVG iconography**: Weather conditions, category symbols, status indicators. Not text or emoji — drawn vectors.
- **Add data visualization**: Sparklines, progress arcs, mini charts. The data already exists in `dataSource` — visualize it.
- **Use data-driven color**: Background gradient shifts based on temperature, trend color intensifies with magnitude, category color applied to more elements.
- **Add contextual detail**: Information that was too dense for small sizes — timestamps, comparisons, secondary metrics.
- **Vary the composition**: Don't just add more rows. Change the layout structure — horizontal split, grid within tile, featured element with supporting details around it.

### What does NOT count as adaptation
- Making fonts bigger
- Adding more padding
- Rearranging the same elements in a different direction
- Showing the same layout with wider margins

## Implementation Pattern

```tsx
render({ data, width, height }) {
  const compact = width < 180 || height < 120;
  const medium = !compact && (width < 280 || height < 200);
  const expanded = !compact && !medium;

  if (compact) return <CompactView data={data} />;
  if (medium) return <MediumView data={data} width={width} height={height} />;
  return <ExpandedView data={data} width={width} height={height} />;
}
```

Each view is a separate visual design, not a parametric variation of one design.

## The Screenshot Test

After implementing a resize tier, mentally screenshot it. Would someone looking at this tile say "that's well designed" or "that's just data on a dark background"?

If it's the latter, you haven't finished. Add an SVG icon. Add a data-driven color accent. Add a visualization. Make it feel like someone spent time on it — because you did.
