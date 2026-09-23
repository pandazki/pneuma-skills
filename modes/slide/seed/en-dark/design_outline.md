# Design Outline: Pneuma Slide Mode — for developers and builders

## Design Goals

- **Purpose**: Introduce Pneuma's slide mode and get people to run it once
- **Audience**: Developers and builders who already use code agents (Claude Code, Codex, Kimi)
- **Tone**: Precise, editorial, quietly confident. Claims stay factual.
- **Key message**: The agent writes plain HTML files; Pneuma turns them into a live deck you can watch, point at, and ship.
- **Language**: English

## Visual Style

- **Concept**: The deck documents itself. Every slide carries a thin "chrome" rail with the file path it lives in (`slides/slide-04.html`) and a folio, so the audience always sees the file behind the picture.
- **Two themes, one set of slides**: `en-dark` (Ember: warm ink black, ember orange) and `en-light` (Paper: warm cream, vermilion). The two content sets have byte-identical `slides/` and `manifest.json`; only `theme.css` differs. Every color in slide HTML goes through a CSS variable. Slide 7 reads its swatch labels from theme.css via `content: var(--label-*)`, so it describes whichever theme is active.
- **Typography**: Instrument Serif (display, with italic for emphasis), Geist (UI/body), Geist Mono (paths, code, labels). CJK system fallbacks in both stacks.
- **Visual elements**: CSS/SVG diagrams, code panels, a viewer-style selection box. One generated illustration (slide 6) shown as a framed print so it reads on both themes.
- **Density**: Spacious. One idea per slide.
- **Legibility floor**: body 18px+; mono metadata (rail, kickers, captions, code labels) 15-16px so it survives projection. Small text meets 4.5:1 on every surface it sits on, in both themes. Only the miniature slide drawings on slides 3, 5 and 9 go smaller, because they depict thumbnails.

## Slide Structure

1. **Cover**: "Your agent / writes the deck. / You watch it take shape." (three set lines) A fanned stack of slide frames, the top one mid-write.
2. **The premise**: Agents already do the work; what's missing is a way to watch and step in. Pneuma Skills = co-creation infrastructure for humans x code agents.
3. **Files in, deck out**: Workspace tree (manifest.json, theme.css, slides/*.html, assets/) feeds the live player. 1280x720 HTML fragments.
4. **Watch the deck take shape**: Session timeline: outline, scaffold, cover, content, and the deck filling in slide by slide.
5. **Point, don't describe**: Mock slide with selection box, the `<viewer-context>` address it produces, and the one-line edit.
6. **Images that belong to the deck**: Prompt on the left, framed print on the right. GPT Image 2.5 via OpenRouter: generate new images or edit your own.
7. **One file holds the whole look**: Tokens rendered live from theme.css; this deck ships two.
8. **Every slide fits**: The 1280x720 canvas with 64px padding, height math, and `checkContentFit` output.
9. **From editor to stage**: Presenter mode, PDF / image export, drag-reorder, content sets.
10. **It's all files**: Plain HTML/CSS in git, viewer actions over HTTP, any backend, preferences that persist.
11. **Start**: `bunx pneuma-skills slide --workspace ./my-first-deck`, desktop app, prerequisites, repo link.

## Image Plan

- Slide 6: risograph-style cutaway of the Svalbard seed vault, teal + orange on cream, 4:3, as a sample "illustration for someone else's deck". Prompt shown verbatim on the slide. Shipped as a 1024x768 JPEG (about 210 KB).
- All other visuals are CSS/SVG.
