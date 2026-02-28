# Layout Patterns — Height Calculation & Common Layouts

This document provides precise layout calculations for slide content. **Content overflow is the #1 quality issue** — use these rules to prevent it.

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
