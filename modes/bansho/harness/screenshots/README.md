# G7 visual-verification artifacts

Durable screenshot evidence for the T3 bar, captured from the render
harness (`bun modes/bansho/harness/index.html`, viewport 1100×1300,
full-page). Regenerate by serving the harness, driving `#scrub` /
`#theme`, and re-capturing the same four states.

| File | State | Evidences |
|------|-------|-----------|
| `light-t0.png` | light, t = 0 (fresh load) | §7 R1 fail-closed: the board is fully blank before the pen arrives — no stray round-cap dots, no pre-painted text. (The T4/T5 observation captured here — the `.bansho-aside` `border-left` decoration painting before its step is revealed — is FIXED: that border is now a drawn margin bar, one stroke revealable that starts unrevealed like every other. The shot predates the fix.) |
| `light-mid.png` | light, t = 10.9 / 28.7 s | Scrub lands mid-lecture: heading + baseline, first paragraph with in-place highlight, strike / underline / circle on the second, the list item mid-write; the backref circle and the whole chart still absent. |
| `light-end.png` | light, t = end | In-place highlight / strike / underline / circle; the `@circle "874"` backref and the under-text `@highlight` band; chart accumulation with stable series colors (frame series `--s1`, layer series `--s2`), endpoint x labels, the mark below its point in `--accent`; KaTeX MathML inline + block. |
| `dark-end.png` | dark, t = end | The same end state under the dark tokens — chalk fg, dark series / accent tokens resolve via `element.style` (G8-D). (Known T4/T5 observation: `--hl-a: 0.32` bands read muddy over the dark green board.) |
| `dark-t0-after-scrub-back.png` | dark, scrubbed end → 0 | R1 holds under scrubbing, not just fresh load: seek is a pure mapping and the board returns to fully blank. |
