# Layout Patterns — Composition & Height Calculation

Two concerns when laying out a slide: **where content sits in the canvas** (composition) and **whether it fits** (height). Think about composition first, then verify height.

---

## Composition: Thinking About Space

Before writing HTML, look at the content you have and ask: **how much of the 592px vertical space will this fill?** That ratio determines the composition.

### The Key Ratio: Content Height ÷ Available Height

```
Light    (< 40%)    → content floats — needs intentional positioning
Medium   (40–75%)   → natural — content has room to breathe
Dense    (> 75%)    → tight — minimize spacing, consider splitting
```

Don't default to one approach. Each slide needs its own spatial decision based on content.

### Scenario 1: Statement Slide — One Big Idea

Content: a heading + one sentence. ~100px total in a 592px space.

```
✗ Top-aligned (content lost)      ✓ Centered (confident, focused)

┌────────────────────────┐        ┌────────────────────────┐
│ The Future is           │        │                        │
│ Distributed             │        │                        │
│                         │        │  The Future is          │
│ Teams that master...    │        │  Distributed            │
│                         │        │                        │
│                         │        │  Teams that master...   │
│                         │        │                        │
│                         │        │                        │
└────────────────────────┘        └────────────────────────┘
```

**Why**: Sparse content at the top creates a "something is missing" feeling. Centering signals that the emptiness is intentional — the space IS the design.

CSS approach: `justify-content: center` on the slide container.

### Scenario 2: Heading + Medium Content

Content: heading + 3 cards or 4-5 bullets. ~300px in 592px (~50%).

```
✗ Everything centered            ✓ Heading anchored, content centered

┌────────────────────────┐        ┌────────────────────────┐
│                        │        │ Heading (h2)            │
│ Heading (h2)           │        │ subtitle text           │
│ subtitle text          │        │                        │
│                        │        │  ┌────┐ ┌────┐ ┌────┐ │
│  ┌────┐ ┌────┐ ┌────┐ │        │  │ A  │ │ B  │ │ C  │ │
│  │ A  │ │ B  │ │ C  │ │        │  │    │ │    │ │    │ │
│  │    │ │    │ │    │ │        │  └────┘ └────┘ └────┘ │
│  └────┘ └────┘ └────┘ │        │                        │
│                        │        │  callout / footnote     │
└────────────────────────┘        └────────────────────────┘
```

**Why**: When everything centers together, the heading drifts — different slides have headings at different heights, which feels inconsistent when flipping through. Anchoring the heading at a consistent position (top area) while letting the body content sit in the remaining space creates both consistency across slides and balance within each slide.

For **light/medium content** (< 60% fill), use plain `.slide` — everything centers as a group. This is the best default:

```html
<div class="slide">
  <h2>Heading</h2>
  <p>Subtitle</p>
  <div style="display: flex; gap: 20px;">
    <!-- cards etc. -->
  </div>
</div>
```

For **dense content** (60%+ fill), pin heading to top and center the body in remaining space:

```html
<div class="slide" style="justify-content: flex-start;">
  <h2>Heading</h2>
  <p>Subtitle</p>
  <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
    <!-- dense content -->
  </div>
</div>
```

**Do NOT use the heading-top pattern for light content.** A slide with heading + 3 cards looks much better fully centered than with the heading pinned up top and a giant empty gap above the cards.

### Scenario 3: Dense Content — Nearly Full

Content: heading + subtitle + card grid + callout bar. ~450px in 592px (~75%+).

```
✓ Top-aligned (natural fill)      ✗ Forced centering (cramped)

┌────────────────────────┐        ┌────────────────────────┐
│ Heading                 │        │                        │
│ Subtitle paragraph      │        │ Heading                │
│                         │        │ Subtitle paragraph     │
│  ┌────┐ ┌────┐ ┌────┐ │        │  ┌────┐ ┌────┐ ┌────┐ │
│  │ A  │ │ B  │ │ C  │ │        │  │ A  │ │ B  │ │ C  │ │
│  │    │ │    │ │    │ │        │  │    │ │    │ │    │ │
│  └────┘ └────┘ └────┘ │        │  └────┘ └────┘ └────┘ │
│  ═══ callout bar ═══   │        │  ═══ callout bar ═══  │
└────────────────────────┘        └────────────────────────┘
```

**Why**: Dense content that fills 75%+ of the space looks balanced either way. Top alignment with generous bottom margin is fine — the content mass itself provides visual weight. Forced centering compresses the gaps and makes it feel tight.

CSS approach: normal flow with padding, or `justify-content: flex-start`. The content naturally fills the space.

### Scenario 4: Asymmetric Split — Uneven Columns

Content: left side has a diagram/list (~300px), right side has text descriptions (~200px). Both sit in a 500px column space.

```
✗ Both top-aligned               ✓ Each column centered internally

┌────────────────────────┐        ┌────────────────────────┐
│ Heading                 │        │ Heading                │
│ ┌─────────┐ ┌────────┐│        │ ┌─────────┐            │
│ │ diagram │ │ Desc A ││        │ │         │            │
│ │ with 4  │ │ Desc B ││        │ │ diagram │ ┌────────┐│
│ │ stages  │ │ Desc C ││        │ │ with 4  │ │ Desc A ││
│ │         │ └────────┘│        │ │ stages  │ │ Desc B ││
│ └─────────┘            │        │ │         │ │ Desc C ││
│            HOLE ↑      │        │ └─────────┘ └────────┘│
│                        │        │                        │
└────────────────────────┘        └────────────────────────┘
```

**Why**: When both columns use `flex:1`, they stretch to the same height — but their *content* may be very different heights. Top-aligning both creates a visual hole under the shorter column. Each column needs its own internal vertical centering.

**CSS approach**: Both columns must have `display:flex; flex-direction:column; justify-content:center;` — centering their own content within the stretched column height. Do NOT rely on `align-items:center` on the parent row — that only works when columns aren't `flex:1`.

```html
<!-- ✗ WRONG: column content falls to top -->
<div style="flex:1;display:flex;flex-direction:column;gap:0;">
  ...diagram nodes...
</div>

<!-- ✓ RIGHT: column content centered within its space -->
<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:0;">
  ...diagram nodes...
</div>
```

### Scenario 5: Full-Bleed Visual with Overlay Text

Content: hero image + a few lines of text.

```
┌────────────────────────┐        ┌────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓ Text centered ▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓ on image     ▓▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓ Title              ▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓ Subtitle — detail  ▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└────────────────────────┘        └────────────────────────┘
  Center (keynote feel)             Bottom-left (editorial)
```

**Why**: Full-bleed images break the normal padding rules. Text placement depends on the image composition and the mood you want. Center for dramatic, bottom-left/right for editorial, top for documentary. The overlay gradient must guarantee contrast wherever the text sits.

### Scenario 6: Heading + Sparse Items + Bottom Anchored Element

Content: heading + 2 items + a takeaway bar at the bottom.

```
✗ Sequential flow, gap at bottom  ✓ Heading top, items center, bar bottom

┌────────────────────────┐        ┌────────────────────────┐
│ Heading                 │        │ Heading                │
│                         │        │                        │
│ ┌──────┐  ┌──────┐    │        │                        │
│ │ Pro  │  │ Con  │    │        │  ┌──────┐  ┌──────┐   │
│ │      │  │      │    │        │  │ Pro  │  │ Con  │   │
│ └──────┘  └──────┘    │        │  │      │  │      │   │
│                         │        │  └──────┘  └──────┘   │
│ ═ Takeaway bar ════    │        │                        │
│                         │        │ ═ Takeaway bar ═══════ │
└────────────────────────┘        └────────────────────────┘
```

**Why**: When a slide has a clear footer element (takeaway, citation, CTA), anchoring it to the bottom (`margin-top: auto`) creates a three-zone composition: heading (top), main content (middle/center), footer (bottom). The space distributes intentionally rather than piling everything up.

### Choosing the Right Slide Class

The base theme provides several slide classes. Pick based on content volume:

| Class | CSS | When to use |
|-------|-----|-------------|
| `slide` | `justify-content: center` | **Default.** Most content slides. Content is vertically centered as a group. |
| `slide-title` | `center` + `text-align: center` | Cover/title slides. Centered both ways. |
| `slide-split` | `flex-direction: row` | Pre-built two-column. Columns auto-center via `align-items: center`. |
| `slide-content` | `justify-content: flex-start` | **Only for truly dense pages** (>80% fill). Content flows from top and naturally fills the space. If you use this and there's visible bottom whitespace, you chose wrong — switch to `slide`. |

**The most common mistake**: using `slide-content` (top-aligned) for medium-density content, creating a top-heavy slide with empty bottom. When in doubt, use `slide`.

**Do NOT override `justify-content` on `.slide` unless content fills 60%+ of vertical space.** When you do use `justify-content: flex-start`, you MUST wrap the body content in a `flex:1` centering wrapper (see Scenario 2 dense pattern). Never use `flex-start` without the body wrapper — it creates top-heavy slides with empty bottoms.

### The `flex:1` Trap

`flex:1` on a child container inside a slide stretches it to fill all remaining vertical space. If the actual content inside doesn't fill that stretched container, you get invisible bottom whitespace.

```
✗ flex:1 stretches, content floats at top

┌─ slide-content (flex-start) ────┐
│ Heading                          │
│ Subtitle                         │
│ ┌─ split (flex:1) ─────────────┐│
│ │ ┌─ left ──┐  ┌─ right ──┐   ││
│ │ │ Board   │  │ Timeline │   ││
│ │ │ content │  │ content  │   ││
│ │ │         │  │          │   ││
│ │ └─────────┘  └──────────┘   ││
│ │                              ││  ← invisible gap
│ │         (empty flex:1)       ││  ← because flex:1
│ │                              ││  ← stretched the box
│ └──────────────────────────────┘│
└──────────────────────────────────┘

✓ Fix: use class="slide" (center) and drop flex:1

┌─ slide (center) ────────────────┐
│                                  │
│ Heading                          │
│ Subtitle                         │
│ ┌─ split ──────────────────────┐│
│ │ ┌─ left ──┐  ┌─ right ──┐   ││
│ │ │ Board   │  │ Timeline │   ││
│ │ │ content │  │ content  │   ││
│ │ └─────────┘  └──────────┘   ││
│ └──────────────────────────────┘│
│                                  │
└──────────────────────────────────┘
```

**Rule**: `flex:1` is correct in exactly one pattern — the **body centering wrapper** (see Scenario 2), where `flex:1` + `justify-content:center` centers body content in remaining space after the heading. Do NOT use `flex:1` on arbitrary content containers expecting them to visually fill the stretched space.

### Composition Checklist (per slide, not per deck)

Before writing each slide's HTML, briefly consider:

1. **Content mass**: How much of the 592px will my content fill?
2. **Zones**: Does this slide have distinct zones (heading / body / footer)?
3. **Column balance**: In split layouts, does each column center its own content? (Scenario 4)
4. **Adjacent slides**: Will the heading position feel consistent with neighboring slides?
5. **Whitespace role**: Is the empty space intentional (breathing room) or accidental (forgot to position)?

---

## Canvas Dimensions

- **Total canvas**: 1280px × 720px
- **Content page padding**: 64px all sides (`var(--slide-padding)`)
- **Available content area**: 1152px × 592px
- **Safety margin (15%)**: Recommended max content height: ~500px

## Height Calculation Fundamentals

### Rule 1: Text Height

```
text_height = font_size × line_height × number_of_lines
```

| Element | Font Size | Line Height | Per-Line Height |
|---------|-----------|-------------|-----------------|
| h1 (title) | 48px | 1.2 | 57.6px |
| h2 (heading) | 28px | 1.3 | 36.4px |
| h3 (subhead) | 22px | 1.4 | 30.8px |
| Body text | 20px | 1.7 | 34px |
| List item | 20px | 1.8 | 36px |
| Caption | 14px | 1.5 | 21px |

**Examples**:
- h2 heading (1 line): 28px × 1.3 = 36.4px
- 4 bullet points: 4 × (20px × 1.8) = 144px (+ margin between items)
- 3-line paragraph: 20px × 1.7 × 3 = 102px

### Rule 2: Element Height

```
element_height = content_height + padding_top + padding_bottom + margin_top + margin_bottom
```

**Example — Card element**:
```
content: 100px (heading + 3 lines of text)
padding: 24px top + 24px bottom = 48px
margin-bottom: 16px
───────────────────
total: 164px
```

### Rule 3: Layout Direction (Critical!)

**Horizontal layout** (flex-row, grid columns):
```
total_height = max(child_heights)
```
Three cards side by side, each 160px → Total: 160px

**Vertical layout** (flex-column, block flow):
```
total_height = sum(child_heights) + sum(gaps)
```
Three cards stacked, each 160px, gap 16px → Total: 160+16+160+16+160 = 512px

### Rule 4: Common Spacing Values

| CSS | Pixels | Typical Use |
|-----|--------|-------------|
| gap: 8px | 8 | Tight inline spacing |
| gap: 16px | 16 | List items, card grid |
| gap: 24px | 24 | Content sections |
| gap: 32px | 32 | Major blocks |
| gap: 48px | 48 | Split columns |
| padding: 16px | 16 | Small containers |
| padding: 24px | 24 | Cards |
| padding: 32px | 32 | Medium containers |
| padding: 64px | 64 | Slide padding |
| margin-bottom: 8px | 8 | Between related items |
| margin-bottom: 16px | 16 | Between paragraphs |
| margin-bottom: 24px | 24 | After headings |

---

## Common Layout Calculations

### Layout A: Heading + Bullet List

```
Available: 592px (after 64px padding on 720px canvas)

h2 heading:          36px + 24px margin-bottom = 60px
5 bullet points:     5 × 36px + 4 × 8px gap = 212px
──────────────────────────────
Total:               272px ✅ (well within 592px)
```

Safe for up to **10 bullet points** (396px).

### Layout B: Heading + 3-Column Card Grid

```
Available: 592px

h2 heading:          36px + 24px margin-bottom = 60px
Cards (horizontal):  max card height
  Each card:         24px padding-top
                     22px (h3 title)
                     16px gap
                     3 × 34px body text = 102px
                     24px padding-bottom
                     ─────────
                     188px per card
──────────────────────────────
Total:               60px + 188px = 248px ✅
```

Safe. Can add a subtitle or description paragraph above the cards.

### Layout C: Heading + Two-Column Split

```
Available: 592px

h2 heading:          36px + 24px margin-bottom = 60px
Columns (horizontal): max(left, right)
  Left column:       4 bullet points = 4 × 36px + 3 × 8px = 168px
  Right column:      Chart container = 300px
  Max:               300px
──────────────────────────────
Total:               60px + 300px = 360px ✅
```

### Layout D: Cover Page (No Padding)

```
Available: 720px (full canvas, no padding)

Top spacer:          ~200px (visual centering)
Tag/badge:           30px + 24px margin
h1 title:            58px (48px × 1.2) + 16px margin
Subtitle (p):        34px
Bottom spacer:       ~358px
──────────────────────────────
Total content:       162px centered in 720px ✅
```

### Layout E: Dense — Heading + Subtitle + Card Grid + Footer

```
Available: 592px

h2 heading:          36px + 8px margin = 44px
Subtitle (p):        34px + 24px margin = 58px
3-col cards:         188px (see Layout B)
Footer note:         21px (14px × 1.5) + 16px margin-top = 37px
──────────────────────────────
Total:               327px ✅ (but getting dense — consider splitting)
```

---

## Overflow Warning Signs

**Split the slide** if any of these apply:

- Total calculated height > 500px (approaching 592px limit)
- More than 6 bullet points with detailed text
- Card grid + additional content below/above
- Multiple charts or data tables on one slide
- Body text exceeding 4-5 lines per section

**Quick fixes for mild overflow**:

- Reduce font size by one step (20px → 18px for body)
- Reduce gap between items (24px → 16px)
- Remove one bullet point or card
- Move supporting text to a caption

---

## Slide Type Reference

| Type | Padding | Layout | Typical Content |
|------|---------|--------|-----------------|
| Cover | 0-32px | Centered flex | Title, subtitle, badge, background |
| Content | 64px | Column | Heading + body content |
| Split | 64px | Row (2 cols) | Text + image/chart |
| Cards | 64px | Grid (2-4 cols) | Feature cards, team, metrics |
| Chart | 64px | Column | Heading + large chart |
| Image | 0-32px | Centered | Full-bleed image + caption |
| Summary | 64px | Centered | Closing message, CTA |
| Quote | 64px | Centered | Large quote text + attribution |
