# draw.io XML Reference

Detailed reference for XML structure, edge routing, containers, layers, tags, metadata, and dark mode. Consult this when generating draw.io XML diagrams.

## General Principles

- **Use semantically correct shapes** — `shape=cylinder3` for databases, `rhombus` for decisions, `umlActor` for UML actors. draw.io has extensive shape libraries; prefer domain-appropriate shapes over generic rectangles.
- **Decide whether to use stencil shapes** — skip `shape=mxgraph.*` for standard diagrams (flowcharts, UML, ER, org charts, mind maps using basic geometric shapes). Use stencil shapes when the user needs cloud architecture icons (AWS, Azure, GCP), network topology (Cisco), Kubernetes, BPMN, or other domain-specific symbols.
- **Match diagram language to the user's language** — all labels, titles, and annotations should match the language the user is writing in.

## File Structure

```xml
<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100"
                  math="0" shadow="0" adaptiveColors="auto">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- diagram elements with parent="1" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

`adaptiveColors="auto"` enables automatic dark mode color inversion — always include it.

## mxCell Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Unique identifier string |
| `value` | No | Label text (or HTML if `html=1` in style) |
| `style` | No | Semicolon-separated style properties |
| `vertex` | For shapes | Set to `"1"` |
| `edge` | For connectors | Set to `"1"` |
| `parent` | Yes | Parent cell id (`"1"` for default layer) |
| `source` | Edges | ID of source vertex |
| `target` | Edges | ID of target vertex |
| `visible` | No | `"0"` to hide the cell |

## mxGeometry

Every `mxCell` must contain exactly one `<mxGeometry as="geometry" />` child.

**Vertex geometry:**
```xml
<mxGeometry x="100" y="200" width="120" height="60" as="geometry"/>
```

**Edge geometry (mandatory even with no waypoints):**
```xml
<mxGeometry relative="1" as="geometry"/>
```

Edges without `<mxGeometry relative="1" as="geometry"/>` are invalid and will not render. Never self-close an edge cell.

**Edge with waypoints:**
```xml
<mxGeometry relative="1" as="geometry">
  <Array as="points">
    <mxPoint x="300" y="150"/>
    <mxPoint x="300" y="250"/>
  </Array>
</mxGeometry>
```

**Edge without source/target (floating):**
```xml
<mxGeometry relative="1" as="geometry">
  <mxPoint x="100" y="100" as="sourcePoint"/>
  <mxPoint x="300" y="200" as="targetPoint"/>
</mxGeometry>
```

## Containers and Groups

Use parent-child containment for architecture diagrams — do not just layer shapes on top of each other.

| Container type | Style | When to use |
|----------------|-------|-------------|
| Invisible group | `group;` | No visual border, no connections to the container |
| Swimlane (titled) | `swimlane;startSize=30;` | Visible header, or the container needs connections |
| Custom container | `container=1;pointerEvents=0;` + any shape style | Any shape acting as a container |

**Key rules:**
- Children use coordinates **relative to the parent container**
- Add `pointerEvents=0;` to containers that should not capture connections between children
- Only omit `pointerEvents=0` when the container itself needs to be connectable — swimlane handles this correctly

**Swimlane example:**
```xml
<mxCell id="svc1" value="User Service" style="swimlane;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="api1" value="REST API" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="svc1">
  <mxGeometry x="20" y="50" width="120" height="60" as="geometry"/>
</mxCell>
```

**Invisible group example:**
```xml
<mxCell id="grp1" value="" style="group;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="c1" value="Component A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="grp1">
  <mxGeometry x="10" y="10" width="120" height="60" as="geometry"/>
</mxCell>
```

## Layers

Cell `id="0"` is the root; cell `id="1"` is the default layer — both are always required. Additional layers are `mxCell` elements with `parent="0"` (no `vertex` or `edge` attribute):

```xml
<root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="layer-annotations" value="Annotations" parent="0"/>

  <mxCell id="10" value="Server" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
  </mxCell>
  <mxCell id="20" value="Note: deprecated" style="text;html=1;" vertex="1" parent="layer-annotations">
    <mxGeometry x="100" y="170" width="120" height="30" as="geometry"/>
  </mxCell>
</root>
```

- Later layers render on top (higher z-order)
- `visible="0"` on a layer cell hides it by default
- Use layers for conceptual groupings viewers may want to toggle independently

## Tags

Tags let viewers filter elements by category. Unlike layers, a single element can have multiple tags. Tags require wrapping `mxCell` in an `<object>` element:

```xml
<object id="2" label="Auth Service" tags="critical v2">
  <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
  </mxCell>
</object>
```

- The `label` attribute on `<object>` replaces `value` on `mxCell`
- Tags are space-separated in the `tags` attribute
- Tags are a visibility filter only — they do not affect z-order or structure

## Metadata and Placeholders

Metadata stores custom key-value properties on shapes. Set `placeholders="1"` to display them in labels using `%propertyName%` substitution:

```xml
<object id="2" label="&lt;b&gt;%component%&lt;/b&gt;&lt;br&gt;Owner: %owner%&lt;br&gt;Status: %status%"
        placeholders="1" component="Auth Service" owner="Team Backend" status="Active">
  <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="160" height="80" as="geometry"/>
  </mxCell>
</object>
```

Predefined placeholders (no custom properties needed): `%id%`, `%width%`, `%height%`, `%date%`, `%time%`, `%timestamp%`, `%page%`, `%pagenumber%`, `%pagecount%`, `%filename%`.

## Dark Mode Colors

- **`strokeColor`, `fillColor`, `fontColor`** default to `"default"` which renders black in light mode, white in dark mode.
- **Explicit colors** (e.g. `fillColor=#DAE8FC`) auto-invert for dark mode when `adaptiveColors="auto"` is set on `mxGraphModel`.
- **`light-dark()` function** — specify both explicitly: `fontColor=light-dark(#333333,#ffffff)`.

Generally, explicit hex colors with `adaptiveColors="auto"` are sufficient — no need to manually specify dark mode colors.

## Edge Routing

**CRITICAL: Every edge must use the expanded form with `<mxGeometry relative="1" as="geometry" />`:**

```xml
<mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;" edge="1" source="a" target="b" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

draw.io has no built-in edge collision detection. Plan layout carefully:

- Use `edgeStyle=orthogonalEdgeStyle` for right-angle connectors (most common)
- Space nodes generously — at least 60px apart, prefer 200px horizontal / 120px vertical
- Use `exitX`/`exitY` and `entryX`/`entryY` (0–1) to control connection sides; spread connections across different sides
- Final straight segment before target must be at least 20px (arrowhead needs room)
- Add `rounded=1` on edges for cleaner bends
- Use `jettySize=auto` for better port spacing on orthogonal edges
- Align all nodes to a grid (multiples of 10)

**Edge label tip:** Set `value="Label"` directly — do not wrap in HTML to reduce font size. Edge labels are already 11px (vs 12px for vertices).

## Connection Points

Control which side of a node an edge connects to:

| Property | Values | Description |
|----------|--------|-------------|
| `exitX` | 0.0–1.0 | Relative x of exit point (0=left, 0.5=center, 1=right) |
| `exitY` | 0.0–1.0 | Relative y of exit point (0=top, 0.5=middle, 1=bottom) |
| `entryX` | 0.0–1.0 | Relative x of entry point |
| `entryY` | 0.0–1.0 | Relative y of entry point |
| `exitDx`, `exitDy` | number | Absolute offset from exit point |
| `entryDx`, `entryDy` | number | Absolute offset from entry point |

Example — connect right side of source to left side of target:
```xml
style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;"
```

## XML Well-Formedness Rules

- **No XML comments** (`<!-- -->`) — strictly forbidden in output
- **Escape special characters**: `&amp;`, `&lt;`, `&gt;`, `&quot;`
- **Unique IDs** — every `mxCell` and `<object>` must have a unique `id`
- **Never compressed** — do not set `compressed="true"`
- **Cells 0 and 1 always present** — first two elements in `<root>`
- **Every vertex has `<mxGeometry as="geometry"/>`**
- **Every edge has `<mxGeometry relative="1" as="geometry"/>`** (expanded, not self-closed)
