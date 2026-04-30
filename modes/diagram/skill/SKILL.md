---
name: pneuma-diagram
description: >
  Pneuma Diagram Mode workspace guidelines. Use for ANY task in this workspace:
  creating or editing architecture diagrams, flowcharts, UML, ER diagrams,
  network topology, org charts, mind maps, or any draw.io diagram.
  This skill defines the .drawio XML format, style strings, edge rules, and color palette.
  Consult before your first edit in a new conversation.
---

# Pneuma Diagram Mode

You create and edit draw.io diagrams. The user sees a live preview that updates as you write `.drawio` files. Changes appear in real time during streaming — no confirmation needed.

## Working with the viewer

The diagram canvas is the live surface where you and the user meet. Files (`.drawio` XML) are the source of truth; the viewer renders them and exposes a few channels for the user to point at things and for you to drive the canvas. Use these channels — don't ask the user to describe what they're looking at.

### Reading what the user sees

Before you respond, scan the latest user turn for two viewer-emitted blocks:

- `<viewer-context>` — current canvas state. Carries the active `.drawio` file (workspace-relative path) and, when the user clicked a shape or edge to chat about it, the selected element (cell `id`, `value`, and style summary). Trust this over your own assumptions about what's open.
- `<user-actions>` — discrete events since the last turn (file switches, page changes, element selections). These are the breadcrumbs of what the user just did on the canvas.

If the user says "this box" or "that arrow" without further context, it almost always refers to the selected element from `<viewer-context>` — `Read` that file and locate the cell by `id` before editing.

### Locator cards

After creating or substantially updating a diagram, embed a locator card so the user can jump to it from the chat. The viewer renders the card as a clickable chip that opens the diagram in the preview pane.

Diagram locator `data` keys:

| Key | Required | Meaning |
|-----|----------|---------|
| `file` | yes | Workspace-relative path to a `.drawio` file |

Real example:

```html
<viewer-locator label="Open architecture.drawio" data='{"file":"architecture.drawio"}' />
```

For a multi-page diagram, one card opens the whole file; the user uses the viewer's page tabs to switch between `<diagram>` pages.

### Viewer actions

The viewer exposes one agent-callable action via `POST $PNEUMA_API/api/viewer/action`:

- **`scaffold`** — Reset the active diagram to empty state. `clearPatterns: ["(active file)"]`. No params.

Use it when the user asks for a clean slate on the current diagram (e.g. "start over", "clear this diagram"). The action wipes the `.drawio` file's content; you then write a fresh `<mxfile>` skeleton.

```bash
curl -X POST "$PNEUMA_API/api/viewer/action" \
  -H "Content-Type: application/json" \
  -d '{"action":"scaffold","params":{}}'
```

After scaffold, write the new diagram with `Write` — don't expect the canvas to do anything until you save the file.

## File Rules

- **Multi-page support.** A single `.drawio` file can contain multiple `<diagram>` pages — the viewer shows tabs to switch between them. Use multiple pages for related diagrams on the same topic (e.g., overview + detail views). Each `<diagram>` must have a unique `id` and descriptive `name`.
- **Descriptive, stable cell IDs** (e.g. `user-box`, `edge-api-db`) — the user can click elements on the canvas, and selections come back via `<viewer-context>` keyed by `id`. Random ids like `cell-1` make those references hard to reason about.
- When modifying an existing diagram, always `Read` the file first to preserve existing cell IDs and structure.

## .drawio XML Structure

```xml
<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10"
                  math="0" shadow="0" adaptiveColors="auto">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- elements here -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## Critical Rules

1. **Cells 0 and 1 are mandatory** — `id="0"` (root) and `id="1"` (default layer, `parent="0"`) must always be the first two cells.
2. **All elements** have `parent="1"` (or a container/group id).
3. **IDs must be unique** — use descriptive strings: `"server-1"`, `"edge-api-db"`.
4. **Vertices need `vertex="1"`; edges need `edge="1"`** — mutually exclusive.
5. **Every edge must have `<mxGeometry relative="1" as="geometry" />`** — non-negotiable.
6. **No XML comments** — no `<!-- -->` in output.
7. **Always include `adaptiveColors="auto"`** on mxGraphModel for dark mode.
8. **Escape special characters**: `&amp;`, `&lt;`, `&gt;`, `&quot;`.
9. **Uncompressed XML only** — never `compressed="true"`.
10. **Preserve existing IDs** when editing — changing IDs breaks connections and viewer state.

## Style Strings

Semicolon-separated `key=value` pairs, ending with `;`. No spaces around `=` or `;`.

```
rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;
```

- Bare tokens set shape type: `ellipse;`, `rhombus;`, `swimlane;`
- Boolean values: `0` or `1`
- Colors: `#RRGGBB`, `none`, or `default`
- Always include `whiteSpace=wrap;html=1;` on vertices so labels wrap correctly

## Common Patterns

**Rounded rectangle:**
```xml
<mxCell id="svc-1" value="Auth Service" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="140" height="60" as="geometry"/>
</mxCell>
```

**Diamond (decision):**
```xml
<mxCell id="dec-1" value="OK?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="300" y="90" width="120" height="80" as="geometry"/>
</mxCell>
```

**Database:**
```xml
<mxCell id="db-1" value="PostgreSQL" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="240" width="100" height="70" as="geometry"/>
</mxCell>
```

**Arrow (always expanded form):**
```xml
<mxCell id="e-1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" source="svc-1" target="db-1" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**Labeled arrow:**
```xml
<mxCell id="e-2" value="Yes" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="dec-1" target="svc-1" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**Swimlane container (children use parent=container-id):**
```xml
<mxCell id="lane-1" value="User Service" style="swimlane;startSize=30;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="api-1" value="REST API" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="lane-1">
  <mxGeometry x="20" y="50" width="120" height="60" as="geometry"/>
</mxCell>
```

## Color Palette

Coordinated fill/stroke pairs for consistent diagrams:

| Theme | fillColor | strokeColor | Use for |
|-------|-----------|-------------|---------|
| Blue | `#dae8fc` | `#6c8ebf` | Services, APIs, primary |
| Green | `#d5e8d4` | `#82b366` | Success, databases, storage |
| Yellow | `#fff2cc` | `#d6b656` | Warnings, queues, buffers |
| Orange | `#ffe6cc` | `#d79b00` | External systems, triggers |
| Red | `#f8cecc` | `#b85450` | Errors, critical paths |
| Purple | `#e1d5e7` | `#9673a6` | Users, actors, auth |
| Gray | `#f5f5f5` | `#666666` | Infrastructure, neutral |

## Layout

- Position elements on multiples of 10 (grid alignment)
- Leave at least 60px between nodes; prefer 200px horizontal, 120px vertical
- Use `edgeStyle=orthogonalEdgeStyle` for right-angle connectors (most common)
- Control connection points with `exitX`/`exitY`/`entryX`/`entryY` (values 0-1)
- Add waypoints to avoid overlapping edges:
  ```xml
  <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="a" target="b">
    <mxGeometry relative="1" as="geometry">
      <Array as="points"><mxPoint x="300" y="150"/><mxPoint x="300" y="250"/></Array>
    </mxGeometry>
  </mxCell>
  ```

## Language Matching

Match all diagram labels to the user's language. If they write in Chinese, all text in the diagram should be Chinese.

## References

For advanced topics, read these files when needed:
- `{SKILL_PATH}/references/xml-reference.md` — XML structure, layers, metadata, dark mode, edge routing
- `{SKILL_PATH}/references/style-reference.md` — style properties, shapes, colors, HTML labels, shape library (AWS/Azure/GCP/K8s/UML/BPMN/ER)
