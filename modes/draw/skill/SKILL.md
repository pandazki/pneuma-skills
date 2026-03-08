---
name: pneuma-draw
description: >
  Pneuma Draw Mode workspace guidelines. Use for ANY task in this workspace:
  creating or editing diagrams, flowcharts, wireframes, mind maps, architecture diagrams,
  org charts, sketches, or any visual content on the Excalidraw canvas.
  This skill defines the Excalidraw JSON format, element types, binding rules, and color palette.
  Consult before your first edit in a new conversation.
---

# Pneuma Draw Mode — Excalidraw Skill

You are an expert at creating and editing Excalidraw diagrams. The user sees your changes live on an Excalidraw canvas in their browser.

## Credits

This mode uses [Excalidraw](https://excalidraw.com) — an open-source, MIT-licensed virtual whiteboard by the Excalidraw team.

## File Format

Excalidraw files use `.excalidraw` extension and are JSON:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

## Element Types

| Type | Extra Properties | Usage |
|------|-----------------|-------|
| `rectangle` | `roundness` | Boxes, containers, cards |
| `ellipse` | — | Circles, ovals, bubbles |
| `diamond` | — | Decision nodes, conditions |
| `line` | `points`, `startBinding`, `endBinding` | Lines, connectors |
| `arrow` | `points`, `startBinding`, `endBinding` | Directed connections |
| `text` | `text`, `fontSize`, `fontFamily`, `textAlign` | Labels, annotations |
| `freedraw` | `points`, `simulatePressure` | Freehand sketches |
| `image` | `fileId`, `status` | Embedded images |
| `frame` | — | Grouping frames |

For full JSON schema of each type (common properties, text properties, line/arrow point arrays, binding mechanics), read `{SKILL_PATH}/references/element-types.md`.

## Binding

Excalidraw requires **bidirectional binding** — if only the arrow references the shape but not vice versa, the connection breaks when the user interacts with the canvas. Always set both:
- Arrow's `startBinding`/`endBinding` → references shape IDs
- Shape's `boundElements` → references arrow ID

Same pattern for text inside shapes: shape's `boundElements` references the text, text's `containerId` references the shape.

## Colors

### Stroke Colors
- `#1e1e1e` — Black (default)
- `#e03131` — Red
- `#2f9e44` — Green
- `#1971c2` — Blue
- `#f08c00` — Orange
- `#6741d9` — Purple

### Background Colors
- `transparent` — None (default)
- `#ffc9c9` — Light red
- `#b2f2bb` — Light green
- `#a5d8ff` — Light blue
- `#ffec99` — Light yellow
- `#d0bfff` — Light purple

## ID Generation

Each element needs a unique `id`. Use descriptive IDs like `"start-node"`, `"arrow-1"`, `"label-process"`. The `seed` field should be a random integer — Excalidraw uses it for hand-drawn rendering variations, so different seeds give different "wobble" patterns.

## Common Patterns

### Flowchart
1. Create shape elements (rectangles, diamonds) positioned in a grid
2. Add text labels bound to each shape
3. Connect shapes with arrows using bindings

### Wireframe
1. Use rectangles for containers and sections
2. Add text for labels and placeholder content
3. Use lines for dividers
4. Set `roughness: 0` for clean wireframes — the hand-drawn look doesn't suit UI mockups

### Mind Map
1. Central ellipse or rectangle
2. Lines/arrows radiating outward
3. Text labels at each node

## Tips

- Position elements on multiples of 20-40 — this aligns with Excalidraw's snap grid and produces clean diagrams
- Keep 40-60px gaps between connected elements — tighter gaps make arrows hard to see, wider gaps waste canvas space
- Use `roundness: { "type": 3 }` for rounded rectangles
- Set `roughness: 0` for clean/professional look, `1` for hand-drawn style
- Always generate unique `id` values and random `seed` values
- When modifying existing diagrams, preserve unchanged elements exactly — changing IDs or seeds causes visual flicker on the canvas
