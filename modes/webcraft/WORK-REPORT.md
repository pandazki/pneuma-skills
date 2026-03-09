# WebCraft Mode — Work Report

## Summary

Created a new Pneuma built-in mode called **WebCraft** that integrates [Impeccable.style](https://impeccable.style) AI design intelligence with a live web preview workspace.

**Key Outcome:** Users get a left-side iframe preview of their web project with a right-side Claude Code chat, plus an Impeccable command sidebar with all 17 design commands as clickable buttons.

---

## What Was Built

### Files Created (30 files)

```
modes/webcraft/
├── manifest.ts                         # ModeManifest — pure data, no React
├── pneuma-mode.ts                      # ModeDefinition — viewer + context extraction
├── viewer/
│   ├── WebPreview.tsx                   # Iframe preview + Impeccable command sidebar
│   └── scaffold.ts                     # Workspace scaffold generator
├── seed/
│   └── index.html                      # Starter template (OKLCH, fluid type, semantic)
└── skill/
    ├── SKILL.md                        # Main skill (design principles + 17 commands)
    └── references/
        ├── typography.md               # From Impeccable — type scales, pairing, loading
        ├── color-and-contrast.md       # OKLCH, palettes, dark mode, contrast
        ├── spatial-design.md           # Grids, rhythm, container queries
        ├── motion-design.md            # Timing, easing, reduced motion
        ├── interaction-design.md       # States, focus, forms, loading patterns
        ├── responsive-design.md        # Mobile-first, fluid design, breakpoints
        ├── ux-writing.md               # Labels, errors, empty states, voice
        ├── cmd-teach-impeccable.md     # Gather design context
        ├── cmd-audit.md                # Technical quality audit
        ├── cmd-critique.md             # UX design review
        ├── cmd-normalize.md            # Design system alignment
        ├── cmd-polish.md               # Final quality pass
        ├── cmd-distill.md              # Strip to essence
        ├── cmd-clarify.md              # Improve UX copy
        ├── cmd-optimize.md             # Performance improvements
        ├── cmd-harden.md               # Error handling, i18n, edge cases
        ├── cmd-animate.md              # Motion effects
        ├── cmd-colorize.md             # Strategic color
        ├── cmd-bolder.md               # Amplify impact
        ├── cmd-quieter.md              # Tone down
        ├── cmd-delight.md              # Add joy
        ├── cmd-extract.md              # Design system extraction
        ├── cmd-adapt.md                # Responsive adaptation
        └── cmd-onboard.md             # Onboarding flows
```

### Files Modified (1 file)

- `core/mode-loader.ts` — Added `webcraft` entry to `builtinModes` registry

### Test File Created

- `server/__tests__/webcraft-e2e.test.ts` — 62 tests covering all aspects

---

## Architecture Decisions

1. **Iframe-based preview** (like Doc mode) — serves workspace HTML via `/content/*` endpoint with auto-refresh on file changes.

2. **Command sidebar** — all 17 Impeccable commands organized into 6 collapsible categories (Setup, Review, Refine, Performance, Style, Architecture). Clicking sends `onNotifyAgent` which delivers a message to Claude.

3. **Reference-based command dispatch** — instead of inlining all 17 command prompts into SKILL.md (which would be massive), each command references a separate `cmd-*.md` file. The agent reads the reference when a command is invoked.

4. **Seed HTML follows Impeccable principles** — OKLCH colors, fluid typography with `clamp()`, DM Serif Display + DM Sans fonts, semantic HTML, responsive, reduced motion support, no "AI slop" aesthetics.

---

## Testing Results

### Automated Tests: 378/378 pass (62 new + 316 existing)

| Category | Tests | Status |
|----------|-------|--------|
| Mode loading | 2 | Pass |
| Manifest validation | 5 | Pass |
| Skill installation | 4 | Pass |
| SKILL.md content | 6 | Pass |
| Reference completeness | 7 | Pass |
| CLAUDE.md injection | 7 | Pass |
| Seed file | 3 | Pass |
| Seed quality (Impeccable principles) | 11 | Pass |
| Viewer actions | 5 | Pass |
| Watch patterns | 5 | Pass |
| Template placeholders | 4 | Pass |
| TypeScript compilation | - | No new errors |

### Visual E2E Tests (browser)

| Test | Result |
|------|--------|
| Mode launches successfully | Pass |
| Skill files install (25 files) | Pass |
| CLAUDE.md generated correctly | Pass |
| Seed HTML seeded for empty workspace | Pass |
| Iframe preview renders seed page | Pass (fixed initial load race condition) |
| Command sidebar renders 6 categories | Pass |
| Category expand/collapse works | Pass |
| Command button click sends to agent | Pass |
| Agent receives and processes command | Pass |
| Agent reads command reference file | Pass |
| Agent generates structured audit report | Pass |

### Impeccable "Audit" Command — Live Test Results

Ran the `/audit` command on the seed HTML. The agent produced a detailed report that:

**Found real issues:**
- Missing `:focus-visible` styles on interactive elements
- Missing `<main>` landmark
- Missing `type="button"` on `<button>` elements
- Missing skip-navigation link
- Broken nav links (`#about`, `#contact` sections don't exist)
- Logo not wrapped in a link
- Hard-coded colors (oklch literal in `.btn-primary` instead of token)
- SVGs missing `aria-hidden`
- Feature icons in rounded accent boxes flagged as "AI anti-pattern"

**Prioritized recommendations:**
1. Immediate — accessibility blockers
2. Short-term — semantic/theming fixes
3. Medium-term — design quality improvements (break card grid pattern, add dark mode)

---

## Impeccable.style Assessment

Having deeply studied and integrated Impeccable, here's my assessment:

### Strengths

1. **The anti-pattern approach is brilliant.** Most design guides tell you what TO do. Impeccable also tells you what NOT to do, which is far more effective at preventing "AI slop" — the generic, samey look of AI-generated interfaces (cyan-on-dark, purple gradients, card grids, Inter font everywhere).

2. **The 17 commands are well-scoped.** Each has a specific purpose that doesn't overlap much with others. The audit/critique/polish pipeline is particularly useful — audit documents problems, then other commands fix them.

3. **Reference documents are substantive.** The 7 design references (typography, color, spatial, motion, interaction, responsive, UX writing) are genuinely educational — OKLCH color space, fluid type scales, exponential easing, container queries.

4. **Cross-provider design is smart.** The template variable system (`{{model}}`, `{{config_file}}`) lets one source serve Claude Code, Cursor, Gemini, Codex, VS Code Copilot, and Kiro.

### Observations

1. **It's prompt engineering, not code.** The entire distributable is markdown files. There's no CSS framework, no JS library — just carefully crafted instructions that shape how AI agents write frontend code.

2. **The "AI Slop Test" is the signature idea.** "If you showed this interface to someone and said 'AI made this,' would they believe you immediately? If yes, that's the problem." This single framing does more than pages of rules.

3. **Commands are effective in Pneuma context.** The audit command produced genuinely useful feedback on the seed HTML, catching both accessibility issues and design anti-patterns. The prioritized recommendations are actionable.

4. **The `teach-impeccable` command is interesting.** It creates a persistent design context file with project-specific preferences (brand, audience, aesthetic direction), which guides all subsequent commands. This is similar to Pneuma's evolution agent concept.

### Potential Improvements

- Some reference documents contain the template placeholder `{{ask_instruction}}` which the agent needs to interpret at runtime. Pre-resolving these during skill install would be cleaner.
- The commands could benefit from a "dry run" mode that previews changes before applying them.
