# `cmd-fit` — the paged-layout feedback loop

This reference explains how to read `.pneuma/kami-fit.json` and how to
act on it. The measurement is automatic — the kami viewer writes the
report after every render, so you always have a current signal. Your
job is to close the loop: edit, read, decide, edit.

Upstream kami enforces this same discipline offline via
`python3 scripts/build.py` + WeasyPrint's strict page-count check.
Pneuma's kami mode moves the check online so you can iterate without
invoking a build.

---

## Reading the report

`.pneuma/kami-fit.json` is rewritten every time the viewer paints.
Always read the freshest version after your last `Write` / `Edit`.

```json
{
  "updated_at": "2026-04-22T12:34:56.000Z",
  "content_set": "musk-resume",
  "file": "index.html",
  "paper": { "size": "A4", "orientation": "Portrait", "width_mm": 210, "height_mm": 297 },
  "pages": [
    { "index": 1, "content_height_mm": 289.2, "overflow_mm": -7.8, "status": "fits" },
    { "index": 2, "content_height_mm": 314.5, "overflow_mm":  17.5, "status": "overflow" }
  ],
  "summary": { "total_pages": 2, "overflow_count": 1, "sparse_count": 0, "fits_count": 1 }
}
```

Fields:

- `pages[i].content_height_mm` — actual rendered height of the i-th
  `<div class="page">` element in the current file.
- `pages[i].overflow_mm` — `content_height_mm − paper.height_mm`.
  Positive means the page overflows the sheet; negative means it has
  headroom.
- `pages[i].status`:
  - `"fits"` — within ±2 … 0 overflow, and not sparse.
  - `"overflow"` — `overflow_mm > 2`. Will not print on one sheet.
  - `"sparse"` — `overflow_mm < −50` (more than 50mm of blank space).

If the file only contains one `.page` div the report carries a single
entry; if it contains N, you get N entries.

---

## Acting on `overflow`

Overflow means the content is physically too tall for the declared
sheet. The kami tokens (font sizes, line-heights, margins) are locked
by the design system — **do NOT shrink them to hide an overflow**. The
right move is always to remove or tighten CONTENT.

In rough order of least-invasive to most-invasive:

1. **Trim prose.** Look for sentences that restate what a bullet or
   heading already said. Cut. Kami's editorial voice is spare.
2. **Drop a weaker bullet.** If a list has five items and the fifth is
   the least distinctive, drop it. Four strong bullets read better
   than five even ones.
3. **Merge two short paragraphs into one.** Especially in the lead /
   summary section, one tight paragraph beats two breezy ones.
4. **Cut a section callout.** A sidebar / callout that isn't pulling
   its weight is the first thing to go.
5. **Reorganise into a grid.** Single-column lists that could be
   two-column grids compress vertically. Only reach for this when the
   content is genuinely parallel (all 6 items have the same shape).
6. **Split across pages.** Add a new `<div class="page">` and move the
   overflowing section into it. This changes the document's declared
   page count — use only when the user's intent supports it (e.g.
   "keep it to a one-pager" forbids this).

Do NOT:

- Edit `_shared/styles.css` token values to squeeze a fit.
- Add inline `font-size: ...` overrides to specific sections.
- Shorten body line-height below what the shared stylesheet declares.
- Hide content via CSS (`display: none`, `overflow: hidden`) — the
  check still treats it as part of the page, and it's dishonest.

---

## Acting on `sparse`

Sparse means a page has more than ~50mm of blank space at the bottom.
This is often fine for **cover pages** (title + tagline + lots of
breathing room is intentional) but a problem for body pages where
the blank space looks like missing content.

Decide first: is this page INTENDED to be sparse?

- **Cover / title page** — usually keep sparse. Breathing room is the
  point.
- **Body page** — treat as a signal to enrich:
  1. Expand the weakest section with a concrete specific (a number, a
     date, a case).
  2. Add a pull-quote / callout that summarises the page's argument.
  3. Include a small diagram or metric strip.
  4. Merge with the next page if the next page overflows slightly —
     redistributing across both pages often fixes both statuses at
     once.

Never pad with filler prose that doesn't carry information. Kami rejects
filler; empty space is more honest than vacuous text.

---

## The iteration loop

After every meaningful `Write` or `Edit` call:

1. Read `.pneuma/kami-fit.json`.
2. If `summary.overflow_count > 0` → pick the lowest-numbered
   overflowing page, apply the least-invasive tactic from the
   overflow list, save, and restart from step 1.
3. If `summary.sparse_count > 0` AND the page is a body page →
   enrich, save, and restart from step 1.
4. If every page is `fits` → stop. Tell the user the document is
   ready.

Do not ask the user "does this look right?" when the report says
`overflow`. The answer is known — the page doesn't fit the sheet, so
it's not right yet. Fix first, then hand back.

---

## Edge cases

- **The report is stale** (viewer hasn't re-rendered since your last
  edit). This can happen if the viewer is not open or if the render
  is debounced. If `updated_at` is older than your last edit, trigger
  a noop save to nudge the viewer, or wait a second and re-read.
- **The file has 0 `.page` divs.** This means the content is not
  wrapped in the paper scaffold. Wrap it — every kami document body
  should live inside at least one `<div class="page">`.
- **The file has many `.page` divs but only one shows in the viewer.**
  Check the Page Navigator — the viewer may be focused on a single
  page file; the report covers the currently-shown file only. Switch
  content sets or pages to see the other reports.
- **A page is `fits` but visually looks wrong.** The fit check only
  measures vertical fit, not aesthetic quality. Run the normal
  aesthetic checks from the main SKILL.md ("Aesthetic rules" section)
  alongside the fit loop.
