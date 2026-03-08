# Excalidraw Element Types — JSON Reference

This document contains the full JSON schema for Excalidraw element types. Consult this when you need exact property names and structures.

## Common Properties

All elements share these properties:

```json
{
  "id": "unique-id",
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 200,
  "height": 100,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "roundness": { "type": 3 },
  "isDeleted": false,
  "boundElements": null,
  "groupIds": [],
  "seed": 12345,
  "version": 1
}
```

## Text Properties

```json
{
  "type": "text",
  "text": "Hello World",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle"
}
```

Font families: `1` = Virgil (hand-drawn), `2` = Helvetica, `3` = Cascadia (monospace)

## Line/Arrow Points

Lines and arrows use relative point arrays — each point is `[dx, dy]` relative to the element's `(x, y)`:

```json
{
  "type": "arrow",
  "x": 100,
  "y": 200,
  "points": [[0, 0], [200, 0], [200, 100]],
  "startArrowhead": null,
  "endArrowhead": "arrow"
}
```

## Binding (Connecting Arrows to Shapes)

To connect an arrow to shapes, set `startBinding`/`endBinding` on the arrow:

```json
{
  "type": "arrow",
  "startBinding": {
    "elementId": "shape-id-1",
    "focus": 0,
    "gap": 5,
    "fixedPoint": null
  },
  "endBinding": {
    "elementId": "shape-id-2",
    "focus": 0,
    "gap": 5,
    "fixedPoint": null
  }
}
```

The bound shape must also reference the arrow back (bidirectional):
```json
{
  "id": "shape-id-1",
  "type": "rectangle",
  "boundElements": [{ "id": "arrow-id", "type": "arrow" }]
}
```

## Text Bound to Shapes (Labels)

To put text inside a shape, create both elements with cross-references:

1. The shape references the text in `boundElements`
2. The text references the shape in `containerId`

```json
{
  "id": "box-1",
  "type": "rectangle",
  "boundElements": [{ "id": "text-1", "type": "text" }]
}
```
```json
{
  "id": "text-1",
  "type": "text",
  "containerId": "box-1",
  "text": "Label",
  "textAlign": "center",
  "verticalAlign": "middle"
}
```
