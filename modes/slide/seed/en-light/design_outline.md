# Pneuma Slide — Architecture Demo Deck

## Design Goals
- **Purpose:** Showcase the core architecture and features of Pneuma Skills entirely within its own `slide` mode.
- **Audience:** Developers, builders, and early adopters excited about Agentic UX.
- **Tone:** Technical, confident, visionary — "We fixed the Agent UI problem."
- **Key Message:** "Pneuma Skills is a WYSIWYG Delivery Platform for Code Agents."
- **Style Direction:** Humanistic-tech fusion — warm cream/beige canvas, burnt orange/blue accents, clean typography, precise layouts.

## Visual Style
- **Color Scheme:** Warm light mode
  - Background: warm cream (#FAF7F2)
  - Text: deep charcoal (#2D2A26)
  - Primary: burnt orange (#D4632A)
  - Accent: warm gold (#C4963A)
  - Secondary/Tech: steel blue (#5B8DB5)  <-- *New element introduced in slides*
  - Surface: soft ivory (#F0EBE3)
  - Border: warm gray (#DDD5CA)
  - Muted: warm gray text (#8A8178)
- **Typography:** Inter for headings, clean sans-serif body, monospace for code blocks.
- **Visual Elements:** Geometric accent shapes, beautifully aligned block elements, subtle dashed borders for "element selection" concepts.

## Slide Structure (11 slides)

1. **Cover** — "Pneuma Slide: WYSIWYG Delivery Platform for Code Agents"
2. **The Philosophy** — "A Canvas for the Blind AI" (AI is the brush, Viewer is the canvas)
3. **The 4-Layer Architecture** — Mode Protocol, Viewer, Agent Bridge, Runtime Shell
4. **The Dual-Channel Bridge** — WebSocket orchestration (NDJSON <-> JSON)
5. **Viewer Context** — Element selection mapping to `<viewer-context>` 
6. **Agent-Callable Actions** — Seamless UI manipulation from the CLI
7. **Mode Maker** — Generating new modes using AI
8. **Design System** — CSS Custom Properties & `theme.css`
9. **Smart Layout Engine** — Overflow prevention, precise calculations
10. **Export & Present** — Export to Print/PDF, Grid views
11. **CTA** — Clone, hack, and build your own Mode.
