<!--
  Adapted from tw93/kami (MIT) — references/diagrams.md.
  Source: https://github.com/tw93/kami/blob/main/references/diagrams.md
  Credit retained per MIT License; see ../../NOTICE.md.
-->

# Diagrams

kami's drawing capability. **18 diagram types** covering structural, process, data chart, and interaction scenarios. All wear kami's skin (parchment + ink-blue + warm grays). No second design system.

Every diagram is a **self-contained HTML + inline SVG**: no JS and no build step to use one. Fifteen are hand-drawn; `sequence`, `class`, and `er` were authored upstream from Mermaid text and shipped here as static, kami-themed SVG (their Mermaid sources sit in `_shared/assets/diagrams/src/*.mmd` for provenance). The upstream Mermaid regeneration pipeline is not part of this mode — edit the `<text>` labels in place; do not re-tune coordinates. Browse them as standalone pages, or copy the `<svg>...</svg>` block into a long-doc `<figure>` to embed.

---

## 1. Selection

| Showing… | Use | Template |
|---|---|---|
| System components + connections | **Architecture** | `_shared/assets/diagrams/architecture.html` |
| Full-system panorama: five layers, control plane, roadmap, owners | **Architecture Board** | `_shared/assets/diagrams/architecture-board.html` |
| Decision branches, "if A then B else C" | **Flowchart** | `_shared/assets/diagrams/flowchart.html` |
| Two-axis positioning / prioritization | **Quadrant** | `_shared/assets/diagrams/quadrant.html` |
| Category comparison (revenue, market share, quarterly) | **Bar Chart** | `_shared/assets/diagrams/bar-chart.html` |
| Trend over time (stock price, growth rate, time series) | **Line Chart** | `_shared/assets/diagrams/line-chart.html` |
| Proportional breakdown (spend, user segments, share) | **Donut Chart** | `_shared/assets/diagrams/donut-chart.html` |
| Finite states + directed transitions (lifecycle, state machine) | **State Machine** | `_shared/assets/diagrams/state-machine.html` |
| Time axis + milestone events (roadmap, project progress) | **Timeline** | `_shared/assets/diagrams/timeline.html` |
| Cross-responsibility process (multi-role, API request path) | **Swimlane** | `_shared/assets/diagrams/swimlane.html` |
| Hierarchical relationships (org chart, module deps, directory tree) | **Tree** | `_shared/assets/diagrams/tree.html` |
| Vertically stacked system layers (OSI, application stack) | **Layer Stack** | `_shared/assets/diagrams/layer-stack.html` |
| Set intersections (feature overlap, audience comparison, capability map) | **Venn** | `_shared/assets/diagrams/venn.html` |
| OHLC price action (stock price, trading days, up/down candles) | **Candlestick** | `_shared/assets/diagrams/candlestick.html` |
| Revenue bridge, valuation decomposition, cash flow breakdown | **Waterfall** | `_shared/assets/diagrams/waterfall.html` |
| Message exchange over time between actors (API handshake, protocol) | **Sequence** | `_shared/assets/diagrams/sequence.html` |
| Types with fields + inheritance / composition relations | **Class** | `_shared/assets/diagrams/class.html` |
| Entities + cardinality relations (data model, schema overview) | **ER** | `_shared/assets/diagrams/er.html` |

Not on the list:
- **Compare two things**: use a table. A three-column table beats any diagram of a binary contrast.
- **One box with a label**: delete the box, write the sentence.

Scale check: the **Architecture** row above is a single embeddable figure and follows the 9-node budget below. A full-system panorama (platform map, control plane, roadmap, owner map) is a different artifact: an **architecture board**, covered in section 3. Do not inflate one figure to carry it.

### The question before drawing

> Would a well-written paragraph teach the reader less than this diagram?

If "no", don't draw. Diagrams add signal to hierarchy, direction, and magnitude. They don't decorate prose.

---

## 2. Complexity budget

**Target density: 4/10** for editorial documents (reports, one-pagers, decks). Enough to be technically complete, not so dense the reader needs a guide.

- Nodes > 9 -> this is two diagrams, not one
- Two nodes that always travel together -> they're one node
- A line whose meaning is obvious from layout -> remove the line
- 5 nodes in ink-blue -> you haven't decided what's focal

**Teaching tier: 6-7/10.** A figure inside a technical teaching document (the reader expects to learn how something works) carries more: layers, data-flow direction, and at least one labeled trade-off or decision point. A 3-box overview shipped as an "architecture diagram" in that context reads as marketing, and readers say so. If hand-assembled SVG cannot hold that detail at the target display width, switch to the generated-image path (section 11, and SKILL.md «Image generation») instead of enlarging the SVG.

**Focal rule**: 1-2 focal elements per diagram (`#1B365D` stroke + `#EEF2F7` fill). Everything else goes neutral. Focal signal comes from contrast, not count.

These budgets govern single embeddable figures. A report-scale architecture board carries more blocks under its own budget (section 3).

---

## 3. Architecture boards (report scale)

The **Architecture** template in section 1 is one embeddable figure: at most 9 nodes, one focal, dropped into a `<figure>`. Some asks are bigger: a whole-platform panorama, a control-plane map, a target architecture with roadmap and owners. That artifact is an **architecture board**: a full page of structured inline SVG, same tokens, more structure. Never answer it by inflating a single figure past its node budget.

Start from `_shared/assets/diagrams/architecture-board.html`. It ships with a real five-layer demo (a terminal emulator fork) and an authoring outline in the HTML comment. Replace the demo content; keep the skeleton. (The template carries an upstream poster-size `@page` rule for its PDF export path; in this mode the board renders inside the paper viewer like any other page, so give it its own `<div class="page">` — or its own content set — rather than squeezing it beside body text.)

A board is a reading instrument, not an illustration. The reader must get three things, in order: what the parts are, how they flow or depend, and where the next piece of work should intervene. Any element that does not help one of those judgments gets deleted. The denser the system, the more restrained the board.

### Canvas follows reading path

Decide how much the board must carry before deciding the canvas:

| Board carries | Canvas |
|---|---|
| One-screen product or system relationship | 16:9, slide-sized |
| Whole-platform panorama | Wide canvas, light vertical scroll |
| Roadmap + owners + governance loop | Report page (the board as the spine of an A4 flow) |

The canvas may grow taller, but never into an endless page. One scan should build the whole picture.

### Five fixed information layers

Complex boards keep a fixed five-layer skeleton instead of free-form scatter. Each layer answers exactly one question:

1. **Title**: one sentence stating the subject and the judgment.
2. **Business**: roles, capability domains, external consumers.
3. **System**: platform modules and the control plane.
4. **Runtime**: key paths: data flow, event flow, permission flow.
5. **Governance**: monitoring, audit, lifecycle, roadmap, owners.

Do not explain protocol detail in the business layer; do not dump the domain catalog into governance.

### Bands over cards

The fastest way a board turns crude is drawing every fact as its own small card.

- Parallel peers share **one band** with thin vertical dividers, not N cards.
- Tabular facts get a **table shell**, not five boxes.
- Focal fill (`--brand-tint`) marks only the genuinely core nodes; the 1-2 focal rule from section 2 still holds.
- Never nest a card inside a card.
- Budget: **10-25 major blocks** per board. Past that, merge blocks into domains; do not keep stacking nodes.

### Node anatomy

A node holds three things: optional icon, title, then two or three short lines. No paragraphs, no noun trains.

Good:

```text
Foundation: event push
PublishEvent v2, EventBus, webhook subscription
```

Bad: the same title followed by eight comma-separated technical nouns on one line.

### Copy reads as judgment, not summary

Generated boards fail on copy before they fail on layout: text that is correct but decides nothing. Avoid saturated abstractions, long parallel noun phrases, and adjectives with no action attached. Prefer sentence shapes that commit:

- from X to Y
- inserted before X
- unifies X across Y
- owned by X
- measured by X

Board text is short, hard, and executable. `writing.md` still applies.

### Line discipline

- Orthogonal lines only. No curves, no passing through modules, no crossing text, no decorative junctions.
- Main path in `--brand`, auxiliary lines in border tone, light open chevron heads (arrow rules in section 5; manual chevron paths, not `<marker orient="auto">`).
- **Connector standoff: 4px.** On a board, start the shaft 4px after the source edge and land the chevron tip 4px before the target edge. Both offsets are computed from the node edge (keep them divisible by 4), so this is a deliberate standoff, not the sloppy floating gap the embedding rules warn about. Welded-on arrows read cramped at board scale.
- **Never run a line along a module's top edge.** It reads as a broken border or a squashed module, worst when a brand-colored line crosses a light card. Route the line below or beside the module with 16-24px of air, and attach it with a short stub to the outer edge, never into the text area.
- A relation that is not core information becomes a caption or a small label, not a line.
- A line the reader cannot parse gets deleted, not explained.

### English anchors on CN boards

Uppercase mono anchors (`MAIN AXIS`, `CONTROL PLANE`, `PUBLIC INFRA`, `OWNER MAP`, `ROADMAP`) help scanning on a Chinese board. Do not translate full sentences: the reader should never switch languages mid-thought.

### No viewpoint captions

Notes like "from the platform team's perspective" or "working draft for X" do not belong on the board; structure carries the viewpoint. Corner text holds only the date basis, version, or data scope. If deleting a caption changes nothing, delete it.

### Whiteboard to board

Whiteboards explore; boards communicate. Never reuse the whiteboard drawing style. Convert:

1. Identify the core objects.
2. Merge repeated objects into domains.
3. Collapse free-form connections into one or two main paths.
4. Rewrite sticky-note phrasing into short labels.
5. Push detail into a bottom note or a companion doc, not the main drawing.

### Structure before pixels

Do not draw straight into SVG. Outline the board first with a fixed vocabulary, then render with the section 5 token map, so consecutive boards look like one system:

```text
Section: Target architecture
Band: Platform surface
Node: Collaboration
Node: Execution
Band: Core runtime
Node: Sensing
Node: Identity
Node: Control plane
Flow: Foundation -> Spine -> Pillars
Note: Does not replace per-business implementations
```

Content fills the structure; the token map styles it.

### Board type scale

Standalone board pages run larger than embedded figures (for embedded sizing use the calibration table in section 5):

| Role | Size |
|---|---|
| Page title | 36-40px |
| Section title | 22-24px |
| Block title | 17-19px |
| Body / node description | 13-15px |
| Caption | 11-12px |

Fixed pixel sizes: no viewport-scaled type, no negative letter-spacing on body sizes. Fonts and colors come from the existing kami stacks and token map; a board introduces zero new colors and zero new fonts.

### Module-level pass

When the macro structure is right but the board still reads crowded, the fault is usually inside modules, not the canvas. Global fixes (enlarge the canvas, shrink type, recolor) do not touch it. Check per module:

- title sitting too close to its description
- CJK line breaks landing mid-phrase or orphaning one character
- an icon eating the text column
- padding thinner than the module's siblings
- baselines unaligned across one row
- a table sitting off-center inside its section

Fix modules one at a time, re-render, and only then judge whether the canvas itself needs to change.

### Board pre-ship scan

Content:

1. The reader can state the main path within 30 seconds.
2. Each section answers exactly one question.
3. Current state, target, intervention points, governance, and roadmap are all explicit.
4. Everything deletable has been deleted.

Visual:

1. Parchment background, never pure white.
2. One accent color.
3. No gradient, shadow, bitmap, external fetch, or script.
4. No overlapping text; no line over module content.
5. Icon stroke and size uniform.
6. Right-side captions right-aligned, with at least 56px of outer margin.

File: grep the HTML for `#fff`, `gradient`, `shadow`, `<script`, `<img`, and the em dash character; every hex value must exist in the token map. Then run a `capture` on the rendered board (SKILL.md «Verifying your work») and check the visual list against what the user actually sees.

---

## 4. Maintained diagrams (living across sessions)

The third scale. A **figure** embeds once; a **board** ships as a report page; a **maintained diagram** persists in a content set (or in the user's own project directory) and gets redrawn across sessions by different hands. Triggers: "给项目画张架构图", "更新这张架构图", or any task that starts from a diagram someone drew earlier.

Everything above still applies (tokens, budgets, line discipline). What changes is lifecycle: the diagram is no longer a one-shot render but a source with a contract.

### Record intent next to the diagram

The redraw context that would otherwise die in a chat log must live on disk. Keep an intent note beside the diagram — the content set's `README.md` is the natural home (each content set already ships one for provenance). Four fixed blocks:

| Block | Holds | Never holds |
|---|---|---|
| Must preserve | What the current diagram already states correctly | New ideas |
| Suggested additions | Facts from the sources the diagram does not show yet | Anything phrased as if already drawn |
| Visual direction | Hierarchy, whitespace, line, and boundary fixes to try next | A full palette dump (tokens live in this file) |
| Sister boundaries | What belongs to companion diagrams, with their paths | Content that should move back in |

The block separation prevents the two classic redraw failures: treating a suggestion as if it were already drawn, and doing a visual pass that silently grows scope. A missing or stale intent note gets rebuilt as part of the task, not skipped.

### Evidence pass before drawing

Read, in order, before any drawing:

1. The intent note, if present.
2. The diagram source as it is now.
3. A `capture` of the current render, at real size.
4. The facts: README, design doc, or the source material that defines the objects and boundaries the diagram names. Read only what affects terminology and edges.

Current facts override the intent note; the intent note overrides memory; never redraw from memory alone. If the facts contradict the note, update the note in the same change.

### Reading path before canvas

Decide how the reader's eye moves first; ratio and canvas follow (boards already obey this, section 3):

| Path | Fits | Skeleton |
|---|---|---|
| Left to right | Mechanism, request path, task flow | input, decision or merge, output |
| Top to bottom | Platform overview, runtime architecture | access layer, runtime layer, governance layer |
| Current to target | Evolution, refactor | today, intervention point, target |
| Hub with edges | Plugin system, context boundary | center object, input boundary, output boundary |

If the reader has no entry point, no amount of color or radius tuning helps. Fix the path, then the pixels.

### Maturity encoding

Long-lived diagrams mix what exists, what is being built, and what is only a direction. Encode maturity with stroke and opacity, not new colors:

| State | Encoding | Reads as |
|---|---|---|
| Shipped | Standard node (ivory fill, near-black stroke) | Exists today |
| In build | Focal (brand stroke, `--brand-tint` fill) | The current work, the diagram's point |
| Future | Dashed `--stone` stroke, node content at 55% opacity | Direction, not commitment |

This collapses two rules into one: the 1-2 focal budget and "what is under construction" are the same slots. Consequences:

- Future nodes never take focal color, and never sit on the main path as if load-bearing.
- An undecided boundary gets a `TO VERIFY` mono label, not a drawn-through line.
- No dates, owners, phases, or milestones in an architecture diagram unless the user asked for a board with a governance layer. A diagram radiates certainty; do not let it promise what the roadmap has not decided.

### Naming and copy

Node titles carry function first, protocol noun second. A bare protocol noun outsources the reading cost to the reader:

| Weak | Strong |
|---|---|
| Registry | 插件注册表 Registry |
| Queue | 任务队列 Queue |
| Policy Hook | 写动作准入 Policy Hook |
| Inbox | 任务收件箱 Inbox |

In-diagram copy holds objects, boundaries, and actions only; argument stays in prose. CJK copy inside nodes uses short labels with commas, slashes, and semicolons, never the CJK full stop (。). If a line needs a full stop, it is a sentence, and sentences live in the document, not the diagram.

### Terminology sync

The diagram and its host document are one vocabulary. When prose renames an object, the same change updates: SVG `<text>` labels, `<title>` and `<desc>`, and the intent note, plus any cross-references. A diagram that still shows the old name is a bug, not a style issue.

Crowding is solved by cutting content, banding peers, or splitting out a sister diagram, never by adding a smaller type tier.

---

## 5. Embedding in long-doc / portfolio

### Standalone preview

Each file under `_shared/assets/diagrams/` is a complete HTML page with title, SVG, and caption — the viewer renders it like any other page if you open it as a content page. Normally you don't: you copy the SVG out.

### Embed in a kami document

Extract **only the `<svg>...</svg>` block** from the template (leave the frame / h1 / eyebrow behind). Drop it into a long-doc `<figure>`:

```html
<figure>
  <svg viewBox="0 0 960 460" xmlns="http://www.w3.org/2000/svg">
    <!-- svg content copied from architecture.html -->
  </svg>
  <figcaption>Figure 1. {{Short editorial caption in serif.}}</figcaption>
</figure>
```

`long-doc.html` already styles `figure` and `figcaption`. No extra CSS required.

### Editing nodes / text

Edit the `<text>` and `<rect>` values directly. Rules:

- **All coordinates, widths, and gaps must be divisible by 4.** This is the anti-AI-slop floor. Break it once and the diagram starts looking "close enough".
- Node widths: 128 / 144 / 160 (three tiers, don't add more). Small diagrams (viewBox width < 360) may compress to 2 tiers, but still keep it 2 - don't tailor each node.
- Node heights: 32 (pill) / 64 (standard)
- Font sizes: 7 (small mono label) / 9 (sublabel mono) / 12 (name sans)
- **Arrow endpoints land exactly on node edges**: start `(box.x + box.w, box.y + box.h/2)`, end `(box.x, box.y + box.h/2)`, not "close enough". A 10px gap is visible to the eye. (Board-scale connectors use a deliberate 4px standoff instead — see section 3.)
- **SVG top padding**: the `y` in `<text y="…">` is the baseline. `y` must be ≥ font-size × 1.2, otherwise the tops of capital letters extend above the viewBox and get clipped (classic symptom: "TOOLS" renders as "TOULS"). Either pad the viewBox at the top or move `y` into the safe zone.
- **Loop arc control points**: for a four-cardinal-node ring, each arc is a Q-curve whose control point sits at the **outer intersection of the two adjacent tangent axes**, not at a node corner. Example for PLAN (top) → ACT (right): start = PLAN's right-edge midpoint, end = ACT's top-edge midpoint, control = `(ACT.x + ACT.w/2, PLAN.y + PLAN.h/2)`. This gives a pure horizontal tangent at departure and pure vertical at arrival, reading as a clean quarter-circle. Control at the node corner produces a squashed arc.
- **Closed loops need a dashed framing ring**: four directed arcs alone force the reader to mentally connect them into a loop. A dashed circle centered on the visual center (radius slightly larger than center-to-inner-edge distance) makes the loop immediately readable. Draw the ring below the nodes; solid node fills mask where the ring crosses each node; the ring shows only between nodes.
- **Chevron arrows, not filled triangles**: use `<path d="M2 1 L8 5 L2 9" fill="none" stroke=... stroke-width="1.5" stroke-linecap="round"/>`. A filled triangle reads as technical UI; an open two-stroke chevron reads as editorial schematic. kami defaults to chevron. **WeasyPrint does not support `<marker orient="auto">`**: all markers render at 0° (pointing right). The fix is to skip `<marker>` and draw each arrowhead as a manual chevron `<path>` with hardcoded direction — every shipped template already does this, so PDF exports stay faithful.

### Color token map

Shared tokens across kami's diagram set, mapping directly to the design system. All fills are solid hex values pre-blended on parchment; never use `rgba()` in SVG fills or strokes (it disagrees with the warm-tone palette and complicates WeasyPrint output).

| SVG role | kami token | Value |
|---|---|---|
| Canvas | `--parchment` | `#f5f4ed` |
| Standard node fill | `--ivory` | `#faf9f5` |
| Standard node stroke | `--near-black` | `#141413` |
| Store node fill | near-black 5% (solid) | `#EAE9E2` |
| Store node stroke | `--olive` | `#504e49` |
| Cloud node fill | near-black 3% (solid) | `#EEEDE6` |
| Cloud node stroke | near-black 30% (solid) | `#B2B1AC` |
| External node fill | olive 8% (solid) | `#E9E8E1` |
| External node stroke | `--stone` | `#6b6a64` |
| **Focal fill** | `--brand-tint` | `#EEF2F7` |
| **Focal stroke** | `--brand` | `#1B365D` |
| Standard arrow | `--olive` | `#504e49` |
| Focal arrow | `--brand` | `#1B365D` |
| Primary text | `--near-black` | `#141413` |
| Secondary text | `--olive` | `#504e49` |
| Tertiary text / small mono label | `--stone` | `#6b6a64` |

Don't add a fourth state ("warning amber", "success green"). kami has one accent.

### Shared `<defs>` fragment

Every diagram opens with the same parchment + dotted-noise overlay. Copy this block verbatim into new diagrams so the texture stays uniform:

```html
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="0.9" fill="#E3E2DC"/>
  </pattern>
</defs>

<rect width="100%" height="100%" fill="#f5f4ed"/>
<rect width="100%" height="100%" fill="url(#dots)" opacity="0.55"/>
```

`#E3E2DC` is the parchment-blended solid for `rgba(20,20,19,0.08)`; the `opacity="0.55"` on the overlay rect is a deliberate decoration, not a violation of the no-rgba-on-tag-backgrounds rule (which targets CSS tag fills, not SVG dot textures).

### Embedded font calibration (override standalone sizes)

Standalone diagram sizes (`7 / 9 / 12`) are too small once embedded in A4 long-doc / portfolio. The render width drops to about 470pt while the viewBox stays at 1000, so the scale factor is roughly `0.47`. To keep diagram text aligned with the 11pt body baseline, raise the SVG `font-size` values when embedding:

| Visual target | Visual weight | SVG `font-size` |
|---|---|---|
| Same as h2 / focal node name | 11pt | **24** |
| Same as body | 11pt | **22-24** |
| Same as h3 / sub-label | 9-10pt | **18-20** |
| Same as caption | 8pt | **15-16** |
| Mono uppercase tag (letter-spacing 2.5) | 7pt | **14** |

Compensation factor is roughly `1.8-2.0x` over standalone. `font-size: 24` with `font-weight: 600` and the body serif renders at about 1.05x the body, which reads as h2-equivalent without dominating the page.

For tall diagrams (e.g. 5-layer stack), a working layout is `viewBox: 0 0 1000 560`, layer height `88`, gap `8`, and inside each layer:

- Tag baseline `y+24`, font-size `14`, mono, letter-spacing `2.5`
- Name baseline `y+54`, font-size `24`, serif weight `600`
- Description baseline `y+76`, font-size `14`, mono, normal
- Right-side role tag `x=900`, `text-anchor=end`, font-size `13`

### In-SVG header line (figure number + title)

For embedded diagrams, put the "FIGURE N · TITLE" header inside the SVG instead of using `<figcaption>`. The diagram becomes a self-contained editorial unit, and the brand-colored header doubles as a section anchor.

```svg
<text x="80" y="38" fill="#1B365D" font-size="13" font-weight="600"
      font-family="mono" letter-spacing="3">FIGURE  1</text>
<text x="195" y="38" fill="#504e49" font-size="13"
      font-family="mono" letter-spacing="3">DIAGRAM TITLE GOES HERE</text>
<line x1="80" y1="52" x2="920" y2="52"
      stroke="#1B365D" stroke-width="0.8"/>
```

Two spaces between `FIGURE` and the number. With `letter-spacing: 3`, a single space lets the digit collide with the preceding letter.

---

## 6. Icon style

Icons live inside `<svg>` blocks alongside diagram nodes. Draw them with the same primitives (`rect`, `circle`, `line`, `path`) used for nodes - no imported icon fonts, no SVG sprites.

**Rules**:
- Single line, stroke 1pt-1.5pt, no fill
- Stroke weight stays consistent within one diagram. Never mix 1pt and 1.5pt icons in the same figure
- No drop shadow, gradient, 3D, or glassmorphism
- No emoji-style faces, mascots, or expressive characters - this is editorial schematic, not playful
- Focal icons may use `--brand` stroke or fill, but the figure's total ink-blue area still respects the 5% cap

### Canonical shapes

When an icon represents a recurring concept, use the canonical form rather than inventing a new one:

| Concept | Shape |
|---|---|
| Terminal / CLI | rounded rectangle, three dots top-left |
| Document / spec | rectangle, three short horizontal lines |
| Checklist / verification | rectangle, two check marks |
| Gear / system | 8-tooth gear outline |
| Magnifier / inspect | circle with 45° handle |
| Shield / safety | shield silhouette |
| Cloud / hosted service | three-arc cloud outline |
| Chip / hardware | square with leg lines on four sides |
| GPU / compute rack | rectangular stack with port indicators |

### Human and robot figures

Avoid human figures and anthropomorphic AI in editorial diagrams. If a person must appear, use a minimal line drawing without facial detail. Industrial robots may be line-art mechanical structures, but stop short of patent-illustration density.

When in doubt, omit the icon entirely. A clean text label beats a cute icon in editorial schematic style. Add an icon only when it carries information the label cannot (e.g. distinguishing "cloud service" from "on-device compute" at a glance).

---

## 7. AI-slop anti-patterns

Scan for these when drawing or reviewing:

| Anti-pattern | Why it fails |
|---|---|
| Dark mode + cyan / purple glow | Cheap "technical" signifier with no design decision |
| All nodes identical size | Destroys hierarchy |
| JetBrains Mono as the universal "dev" font | Mono is for technical content (ports, URLs, fields). Names go in sans. |
| Legend floating inside the diagram area | Collides with nodes |
| Arrow labels without a masking rect | Line bleeds through the text |
| Vertical `writing-mode` text on arrows | Unreadable |
| Three equal-width summary cards as a default | Template feel. Vary widths. |
| `box-shadow` on anything | kami only permits ring / whisper |
| `rounded-2xl` / border-radius above 10px | Max 6-10px. Beyond, it starts to look like App Store chrome. |
| Ink Blue on every "important" node | Focal rule is 1-2, not a signaling system |
| Decorative icons | Disaster |
| Gradient backgrounds | kami forbids them |
| Focal color contradicts the caption's claim | Caption says "Simple **core**", but the ACT node is painted ink-blue - two focals competing. Focal color must match the word emphasized (`<span class="hl">`) in the caption |
| Cycle diagram with a dashed ring AND four directed arcs | Same loop drawn twice; reader thinks there are two flows |
| SVG text clipped at the viewBox top | `text` y is the baseline; cap letters extend above y=0. Pad the top by font-size × 1.2 or adjust the viewBox |
| 5-10px gap between arrow endpoint and node edge | Reads as "arrow floating in space". Anchor endpoints to exact `box.x / box.x+w / box.y / box.y+h` |
| Per-node custom widths within one diagram | Four steps at widths 60 / 76 / 80 / 100 feel hand-patched. Small diagram: 2 tiers. Large: 3 tiers. That's the full budget |
| Porting an external diagram with one accent color per node type (purple/amber/green/red) | kami has one accent. When adapting external diagrams, migrate the focal to whichever element the caption's `<span class="hl">` emphasizes; concentrate color there, keep all other nodes neutral |
| Ring diagram: every node is a single word, center is empty | Four labeled boxes looping with no anchor. Either add a subtitle to each node or place one line of text at the center (exit condition, LOC count, etc.). Pick one. |
| Connector hugging a module's top edge | Reads as a broken border; the module looks pressed. Drop the line below the module with 16-24px of air and attach short stubs to the outer edge (section 3, Line discipline) |
| Viewpoint caption ("from the X perspective", "working draft for Y") | Structure carries the viewpoint. Corner text holds only date basis, version, or data scope |
| Paragraph inside a node | Node = optional icon + title + 2-3 short lines. Prose goes to a bottom note or companion doc |
| Full-sentence English translation on a CN board | English is a scan anchor (`CONTROL PLANE`, `OWNER MAP`), not a second copy of the text |
| Every fact drawn as its own small card | Peers share one band with vertical dividers; tabular facts get a table shell (section 3, Bands over cards) |
| Roadmap furniture (30/60/90, owner map, milestones) in an architecture diagram | That is a plan, not an architecture. Objects, relations, boundaries, intervention points only; schedule belongs to a timeline or a board's governance layer, and only when asked |
| Future capability drawn at the same weight as shipped | The reader assumes it exists. Encode maturity: shipped solid, in-build focal, future dashed at reduced opacity (section 4, Maturity encoding) |
| Prose renamed an object, diagram still shows the old name | One vocabulary. Rename SVG text, `<title>`/`<desc>`, and the intent note in the same change |
| Bare protocol noun as a node title (Registry, Queue, Inbox) | Function first, protocol second: 插件注册表 Registry (section 4, Naming and copy) |
| CJK full stop (。) inside node copy | Node copy is labels, not sentences. Commas, slashes, semicolons |
| Crowded board "fixed" by global scaling | The fault is module-level: padding, line breaks, baselines (section 3, Module-level pass) |

---

## 8. Common pairings

### Technical white paper
- Architecture (system overview) + built-in timeline (from long-doc)
- One architecture diagram per chapter, maximum. If you want two, the chapter is covering two topics and should split.

### Portfolio project page
- Quadrant (competitive positioning) or architecture (the layer you owned)
- **Not every project needs a diagram.** Only when the diagram says something prose can't.

### One-pager
- Quadrant (priority) or flowchart (decision path)
- One diagram only. If you're tempted to add a second, kill the weaker one.

### Resume
- **No diagrams.** Resume real-estate costs more than diagrams. Rare exception: a URL to a portfolio diagram when showing system-level capability.

### Slides
- One diagram per slide, max. The diagram is the body. Text is caption, not a sidebar. At slide scale (1920x1080), scale the SVG to fill >=65% of the slide area; print-sized diagram on screen slide leaves ~35% dead space.

---

## 9. Data charts (bar / line / donut)

Five data-driven chart types for investment reports, financial comparisons, and market-share breakdowns. Like the first three diagram types, all are self-contained HTML + inline SVG, embeddable in any kami document.

### Color palette (derived from kami warm palette)

| Role | Value | Use |
|---|---|---|
| Primary series | `#1B365D` ink-blue | First group / focal data |
| Series 2 | `#504e49` olive | Second group |
| Series 3 | `#6b6a64` stone | Third group |
| Series 4 | `#b8b7b0` light-stone | Fourth group |
| Series 5 | `#d4d3cd` mist | Fifth group |
| Series 6 | `#EEF2F7` brand-tint | Sixth group |
| Grid lines | `#e8e7e1` | Axes / reference lines |
| Data labels | `#141413` near-black | Numeric text |

### Data limits

| Chart | Max categories | Max series | Template |
|---|---|---|---|
| Bar chart | 8 groups | 3 series | `_shared/assets/diagrams/bar-chart.html` |
| Line chart | 12 points | 3 lines | `_shared/assets/diagrams/line-chart.html` |
| Donut chart | 6 segments | n/a | `_shared/assets/diagrams/donut-chart.html` |
| Candlestick | 30 days | n/a | `_shared/assets/diagrams/candlestick.html` |
| Waterfall | 8 segments | n/a | `_shared/assets/diagrams/waterfall.html` |

### Editing data

Each file has `<!-- DATA START -->` / `<!-- DATA END -->` comments. Only change SVG elements between those markers (`<rect>` coordinates, `<polyline>` points, `<path>` arcs, `<text>` values). Leave surrounding structure and styles untouched.

**Coordinate rules (same as the first three diagram types)**:
- All coordinates divisible by 4
- Bar chart corner radius `rx=2` (distinct from node radius 6-10)
- Line chart: `<polyline>` points format `"x1,y1 x2,y2 ..."`, data points marked with `<circle>`
- Donut chart: `<path>` arcs use `A R R 0 large-arc sweep_flag x y`; `large-arc=1` only when segment > 180°

**Bar / line chart Y-axis formula** (default scale: max=140, chart-height=280, scale=2):
```
bar_height = value × 2
bar_top_y  = 320 - bar_height   (baseline y = 320)
dot_y      = 320 - value × 2
```

**Donut arc coordinates** (cx=300 cy=200 R=136 r=76, clockwise from top at -90°):
```
angle_start = -90 + sum_of_previous_percentages × 3.6
angle_end   = angle_start + this_percentage × 3.6
outer_x = 300 + 136 × cos(angle_deg × π/180)
outer_y = 200 + 136 × sin(angle_deg × π/180)
inner_x = 300 + 76  × cos(angle_deg × π/180)
inner_y = 200 + 76  × sin(angle_deg × π/180)
```

**Candlestick Y-axis formula** (default: price range 100-160, chart-height=280, scale=4.67):
```
candle_y = 320 - (price - 100) * 4.67
Up candle: fill=#1B365D (close > open), body from open_y to close_y
Down candle: fill=#6b6a64 (close < open), body from close_y to open_y
Wick: 1.2px stroke from high_y to low_y, centered on candle
```

**Waterfall formula** (default: max=200, chart-height=280, scale=1.4):
```
bar_y = 320 - value * 1.4
Floating bars: top = running_total_y, height = abs(delta) * 1.4
Positive: fill=#1B365D · Negative: fill=#6b6a64 · Total: fill=#4d4c48
Connector: dashed 0.8px #b8b7b0 between adjacent bar edges
```

---

## 10. Preview

There is no build step in this mode. To sanity-check a diagram, copy its `<svg>` into a page (or open the template file as a content page) and read the live preview; use the `capture` viewer action for a close look (SKILL.md «Verifying your work»). Do not open the raw HTML in an external browser — the paper viewer is the only faithful render.

Each template carries an upstream poster-size `@page` rule sized to its own frame; that is upstream PDF-export plumbing and has no effect inside the paper viewer.

---

## 11. Illustration briefs (generated raster figures)

For raster illustrations produced with the image-generation script (SKILL.md «Image generation» defines when it is available and how to call it). The brief is the deliverable you control; write it tightly and the image model has nowhere to drift.

Switch to a generated illustration (instead of enlarging a hand-assembled SVG) when a figure needs more detail than SVG assembly holds at the target display width — typically teaching-depth figures (section 2, teaching tier).

**Brief skeleton**, in order:

1. Canvas: warm parchment `#f5f4ed`, never pure white; generous whitespace; composed like a figure in a well-typeset report.
2. Accent: ink blue `#1B365D` on the 1-2 focal elements only; everything else warm gray with a yellow-brown undertone; no second hue anywhere.
3. Strokes and icons: thin single-line geometric strokes; flat icons matching section 6 (rounded line style, no fills beyond the two sanctioned ones); no gradients, drop shadows, or 3D.
4. Labels: serif, few, short. Prefer single words; image models misspell long phrases, and a misspelled label voids the image. If a label must be a phrase, plan to typeset it in HTML over the image instead.
5. Content spec: the same complexity budget as section 2 (state the tier: 4/10 editorial or 6-7/10 teaching), what is focal, and the reading direction.

**QC before placing a generated image** (regenerate on any failure, do not retouch expectations):

- Palette holds: parchment ground, single blue accent, no stray hue, no cool grays.
- No gradient, shadow, or 3D crept in.
- Text in the image is spelled correctly and minimal; anything wrong or verbose gets re-briefed with fewer words.
- Composition reads as a report figure (balanced margins, clear focal point), not as a poster or clip art.
- Style matches the other generated images in the same deliverable (shared style anchor — see SKILL.md «Consistency across figures»).

---

## 12. Credit

This capability is inspired by Cathryn Lavery's [diagram-design](https://github.com/cathrynlavery/diagram-design) (a Claude Code skill with 13 editorial diagram types). kami borrowed the **approach** (inline SVG, semantic tokens, complexity budget, anti-slop table). Not the full catalog.
