# Design Outline Template

Use this template when creating a new presentation deck. Fill in each section based on the user's brief and source materials. Save as `design_outline.md` in the workspace root.

---

```markdown
# Design Outline: {Deck Title}

## Design Goals

- **Purpose**: [What is this presentation for? Pitch, report, teaching, etc.]
- **Audience**: [Who will view this? Investors, executives, students, team members]
- **Tone**: [Professional / Casual / Bold / Minimalist / Playful]
- **Key message**: [The single most important takeaway]
- **Style direction**: [Visual references, color mood, industry conventions]
- **Language**: [Primary language for all slide content]

## Visual Style

- **Color scheme**: [Dark/Light mode, primary color, accent color]
- **Typography**: [Heading font, body font — or "use theme defaults"]
- **Visual elements**: [Charts, icons, photography, illustrations, diagrams]
- **Density**: [Sparse/spacious vs. information-dense]

## Slide Structure

List all slides in order with type annotations:

1. **Cover** — Title, subtitle, visual hook
2. **Problem/Context** — Why this matters
3. **Solution/Approach** — Core proposition
4. **Details/Features** — Key capabilities or arguments (1-3 slides)
5. **Data/Evidence** — Numbers, charts, proof points
6. **Summary/CTA** — Closing message, call to action

## Per-Slide Content

For each slide, plan the **content → composition → visual** as one spatial decision, not separately.

### Slide 1: Cover
- **Type**: Cover
- **Content**: Title "...", subtitle "..."
- **Composition**: Centered, generous whitespace, [background gradient / hero image / logo]
- **Notes**: [Any special requirements]

### Slide 2: {Title}
- **Type**: Content
- **Content**: Headline "...", 3 key points with supporting detail
- **Composition**: [e.g. "heading top, 3 cards centered in remaining space" / "split: text left, diagram right, columns vertically centered" / "dense — content fills naturally, top-aligned"]
- **Visual**: [e.g. "icon per card" / "bar chart right column, ~300px tall" / "full-bleed background with gradient overlay" / "none — typography only"]

### Slide 3: {Title}
...

## Image & Visual Plan

- **Overall style**: [Photographic / Illustrated / Minimal / Data-heavy]
- **User-provided images**: [List any images the user has in assets/]
- **Images to generate**: [Description, purpose, which slide, approximate size/position]
- **CSS/SVG visuals**: [Diagrams, charts, decorative elements that can be built in code]

## Additional Constraints

- [Any specific requirements: brand guidelines, time limit, export format]
- [Content that must NOT be included]
- [Accessibility requirements]
```

---

## Tips for Writing Good Outlines

1. **Be specific about content**: Don't just write "data slide" — specify which data points, what chart type, what conclusion to draw
2. **Think about flow**: Each slide should logically lead to the next. The narrative should work without a presenter
3. **Plan density carefully**: One key idea per slide for presentations; more density OK for read-along decks
4. **Composition is a per-slide decision**: Think about how much content you have and where it belongs in the 592px vertical space. A slide with 2 cards needs different spatial treatment than one with 8 items. See `{SKILL_PATH}/references/layout-patterns.md` → Composition
5. **Plan visuals alongside layout**: A "split: text left, chart right" slide needs to know the chart exists at outline time — the visual is part of the composition, not an afterthought
6. **Use image generation when available**: If you have access to AI image generation (check the Image Handling section in SKILL.md), proactively plan generated images in the outline — cover hero images, section mood visuals, illustrative photos. Write concrete descriptions in "Images to generate" rather than defaulting to "none". A deck with well-chosen images is significantly more engaging than CSS-only.
7. **Specify language explicitly**: If the user writes in Chinese but wants English slides (or vice versa), note this clearly
