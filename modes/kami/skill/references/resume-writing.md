<!--
  Adapted from tw93/kami (MIT) — references/resume-writing.md.
  Source: https://github.com/tw93/kami/blob/main/references/resume-writing.md
  Credit retained per MIT License; see ../../NOTICE.md.
-->

# Resume Writing Guide

Content strategy for kami resume templates (CN and EN). Covers bullet structure, emphasis density, timeline narrative, and open source entries. For general writing quality bars, see `references/writing.md`.

---

## Three-part bullet: Role / Actions / Impact

Each project row uses a fixed three-part structure. The word and character targets below are maximums, not targets; shorter is better when the meaning is complete.

**Chinese (CN)**

| Row | Label | Target | Hard limit |
|---|---|---|---|
| 1 | 角色 | 50 characters | 60 characters |
| 2 | 动作 | 70 characters | 80 characters |
| 3 | 结果 | 90 characters | 100 characters |

**English (EN)**

| Row | Label | Target | Hard limit |
|---|---|---|---|
| 1 | Role | 35 words | 40 words |
| 2 | Actions | 45 words | 55 words |
| 3 | Impact | 55 words | 65 words |

**What goes in each row**

- Role: what the project was, why it existed, and your position in it. No verbs yet.
- Actions: the decisions and techniques you applied. One concrete approach per sentence.
- Impact: quantified outcomes only. If no number exists, write the magnitude or scope (team size, user count, traffic tier).

**Self-check**: read Impact aloud. If it sounds like a process description ("improved the pipeline") rather than a result ("reduced p95 latency from 800ms to 120ms"), rewrite.

---

## Source and truth pass

Run this pass before rewriting when the user provides more than one source, such as an old resume plus a self-review, annual review, promotion packet, or project notes.

1. Extract every claim, number, project name, role label, and result from each source.
2. Use the richer source for its best material, not as a replacement for the other source. Annual reviews often carry the strongest metrics; old resumes often carry the clearest project narrative.
3. If two sources conflict on scope, owner, unit, or number, ask the user. Do not silently choose the larger or more impressive claim.
4. Drop numbers whose unit or measurement basis is unclear. A precise, traceable number beats a bigger rounded estimate.

Use precise before/after values when available: `S1 68% / S2 93%` reads more credible than "about 70%". If a number looks like a typo or a unit mismatch, leave it out or mark it as a question.

---

## Personal information hygiene

Age and gender are optional resume metadata, not evidence. In CN / KO recruiting contexts, include them only when the user supplied them and the target channel expects them. Place them in the contact line after location; never promote them into metric cards, summary, or project copy.

Do not invent missing personal details. Do not include expected salary in the resume body. Salary expectations, availability, and negotiation constraints belong in the recruiter message or a separate candidate note unless the user explicitly asks for a form-style resume.

Use role positioning instead of old-style job intention: `AI / Agent 工程` is useful; `求职意向：前端工程师` usually wastes space.

---

## Ownership and title calibration

Role words carry different promises. Pick the lowest truthful word that still reflects the contribution.

| Role word | Boundary | Use when |
|---|---|---|
| 方向负责人 / owner / lead | Defined the direction, owned the architecture or outcome, and was the clear accountable person | You can defend the strategy, tradeoffs, and final result |
| 负责 / drove / led | Independently carried a line or module to production | You owned delivery, but not necessarily the whole direction |
| 牵头 / coordinated | Pulled multiple people or systems together around a bounded goal | The value was orchestration and delivery pressure |
| 模块负责人 / module owner | Owned a specific module, industry slice, or workflow | The larger business line had other owners |
| 共建 / contributed / core contributor | Delivered a distinct piece inside a shared project | Another person or team owns the larger project |
| 参与 / implemented | Solid execution without ownership | The result is real, but scope should stay modest |

Do not let every project say "主导". A strong resume usually mixes owner-level projects with narrower but concrete contributions. This reads more credible than inflating every line.

---

## Team resume mode

When optimizing multiple resumes from the same team, run a project ownership pass before polishing any single resume.

1. List each person's project names, aliases, role labels, and headline metrics.
2. Mark shared projects, near-duplicate names, and reused metrics.
3. Ask the user to confirm the unique owner for any project using owner-level language.
4. For non-owners, downgrade the role word and switch to the person's distinct contribution or metric dimension.

The goal is not to hide collaboration. The goal is to avoid five resumes all claiming the same project as personally owned. Shared work is credible when each person's scope is different and defensible.

---

## Metrics: horizontal vs vertical layout

Each project card has a `.metrics` row that shows key numbers. Two layout modes are available.

**Horizontal (default, `flex-direction: row`)**: numbers side by side, good for 2-3 short metrics.

**Vertical (`flex-direction: column`)**: metrics stack one per line. Use when:
- Any single metric label exceeds 18 characters
- Three or more metrics are present and labels are of unequal length
- The project card already has long Role / Actions / Impact rows that crowd the line

Use | Avoid
---|---
Horizontal for two short metrics: `38% reduce latency · 12k daily users` | Horizontal for long labels: `reduced p95 latency from 820ms to 110ms · 12k active users`
Vertical when three or more metrics exist | Vertical for exactly two short metrics (wastes space)

To switch to vertical:
```css
.metrics { flex-direction: column; gap: 0.8mm; }
```

Do not add `flex-wrap: wrap`; it causes uneven line splits that look like layout errors.

---

## Key-number highlight density

`.hl` applies brand-blue color to mark the single most important figure or phrase in a line. It is not a general emphasis tool.

**Use:**
- One `.hl` per project row, maximum two across all three rows of one project
- Numbers with units: `<span class="hl">120ms</span>`, `<span class="hl">38%</span>`
- A distinctive noun when no number exists: `<span class="hl">production-first rollout</span>`

**Avoid:**
- Highlighting adjectives or qualifiers: "significantly", "dramatically", "key"
- Two `.hl` spans on the same row
- Highlighting an entire clause

Healthy ratio: one emphasis per 80 to 150 characters of body text.

---

## Timeline: three-step evolution arc

The `.timeline` section shows career judgment, not a job chronology. Three steps, each one sentence.

**Structuring the arc**

Each step should answer: what shifted in how you thought or operated, and why does it matter for the reader?

Use | Avoid
---|---
"Shifted from feature delivery to owning the model quality loop end-to-end" | "Joined the AI team as senior engineer"
"Moved budget approval to the team level, cutting decision lag from weeks to hours" | "Led a team of 8 engineers"
"Started shipping open-source tools to validate ideas before internal roadmap commits" | "Side projects and open source work"

**Three-step pattern**

1. Foundation: the constraint or context that shaped your thinking in the early phase
2. Inflection: the moment or decision that changed what you were optimizing for
3. Present: the operating mode you've settled into and what it produces

Do not list events. List shifts in judgment and scope.

---

## Open source entries

Each `.os-item` has three parts: name, one-line description, and star count. No README summaries, no feature lists.

**Description formula**: `[language or stack] · [what it does] · [platform or audience]`

Use | Avoid
---|---
"Rust + Tauri · turns any URL into a lightweight desktop app · macOS / Windows / Linux" | "A lightweight desktop app builder based on Tauri that supports packaging web apps as native applications across multiple platforms"
"Swift · native Markdown notes · macOS AppKit" | "A beautiful and fast Markdown note-taking app for macOS with syntax highlighting and live preview"

**Star count**: use the `.big` class on the top two entries (your flagship projects). Plain `.os-star` for the rest.

**`.os-highlight`**: one short paragraph, one anecdote. Focus on a specific external validation moment: a notable person who shared it, a community that formed around it, a moment when it reached an audience you didn't target. Not a feature summary.

---

## Visual rhythm

The shipped resume templates carry a quiet, two-page rhythm (refreshed
upstream V1.7.2). Hold these when editing layout — they keep a resume
from reading like a long-doc:

- **Section headers** use a single warm bottom rule
  (`border-bottom: 0.5pt solid var(--border)`), not a brand-color left
  bar. The 2.5pt brand left bar belongs to long-doc / proposal section
  titles; on a resume it reads loud.
- **Project rows** carry no top/bottom border. Separate them with padding
  and the weight of the project name alone — row borders fragment the
  page and fight the metric strip.
- **Metric labels** stay on one line. Shorten the label before you change
  the layout; switching `.metrics` to the vertical column is the second
  move, not the first.

## Density tuning by project count

When page 1 carries 3-6 projects, adjust these three CSS properties. Do not change line-heights on page 2 or touch header typography.

| Projects on page 1 | `body font-size` | `.proj-text line-height` | `.section-title margin-top` |
|---|---|---|---|
| 3 | 9.4pt | 1.42 | 6mm |
| 4 (default) | 9.2pt | 1.40 | 5mm |
| 5 (dense) | 9pt | 1.38 (CN) / 1.40 (EN) | 3.5mm |
| 6 | 9pt | 1.36 (CN) / 1.38 (EN) | 3mm |

For 5-project layouts, add `class="resume--dense"` to `<body>` instead of manually adjusting CSS. The `resume--dense` class applies the row-5 values above.

For 6 projects there is no pre-built variant; apply the row-6 values directly and re-check `kami-fit.json` after. Six projects on one page is a strong signal the project list needs editing, not just tightening.

---

## Two-page balance

Resume output has a stricter contract than general multi-page documents:

- Exactly 2 pages.
- Each page fill should land around 83-95%.
- The two pages should differ by less than 12 percentage points.

Verify with `.pneuma/kami-fit.json`: fill per page is `content_height_mm / paper height` (an A4 page reporting `content_height_mm` of 247-282 sits in the band). Both pages must report `fits`; a `sparse` second page breaches this contract even though it passes the general fit loop.

If page 2 is too empty, fix content before touching typography:

1. Split one mixed project only when it honestly contains two different systems or result dimensions.
2. Add one real skills row only when the source material already supports it.
3. Cut filler and repeated metrics before shrinking fonts.

Do not fill space by padding, duplicating a number, or splitting one sentence into two lines. A sparse second page is acceptable only when the source material is genuinely thin and the user prefers restraint over padding.

---

## Recruiter pass (before shipping)

Fit and density checks validate structure and layout, not prose. A resume can report `fits` on every page and still read broken. After filling and before handing back, reread every project card the way a recruiter would, against the row definitions in "What goes in each row" above: Role carries your position in the project, not background alone; Actions are verb-led, one concrete approach per sentence; Impact reads as an outcome, not a restatement of the process. One cross-row check on top: no row repeats another row's information.

Fix a failing row by rewriting from the source material. If the source cannot support a row (for example, no outcome fact exists), ask the user for the missing fact. Do not pad, and do not fall back to generic claims ("保障稳定运行", "improved efficiency").

This pass is internal: run it silently; surface it only when a row cannot be fixed without new information from the user.

---

## Page 2 rhythm

Page 2 has more space than page 1. Do not compress it to match page 1 density.

- OS intro: one sentence positioning + one sentence with the aggregate GitHub numbers. No more.
- Convictions: each card is one judgment call + one piece of downstream evidence. Not a project summary.
- Skills: each row names one capability area and demonstrates it with one concrete example. No abstract claims.
- Education: one line. If there is a judgment-flavored note (declined grad school, switched majors), include it. That note signals self-direction better than GPA.

**Font size and spacing reference** (5 projects on page 1 + complete page 2):

| Property | Value |
|---|---|
| `body font-size` | 9pt (dense) / 9.2pt (default) |
| `.os-intro` line-height | 1.55 |
| `.conv-body` line-height | 1.40 |
| Page 2 top buffer | 4mm minimum between header and first section |

This configuration fits 2 pages when TsangerJinKai02 is available. Font fallback to Source Han Serif adds roughly 0.3pt per line; re-check `kami-fit.json` after any font change.

Do not scale page 2 font below 9pt to save space. If page 2 still overflows, cut one Convictions card or reduce Skills to 2 rows.

---

## AI engineering resumes

AI-facing resumes should show that the candidate treats AI as an engineered system, not a magic tool or a list of model names.

Use:
- Mechanisms that turn generation into delivery: evaluation gates, feedback loops, harnesses, regression checks, context boundaries, rollback paths.
- Clear human / AI division of labor: humans define scope, tradeoffs, and risk; AI may implement, repair, classify, or generate under constraints.
- Metrics tied to the mechanism: pass rate, failure rate, iteration cycle, case coverage, retrieval precision, hallucination reduction, throughput, review load.
- Evolution in operating model: prompt craft -> context engineering -> tool orchestration -> automated validation.

Avoid:
- Listing model or tool names as a skill by itself.
- Writing "AI improved efficiency by 50%" without saying what baseline, sample, or workflow was measured.
- Packaging an API demo as an agent platform.
- Claiming a team or platform result as an individual result.
- Using filler such as `赋能`, `抓手`, `组合拳`, or `规模化` without a concrete mechanism and metric.
