# Refinement Practices

When a deck is functionally complete and the user wants to improve its quality, apply these practices. They're ordered from broad to specific — start with critique, then refine.

---

## Critique: Evaluate Design Effectiveness

Step back and evaluate the deck as a whole. Think like a design director giving feedback.

**Process**:
1. **Intentionality check** (first): Can you articulate the design direction? Does every major choice (color, font, layout, tone) serve that direction? Or does the deck feel like a collection of defaults?
2. **Visual hierarchy**: On each slide, is it immediately obvious what matters most? Can you spot the key point in 2 seconds?
3. **Consistency**: Do all slides feel like they belong to the same deck? Same fonts, colors, spacing patterns?
4. **Composition**: Does each slide feel balanced? Is whitespace intentional or leftover?
5. **Emotional resonance**: What emotion does this deck evoke? Is that the right one for the audience and content?
6. **Flow**: Does the deck tell a story? Does the visual energy build, peak, and resolve?

**Output**: Identify the top 3-5 issues, ordered by impact. For each: what's wrong, why it matters, and how to fix it.

---

## Polish: The Final Quality Pass

Fix the details that separate good from great. Only do this after the deck is content-complete.

**Checklist**:
- [ ] **Alignment**: All elements snap to a consistent grid. No random offsets.
- [ ] **Spacing consistency**: All gaps follow the spacing scale. No arbitrary values.
- [ ] **Typography hierarchy**: Same-role text uses same size/weight across all slides
- [ ] **Widows**: No single words sitting alone on the last line of a heading or bullet
- [ ] **Color token usage**: No hard-coded colors — everything uses CSS custom properties
- [ ] **Icon consistency**: All icons from the same family, same size, same stroke weight
- [ ] **Image treatment**: Consistent border-radius, shadow, and sizing for images across slides
- [ ] **Capitalization**: Consistent across all headings, labels, and bullets
- [ ] **Content fit**: Re-verify no slide overflows (mental height calculation or layout_check.js)

**Optical adjustments**:
- Text aligned to padding may look indented due to letterform whitespace — adjust visually if needed
- Icons next to text may need slight vertical offset for optical alignment
- Centered text groups may need slight upward offset to feel visually centered (mathematical center ≠ optical center)

---

## Distill: Simplify Overcrowded Slides

Strip unnecessary complexity to reveal what actually matters.

**When to apply**: A slide feels cramped, has too many elements competing for attention, or tries to communicate multiple ideas at once.

**Process**:
1. **Identify the ONE key message** of the slide. If you can't, it needs splitting.
2. **Remove elements** that don't serve the message — ornamental shapes, redundant icons, background patterns that add noise
3. **Reduce variety** — fewer colors, fewer font sizes, fewer visual treatments per slide
4. **Flatten structure** — remove wrapper elements that don't create meaningful grouping
5. **Shorten text** — cut every line in half. Then do it again.
6. **Add space** — let what remains breathe

**The test**: Cover half the slide with your hand. Does the other half still communicate the message? If not, the slide is too spread out. If yes, the covered half may be unnecessary.

---

## Bolder: Amplify Visual Impact

Make a flat or forgettable deck more visually memorable.

**When to apply**: The deck is technically correct but feels generic, safe, or like every other deck on the same topic.

**Think about**:
- **Scale contrast**: Is the difference between heading and body dramatic enough to feel intentional?
- **Weight contrast**: Are you using enough range in font weight to create clear levels?
- **Color confidence**: Is the palette committed to something, or hedging with muted everything?
- **Composition**: Is every slide centered and symmetrical? Could asymmetry or unexpected proportions (70/30, 80/20 splits) create more visual interest?
- **Negative space**: Could dramatic whitespace — leaving 30-40% of a slide empty — make the content feel more important, not less?
- **Full-bleed**: Could hero images or colored backgrounds extend to the edges for impact?

**The key question**: Does this deck look like it has an opinion? Or could it be about anything?

---

## Quieter: Refine and Restrain

Tone down overly aggressive or visually noisy decks.

**When to apply**: The deck is overstimulating — too many colors, too much contrast, too many effects, elements competing for attention.

**Think about**:
- **Saturation**: Could shifting to 70-85% of current saturation feel more sophisticated?
- **Weight**: Could lighter heading weights create elegance instead of force?
- **Decoration**: Is every gradient, shadow, and pattern earning its place? Remove those that don't.
- **Space**: Could more whitespace reduce visual tension?
- **Color count**: Could fewer colors, used more intentionally, have more impact?

**The key question**: Does the design feel confident or anxious? Quiet design doesn't shout — it doesn't need to.

**Watch out**: Don't strip so far that the deck loses personality. Quiet ≠ boring. Refined ≠ generic. Hierarchy still matters — some things should stand out.

---

## Colorize: Add Strategic Color

Introduce color to monochromatic or visually flat decks.

**When to apply**: The deck feels too gray, too cold, or visually monotonous.

**Think about**:
- **Purpose**: What should color *do* here? Draw attention to key data? Create section identity? Add warmth? Reinforce a brand?
- **Where, not how much**: Coloring the one number or word that carries the slide's message is worth more than coloring every heading
- **Backgrounds**: Subtle background tints can separate sections or add warmth without adding noise
- **Chart and data colors**: Should match the deck's palette, not the charting library's defaults
- **Neutral warmth**: Even without accent colors, shifting from pure gray to warm or cool tinted neutrals can make a deck feel less sterile

**The key question**: Is the lack of color a deliberate choice (and working well), or is it an oversight that's making the deck feel lifeless?
