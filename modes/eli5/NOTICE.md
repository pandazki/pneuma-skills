# NOTICE

This mode borrows content from an upstream project. This file pins what we
took, what we adapted, what we dropped, and tracks the upstream version so
future updates can be diff-merged.

## Upstream

- **Name**: ELI5 — Explain Like I Am 5 (a Claude Code skill by Andrew Ou)
- **URL**: https://github.com/DreambigOu/ELI5
- **License**: MIT
- **Version pinned**: commit `a766623b062331fdde53467001379b4ddf3acc2f` (2026-03-18)
- **Synced at**: 2026-08-24

## What we borrowed

Files in this mode that contain content originating upstream — the audience
taxonomy, its calibration guidance, and the explanation structure.

| Pneuma file | Upstream source | Note |
|---|---|---|
| `skill/references/audience-calibration.md` | `skills/eli5/SKILL.md` — "Step 1: Identify the Audience" (Ages / Grade Levels / Job Roles / Relationships tables), "Language Calibration", "Tone Matching" | Adapted, not transcribed: rewritten in this project's voice, every row extended with a **page visual register** column that upstream (text-only) had no need for and a **what lands as understanding** column that names the evidence each reader is convinced by, and extended with rows upstream did not carry (Executive/CEO, Client/Customer, Colleague, and a Formations section for arts/humanities-educated and practitioner readers). |
| `skill/SKILL.md` — "The shape of an explanation" | `skills/eli5/SKILL.md` — "Step 3: Craft the Explanation → Structure" | The four beats (what → analogy → details → so-what) are upstream's, kept intact because they are the load-bearing idea. |
| `skill/SKILL.md` — "Same truth, different register" | `skills/eli5/SKILL.md` — "Important Reminders" | Upstream's "never talk down", "purpose before mechanism", and "80% accuracy beats losing the audience" principles, restated with Pneuma's cause-and-effect rule style. |
| `skill/SKILL.md` frontmatter `description` | `skills/eli5/SKILL.md` frontmatter `description` | Trigger-phrase list adapted; Pneuma-specific workspace framing added. |
| `seed/database-index/` | `skills/eli5/SKILL.md` — "Examples" (the database-index / age 5 example) | Homage, not a copy. Upstream's canonical worked example became a three-rung seed explainer; the page content is written for this mode. |

## What we adapted

Concepts we kept the *meaning* of but mapped onto Pneuma's runtime. Naming
these explicitly helps future syncs land cleanly.

- **Audience detection from the prompt → an explicit ladder manifest.**
  Upstream parses "explain this to my manager" and picks one audience for one
  reply. Here the audience set is *declared* in `manifest.json` as an ordered
  `audiences[]` array, so it persists across sessions, is addressable
  (`ViewerAddress.audience`), and can be extended a rung at a time. Upstream's
  "if the audience isn't explicitly stated, default to Age 5" becomes "default
  to the three-rung ladder age 5 → manager → engineer" — a chat reply can only
  guess once, a ladder can offer the choice.
- **A single prose answer → N self-contained HTML pages.** Upstream's output is
  a chat message. Here each audience gets a real document on disk under
  `pages/<audience-id>.html`, rendered live by the viewer and navigable by
  address.
- **Text-only calibration → a derivation for the page itself.** Upstream
  calibrates vocabulary, analogy, tone, and depth. Because the deliverable here
  is a designed document rather than a chat reply, we added two dimensions
  upstream has no use for: what the page *looks* like (type pairing, measure,
  palette and ground, one gesture, decoration vocabulary) and what it has to
  *contain* to convince that particular reader (what persuades them, the shape
  of the reasoning, how concrete, what the figures are for, where the "so what"
  lands). Both are taught as a derivation in `skill/SKILL.md`, with reference
  rows there and a column apiece in every taxonomy table in
  `skill/references/audience-calibration.md`. This is the Pneuma-native
  extension; nothing upstream corresponds to it.
- **Response-style examples → seed content sets.** Upstream illustrates each
  register with a sample paragraph inside SKILL.md. Here the illustration is
  the seed: two finished explainers the user sees on first launch.
- **Progressive disclosure.** Upstream keeps the whole taxonomy inline. We
  split it: `skill/SKILL.md` carries the working rules, the full taxonomy sits
  in `skill/references/audience-calibration.md` and is read on demand.

## What we dropped

Things we deliberately did not adopt, so a future maintainer does not pull them
back in by accident.

- **The Python eval harness** (`eli5-workspace/run-evals.py`,
  `test_run_evals.py`, `evals.json`, `eval-workflow.md`, `eval-results.md`) —
  not adopted. It scores chat-reply text against rubrics; this mode's output is
  a rendered page, and its quality gate is the viewer's `capture` action plus
  the checklist at the end of `audience-calibration.md`.
- **Upstream's installation instructions** (`README.md` — copying the skill
  into `~/.claude/skills/`) — not applicable. Pneuma's skill-installer copies
  `skill/` into the backend-appropriate directory at session start; a manual
  install path would conflict with it.
- **The blog-post pointer and repo marketing copy** (`README.md`) — upstream
  project framing, not mode content.
- **The literal "Age 5 default" single-audience fallback** — replaced by the
  default ladder, as described under "What we adapted" above.

## License excerpts

Upstream is distributed under the MIT License. Full text as pinned at commit
`a766623b062331fdde53467001379b4ddf3acc2f`:

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
