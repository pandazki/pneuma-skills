# draw.io Style Reference

Complete reference for style properties, shape types, color palettes, and HTML labels. Use this when generating draw.io XML diagrams.

## Style String Format

The `style` attribute is a **semicolon-separated list of `key=value` pairs**:

```
rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;
```

A **shape name** or **style class** can appear as a bare token (without `=`):

```
ellipse;whiteSpace=wrap;html=1;
rhombus;whiteSpace=wrap;html=1;
swimlane;startSize=30;
```

**Rules:**
- Keys and values are case-sensitive
- No spaces around `=` or `;`
- Booleans use `0` and `1` (not true/false)
- Colors use `#RRGGBB` hex, `none`, or `default`
- Trailing `;` is conventional but not required

---

## Core Shapes

| Shape token | Description | Notes |
|-------------|-------------|-------|
| (none) | Rectangle (default) | Most common |
| `ellipse` | Oval / ellipse | Use `aspect=fixed` for circle |
| `rhombus` | Diamond | For decisions; add `perimeter=rhombusPerimeter` |
| `triangle` | Triangle | Add `perimeter=trianglePerimeter` |
| `hexagon` | Hexagon | Add `perimeter=hexagonPerimeter2` |
| `cloud` | Cloud shape | |
| `cylinder` | 3D cylinder | |
| `swimlane` | Container with header bar | Use `startSize` for header height |
| `group` | Invisible container | No fill, no stroke |
| `text` | Text only | No fill, no stroke, left-aligned |
| `image` | Image container | Requires `image=<url>` |
| `actor` | Stick figure (UML actor) | |

## Extended Shapes

Use `shape=<name>` in the style string:

| shape= value | Description |
|---|---|
| `cylinder2`, `cylinder3` | Cylinder variants (cylinder3 most common for databases) |
| `datastore` | Cylindrical data store |
| `cube`, `isoCube` | 3D/isometric cube |
| `document` | Document with curled bottom |
| `note` | Sticky note |
| `folder` | Folder icon |
| `callout` | Speech bubble |
| `process` | Process box (double-sided borders) |
| `step` | Chevron/step arrow |
| `parallelogram` | Parallelogram |
| `trapezoid` | Trapezoid |
| `doubleEllipse` | Double-bordered ellipse |
| `singleArrow`, `doubleArrow` | Block arrows |
| `flexArrow` | Flexible block arrow |
| `message` | Envelope/message |
| `table` | Table container |
| `tableRow` | Table row |
| `manualInput` | Manual input (flowchart) |
| `dataStorage` | Data storage (flowchart) |
| `offPageConnector` | Off-page connector |
| `delay` | Delay shape |
| `display` | Display device |

## UML Shapes

| shape= value | Description |
|---|---|
| `umlActor` | UML stick figure |
| `umlLifeline` | UML lifeline (sequence diagram) |
| `umlFrame` | UML frame |
| `umlBoundary`, `umlControl`, `umlEntity` | UML boundary/control/entity |
| `umlState` | UML state |
| `lollipop` | UML provided interface |
| `requiredInterface` | UML required interface |
| `component` | UML component |
| `startState`, `endState` | State diagram start/end |
| `associativeEntity` | ER associative entity |

## Stencil Libraries

Use `shape=mxgraph.<library>.<name>` for domain-specific icons:

| Library | Prefix | Examples |
|---------|--------|---------|
| AWS | `mxgraph.aws4.` | `mxgraph.aws4.lambda`, `mxgraph.aws4.rds` |
| Azure | `mxgraph.azure.` | `mxgraph.azure.app_service` |
| GCP | `mxgraph.gcp2.` | `mxgraph.gcp2.bigquery` |
| Kubernetes | `mxgraph.kubernetes.` | `mxgraph.kubernetes.pod` |
| Cisco | `mxgraph.cisco19.` | `mxgraph.cisco19.routers.router` |
| UML | `mxgraph.uml.` | Extended UML shapes |
| Flowchart | `mxgraph.flowchart.` | `mxgraph.flowchart.document` |
| BPMN | `mxgraph.bpmn.` | BPMN task types |
| ER | `mxgraph.er.` | Entity-relationship shapes |
| Mockup | `mxgraph.mockup.` | UI wireframe components |
| Electrical | `mxgraph.electrical.` | Circuit symbols |
| P&ID | `mxgraph.pid.` | Piping and instrumentation |

---

## Fill and Stroke

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `fillColor` | `#RRGGBB`, `none`, `default` | `default` | Shape fill color |
| `strokeColor` | `#RRGGBB`, `none`, `default` | `default` | Border color |
| `strokeWidth` | number | `1` | Border width in pixels |
| `gradientColor` | `#RRGGBB`, `none` | `none` | Gradient end color |
| `gradientDirection` | `north`, `south`, `east`, `west` | `south` | Gradient direction |
| `dashed` | `0`, `1` | `0` | Dashed stroke |
| `dashPattern` | string | — | e.g. `"8 8"` (8px dash, 8px gap) |
| `opacity` | 0–100 | `100` | Overall opacity |
| `fillOpacity` | 0–100 | `100` | Fill opacity only |
| `strokeOpacity` | 0–100 | `100` | Stroke opacity only |
| `shadow` | `0`, `1` | `0` | Drop shadow |
| `glass` | `0`, `1` | `0` | Glass/shine overlay |

---

## Shape Geometry

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `rounded` | `0`, `1` | `0` | Rounded corners |
| `arcSize` | number | — | Corner radius (0–50, as percentage of shorter side) |
| `aspect` | `variable`, `fixed` | `variable` | `fixed` preserves width/height ratio |
| `direction` | `north`, `south`, `east`, `west` | — | Rotate shape 90° increments |
| `flipH` | `0`, `1` | `0` | Flip horizontally |
| `flipV` | `0`, `1` | `0` | Flip vertically |
| `rotation` | number (degrees) | `0` | Free rotation angle |

---

## Text and Labels

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `html` | `0`, `1` | `1` | Enable HTML label rendering |
| `whiteSpace` | `wrap`, `nowrap` | — | Text wrapping; use `wrap` for most shapes |
| `fontSize` | number | `12` | Font size in pixels |
| `fontFamily` | string | `Helvetica` | Font family |
| `fontColor` | `#RRGGBB`, `default` | `default` | Text color |
| `fontStyle` | bitmask | `0` | 0=normal, 1=bold, 2=italic, 4=underline; combine by adding (3=bold+italic) |
| `align` | `left`, `center`, `right` | `center` | Horizontal alignment |
| `verticalAlign` | `top`, `middle`, `bottom` | `middle` | Vertical alignment |
| `labelPosition` | `left`, `center`, `right` | `center` | Label position relative to shape |
| `verticalLabelPosition` | `top`, `middle`, `bottom` | `middle` | Vertical label position |
| `overflow` | `visible`, `hidden`, `fill`, `width` | — | Text overflow |
| `spacing` | number | `2` | General padding in pixels |
| `spacingTop`, `spacingBottom`, `spacingLeft`, `spacingRight` | number | `0` | Individual padding |
| `labelBackgroundColor` | `#RRGGBB`, `none`, `default` | — | Background behind label text |
| `horizontal` | `0`, `1` | `1` | `0` for vertical text |

---

## Edges

### Routing Algorithms

| edgeStyle= value | Description |
|---|---|
| `orthogonalEdgeStyle` | Right-angle turns (most common) |
| `elbowEdgeStyle` | Single elbow bend |
| `segmentEdgeStyle` | Manual horizontal/vertical segments |
| `entityRelationEdgeStyle` | ER-style perpendicular exits |
| `isometricEdgeStyle` | Isometric routing |
| `loopEdgeStyle` | Self-referencing loop |
| `sideToSideEdgeStyle` | Side-to-side |
| `topToBottomEdgeStyle` | Top-to-bottom |
| (empty) | Straight line |

**Common combinations:**
```
edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;
edgeStyle=orthogonalEdgeStyle;curved=1;html=1;
edgeStyle=elbowEdgeStyle;elbow=horizontal;html=1;
edgeStyle=entityRelationEdgeStyle;html=1;
```

### Edge Properties

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `curved` | `0`, `1` | `0` | Curved path |
| `rounded` | `0`, `1` | `1` | Round corners (orthogonal) |
| `jettySize` | `auto`, number | `auto` | Port spacing |
| `elbow` | `horizontal`, `vertical` | — | Elbow direction |
| `jumpStyle` | `arc`, `gap`, `sharp` | — | Line crossing style |
| `jumpSize` | number | `6` | Jump width at crossings |

### Arrow Markers

| Property | Values | Default |
|----------|--------|---------|
| `startArrow` | arrow type | `none` |
| `endArrow` | arrow type | `classic` |
| `startSize`, `endSize` | number | — |
| `startFill`, `endFill` | `0`, `1` | `1` |

**Arrow type values:** `none`, `classic`, `classicThin`, `block`, `blockThin`, `open`, `openThin`, `oval`, `diamond`, `diamondThin`, `box`, `circle`, `circlePlus`, `cross`, `baseDash`, `doubleBlock`, `dash`, `async`, `openAsync`, `manyOptional`

`startFill=0`/`endFill=0` renders the marker as outline only (important for UML: open diamond = aggregation, filled diamond = composition).

---

## Containers and Swimlanes

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `container` | `0`, `1` | `0` | Cell acts as container |
| `collapsible` | `0`, `1` | `1` | Can collapse/expand |
| `recursiveResize` | `0`, `1` | `1` | Resize children with container |
| `startSize` | number | `23` | Swimlane header height |
| `horizontal` | `0`, `1` | `1` | `1`=header on top, `0`=header on left |
| `swimlaneFillColor` | `#RRGGBB` | — | Swimlane header fill |
| `childLayout` | `stackLayout`, `treeLayout` | — | Auto-layout for children |
| `pointerEvents` | `0`, `1` | `1` | `0` prevents container from capturing child connections |

---

## Sketch / Hand-Drawn Mode

| Property | Values | Description |
|----------|--------|-------------|
| `sketch` | `0`, `1` | Enable hand-drawn style (rough.js) |
| `comic` | `0`, `1` | Comic book style |
| `fillStyle` | `solid`, `hachure`, `cross-hatch`, `dots` | Fill pattern |
| `hachureGap` | number | Gap between hatch lines |
| `hachureAngle` | number (degrees) | Angle of hatch lines |
| `jiggle` | number | Hand-drawn jiggle amount |

---

## Predefined Style Classes

Bare token class names that set multiple properties at once:

| Class | What it sets |
|-------|-------------|
| `text` | No fill, no stroke, left-aligned, top-aligned |
| `edgeLabel` | Extends text; adds label background, font size 11 |
| `swimlane` | Swimlane shape, bold, header size 23 |
| `group` | No fill, no stroke, transparent container |
| `ellipse` | Ellipse shape with ellipsePerimeter |
| `rhombus` | Diamond shape with rhombusPerimeter |
| `triangle` | Triangle shape with trianglePerimeter |
| `image` | Image shape with label below |

### Color Theme Classes

Each class sets `fillColor`, `gradientColor`, `strokeColor`, plus `shadow=1` and `glass=1`:

| Class | fillColor | strokeColor |
|-------|-----------|-------------|
| `blue` | `#DAE8FC` | `#6C8EBF` |
| `green` | `#D5E8D4` | `#82B366` |
| `yellow` | `#FFF2CC` | `#D6B656` |
| `orange` | `#FFCD28` | `#D79B00` |
| `red` | `#F8CECC` | `#B85450` |
| `pink` | `#E6D0DE` | `#996185` |
| `purple` | `#E1D5E7` | `#9673A6` |
| `gray` | `#F5F5F5` | `#666666` |
| `turquoise` | `#D5E8D4` | `#6A9153` |

`plain-*` variants (e.g. `plain-blue`) use the same colors without shadow and glass.

---

## Color Palettes

### Standard Fill Colors (light)

| Color | Hex |
|-------|-----|
| Light blue | `#DAE8FC` |
| Light green | `#D5E8D4` |
| Light yellow | `#FFF2CC` |
| Light orange | `#FFE6CC` |
| Light red | `#F8CECC` |
| Light purple | `#E1D5E7` |
| Light gray | `#F5F5F5` |

### Matching Stroke Colors

| Color | Hex |
|-------|-----|
| Blue | `#6C8EBF` |
| Green | `#82B366` |
| Yellow/gold | `#D6B656` |
| Orange | `#D79B00` |
| Red | `#B85450` |
| Purple | `#9673A6` |
| Gray | `#666666` |

### Text Colors

| Use | Hex |
|-----|-----|
| Dark text on light fills | `#333333` |
| Black | `#000000` |
| White | `#FFFFFF` |

### Special Values

- `none` — transparent (removes fill or stroke)
- `default` — theme default (black in light, white in dark)

---

## HTML Labels

When `html=1` is in the style, the `value` attribute can contain HTML. All markup must be XML-escaped in the attribute.

**Supported elements:** `<b>`, `<i>`, `<u>`, `<s>`, `<br>`, `<p>`, `<div>`, `<span>`, `<font>`, `<table>`, `<tr>`, `<td>`, `<ul>`, `<ol>`, `<li>`, `<hr>`, `<img>`, `<a>`, `<sub>`, `<sup>`

**XML escaping required in attributes:**
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- `"` → `&quot;`

**Bold title with subtitle:**
```xml
value="&lt;b&gt;Title&lt;/b&gt;&lt;br&gt;Subtitle text"
```

**Colored text:**
```xml
value="&lt;font color=&quot;#B85450&quot;&gt;Error&lt;/font&gt;"
```

**UML class box label:**
```xml
value="&lt;p style=&quot;margin:0px;text-align:center;&quot;&gt;&lt;b&gt;ClassName&lt;/b&gt;&lt;/p&gt;&lt;hr/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ field: Type&lt;/p&gt;"
```

---

## Perimeter Types

Set the matching perimeter when using non-rectangular shapes, or edges connect to the bounding box instead of the visible shape:

| perimeter= value | Use with |
|---|---|
| `rectanglePerimeter` | Rectangles (default) |
| `ellipsePerimeter` | Ellipses, circles |
| `rhombusPerimeter` | Diamonds |
| `trianglePerimeter` | Triangles |
| `hexagonPerimeter2` | Hexagons |
| `parallelogramPerimeter` | Parallelograms |
| `trapezoidPerimeter` | Trapezoids |
| `calloutPerimeter` | Speech bubbles |
| `centerPerimeter` | Single center point |
| `stepPerimeter` | Step/chevron shapes |

---

## Validation Checklist

Before outputting diagram XML, verify:

- [ ] `mxGraphModel` has `adaptiveColors="auto"`
- [ ] First two cells are `id="0"` (no parent) and `id="1"` (`parent="0"`)
- [ ] All vertices have `vertex="1"` and `<mxGeometry as="geometry"/>`
- [ ] All edges have `edge="1"` and `<mxGeometry relative="1" as="geometry"/>` (expanded, not self-closed)
- [ ] All IDs are unique strings
- [ ] All elements have `parent` set to a valid ID
- [ ] No XML comments (`<!-- -->`) in the output
- [ ] Special characters are XML-escaped in attribute values
- [ ] HTML in `value` attributes is XML-escaped when `html=1`
- [ ] Non-rectangular shapes have matching `perimeter=` set
- [ ] Container children use coordinates relative to their parent
- [ ] `compressed="true"` is NOT set
