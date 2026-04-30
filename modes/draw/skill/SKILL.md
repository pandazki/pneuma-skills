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

## Working with the viewer

The draw viewer is an Excalidraw canvas. It renders one `.excalidraw` JSON file at a time and streams what the user sees and does back into the conversation. Four channels matter for this mode:

### Reading what the user sees

Each user turn arrives wrapped with a `<viewer-context>` block describing the current canvas state. For draw, it carries:

- The active `.excalidraw` file path (the canvas only renders one file at a time).
- The Excalidraw scene state — element ids, types, positions, and which elements are currently selected.
- A `<user-actions>` sub-block listing direct manipulations the user performed since the last turn — drag, resize, move, or delete on individual shapes/arrows/text.

Read it before you edit. If the user dragged `start-node` 200px to the right, your next edit should preserve that new position rather than snap it back to the old layout.

### Locator cards

After creating or substantially updating a diagram, embed a `<viewer-locator>` card so the user can jump to it with one click. The `data` attribute is a JSON object; the only key draw understands is `file` (workspace-relative path to the `.excalidraw` file).

```html
<viewer-locator data='{"file":"architecture.excalidraw"}'>Architecture diagram</viewer-locator>
```

For multi-file work (e.g. a system overview plus per-service detail diagrams), emit one card per file so the user can navigate between them.

### Viewer actions

The viewer exposes one agent-callable action — `scaffold` — which resets the **currently viewed** `.excalidraw` file to an empty canvas. Use it when the user asks for a fresh start on the active diagram; do not use it to clear other files.

```bash
curl -X POST "$PNEUMA_API/api/viewer/action" \
  -H "Content-Type: application/json" \
  -d '{"action":"scaffold","params":{}}'
```

After scaffold, write your new elements into the active file as a normal edit — the canvas re-renders from the JSON you produce.

## Core Rules

- Edit `.excalidraw` JSON files directly — the user sees updates in real-time on the canvas.
- Ensure **bidirectional binding** on every connection: arrows reference shapes AND shapes reference arrows. If only one side is set, the connection breaks the moment the user drags or resizes.
- Generate unique element `id`s and random `seed`s. Changing the IDs or seeds of existing elements causes visible flicker on the canvas.
- Don't ask for confirmation on simple edits — just do them.

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
