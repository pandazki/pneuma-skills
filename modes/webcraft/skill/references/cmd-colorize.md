---
name: colorize
description: "Add strategic color to features that are too monochromatic or lack visual interest, making interfaces more engaging and expressive. Use when the user mentions the design looking gray, dull, lacking warmth, needing more color, or wanting a more vibrant or expressive palette."
argument-hint: "[target]"
user-invocable: true
---

Replace timid grayscale or single-accent designs with a strategic palette: pick a color strategy, choose a hue family that fits the brand, then apply color with intent. More color ≠ better. Strategic color beats rainbow vomit.

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it contains the design principles, anti-patterns, and Context Gathering Protocol. If no design context exists yet, you MUST run the `teach` command (see [cmd-teach](cmd-teach.md)) first. Additionally gather: existing brand colors.

---

## Register

Brand: palette IS voice. Pick a color strategy first per SKILL.md (Restrained / Committed / Full palette / Drenched) and follow its dosage. Committed, Full palette, and Drenched deliberately exceed the ≤10% rule; that rule is Restrained only. Unexpected combinations are allowed; a dominant color can own the page when the chosen strategy calls for it.

Product: Restrained by default. Color carries semantic meaning (status, hierarchy, action) rather than decoration; broad surfaces stay neutral. Committed only inside contained accent regions (a marketing card, an empty state, a celebration moment), never across whole task surfaces. Full palette and Drenched are off-register for product unless explicitly briefed.

---

## Assess Color Opportunity

Analyze the current state and identify opportunities:

1. **Understand current state**:
   - **Color absence**: Pure grayscale? Limited neutrals? One timid accent?
   - **Missed opportunities**: Where could color add meaning, hierarchy, or delight?
   - **Context**: What's appropriate for this domain and audience?
   - **Brand**: Are there existing brand colors we should use?

2. **Identify where color adds value**:
   - **Semantic meaning**: Success (green), error (red), warning (yellow/orange), info (blue)
   - **Hierarchy**: Drawing attention to important elements
   - **Categorization**: Different sections, types, or states
   - **Emotional tone**: Warmth, energy, trust, creativity
   - **Wayfinding**: Helping users navigate and understand structure
   - **Delight**: Moments of visual interest and personality

If any of these are unclear from the codebase, {{ask_instruction}}

**CRITICAL**: More color ≠ better. Strategic color beats rainbow vomit every time. Every color should have a purpose.

## Plan Color Strategy

Create a purposeful color introduction plan:

- **Color strategy**: Restrained / Committed / Full palette / Drenched. Choose one and follow its dosage.
- **Color palette**: What colors match the brand/context? (Choose 2-4 colors max beyond neutrals)
- **Dominant color**: Which color owns the majority of colored elements?
- **Accent colors**: Which colors provide contrast and highlights?
- **Application strategy**: Where does each color appear and why?

**IMPORTANT**: Color should enhance hierarchy and meaning, not create chaos. Strategy first, dosage second.

## Introduce Color Strategically

Add color systematically across these dimensions:

### Semantic Color
- **State indicators**:
  - Success: Green tones (emerald, forest, mint)
  - Error: Red/pink tones (rose, crimson, coral)
  - Warning: Orange/amber tones
  - Info: Blue tones (sky, ocean, indigo)
  - Neutral: Gray/slate for inactive states

- **Status badges**: Colored backgrounds or borders for states (active, pending, completed, etc.)
- **Progress indicators**: Colored bars, rings, or charts showing completion or health

### Accent Color Application
- **Primary actions**: Color the most important buttons/CTAs
- **Links**: Add color to clickable text (maintain accessibility)
- **Icons**: Colorize key icons for recognition and personality
- **Headers/titles**: Add color to section headers or key labels
- **Hover states**: Introduce color on interaction

### Background & Surfaces
- **Tinted backgrounds**: Replace pure gray (`#f5f5f5`) with warm neutrals (`oklch(97% 0.01 60)`) or cool tints (`oklch(97% 0.01 250)`)
- **Colored sections**: Use subtle background colors to separate areas
- **Gradient backgrounds**: Add depth with subtle, intentional gradients (not generic purple-blue)
- **Cards & surfaces**: Tint cards or surfaces slightly for warmth

**Use OKLCH for color**: It's perceptually uniform, meaning equal steps in lightness *look* equal. Great for generating harmonious scales.

### Data Visualization
- **Charts & graphs**: Use color to encode categories or values
- **Heatmaps**: Color intensity shows density or importance
- **Comparison**: Color coding for different datasets or timeframes

### Borders & Accents
- **Accent borders**: Add colored left/top borders to cards or sections
- **Underlines**: Color underlines for emphasis or active states
- **Dividers**: Subtle colored dividers instead of gray lines
- **Focus rings**: Colored focus indicators matching brand

### Typography Color
- **Colored headings**: Use brand colors for section headings (maintain contrast)
- **Highlight text**: Color for emphasis or categories
- **Labels & tags**: Small colored labels for metadata or categories

### Decorative Elements
- **Illustrations**: Add colored illustrations or icons
- **Shapes**: Geometric shapes in brand colors as background elements
- **Gradients**: Colorful gradient overlays or mesh backgrounds
- **Blobs/organic shapes**: Soft colored shapes for visual interest

## Balance & Refinement

Ensure color addition improves rather than overwhelms. Dosage depends on the strategy you picked:

### Strategy dosage
- **Restrained**: Tinted neutrals carry most of the surface; one accent ≤10%. The 60/30/10 distribution applies here.
- **Committed**: One saturated color carries 30–60% of the surface. The ≤10% rule does not apply.
- **Full palette**: 3–4 named color roles, each used deliberately and consistently.
- **Drenched**: The surface IS the color. Saturation can cover most of the visible area.

### Accessibility
- **Contrast ratios**: Ensure WCAG compliance (4.5:1 for text, 3:1 for UI components)
- **Don't rely on color alone**: Use icons, labels, or patterns alongside color
- **Test for color blindness**: Verify red/green combinations work for all users

### Cohesion
- **Consistent palette**: Use colors from defined palette, not arbitrary choices
- **Systematic application**: Same color meanings throughout (green always = success)
- **Temperature consistency**: Warm palette stays warm, cool stays cool

**NEVER**:
- Use every color in the rainbow without a strategy (Full palette is still 3–4 deliberate roles, not chaos)
- Apply color randomly without semantic meaning
- Put gray text on colored backgrounds; it looks washed out. Use a darker shade of the background color or transparency instead
- Use pure gray for neutrals; add subtle color tint (warm or cool) for sophistication
- Use pure black (`#000`) or pure white (`#fff`) for large areas
- Violate WCAG contrast requirements
- Use color as the only indicator (accessibility issue)
- Default to purple-blue gradients (AI slop aesthetic)
- Apply the ≤10% accent rule outside the Restrained strategy

## Verify Color Addition

Test that colorization improves the experience:

- **Strategy honored**: Does the actual dosage match the strategy you chose?
- **Better hierarchy**: Does color guide attention appropriately?
- **Clearer meaning**: Does color help users understand states/categories?
- **More engaging**: Does the interface feel warmer and more inviting?
- **Still accessible**: Do all color combinations meet WCAG standards?

When the palette reads as intentional, hand off to the `polish` command (see [cmd-polish](cmd-polish.md)) for the final pass.
