---
description: Borrow another mode's craft for one bounded job, then fold the result back in
argument-hint: <mode> <what you want it to do>
---

<!-- pneuma:session-command name="borrow" -->

You are running INSIDE a live Pneuma session. The user invoked `/borrow`.

A **borrow** is a *subroutine call*, not a *goto*. You stay live and in the
foreground; you lend out ONE bounded job to another mode; that mode does the
job in a background sub-session and **returns** a result; you fold the result
back into the work you own. (Contrast with a handoff, which is a goto: you
leave and the target takes over, control never comes back.) Use a borrow when
you want another mode's craft for a *piece* of what you're building while you
keep owning the whole.

The command's argument is `$ARGUMENTS`.

## 1. Parse `$ARGUMENTS`

- The **first whitespace-separated token** is the target MODE (e.g.
  `wordtaste`, `illustrate`, `doc`, `slide`, `diagram`).
- The **remainder** is the INTENT — a free-form description of the one bounded
  job you want that mode to do.

If `$ARGUMENTS` is empty, or there's a mode but no intent, **ask the user**
which mode to borrow and what bounded job it should do. Do not guess a mode or
invent a job — a borrow is a deliberate, bounded delegation.

## 2. Prepare a tight, bounded brief

Turn the intent into a `BorrowDispatchPayload` and dispatch it through the
`$PNEUMA_CLI` env var (it resolves to the right invocation regardless of how
Pneuma was installed). The real shape:

```bash
$PNEUMA_CLI borrow --mode <MODE> --json '{
  "brief": "<the ONE bounded job, stated for the borrowed mode's first turn>",
  "inputs": ["<host files the borrowed mode should read>"],
  "scope": "return"
}'
```

Field guidance:

- `--mode <MODE>` — required; the mode to borrow (authoritative — it wins over
  any `mode` in the JSON).
- `brief` — required; the ONE bounded job. Keep it scoped — a borrow is a
  sub-task, not an open-ended session.
- `inputs` — recommended; host files or dirs the borrowed mode should read
  (read-only). Absolute or project-relative paths.
- `expects` — optional but useful; what it must produce, in concrete terms
  (e.g. "polished markdown per section + a change-notes list mapping original
  to revised with a one-line rationale").
- `scope` — defaults to `"return"`: the borrowed mode returns content + notes
  and **you** apply them. You own your medium (the page, the deck, the doc);
  the borrowed mode owns its craft (the prose, the image). It produces the best
  version *in its terms*; you adapt and place it so the whole stays unified.
- `in-place` is the escape hatch — use `"scope": "in-place"` only when the
  borrowed mode genuinely owns the exact file (e.g. regenerating an existing
  `assets/logo.png`). Then you must also name the files it may edit:
  `"in_place_targets": ["assets/logo.png"]`.

## 3. Dispatch, then stay live

The CLI returns `{ borrow_id, state }` and **exits immediately**. The borrowed
mode runs in the **BACKGROUND** — you do NOT block waiting for it. Tell the
user the borrow is dispatched, then carry on with whatever else they want. One
borrow at a time per session; if one is already running, the new one queues.

## 4. When the result returns (control comes back to you)

At a safe turn boundary (never mid-turn) you'll see a tag arrive:

```
<pneuma:borrow-returned borrow_id="..." mode="<MODE>" status="completed" result_path="/abs/path/to/borrow-result.json" />
```

On this tag:

1. **Read the `result_path` file.** It is a `BorrowResult`:
   - `produced[]` — the deliverable paths the borrowed mode wrote.
   - `change_notes` — what changed and why, in the borrowed mode's voice.
   - optional `applied_in_place` and `open_questions`.
   A missing or invalid result file means the borrow **failed** — tell the
   user plainly, do NOT fabricate a result.
2. **For `scope: "return"`** (the default) — the deliverable lives in the
   borrowed mode's reach. **You** apply it: read `produced[]`, weave the
   content into your host artifact, adapting it to your layout and medium.
   Surface the `change_notes` to the user so the application is a visible,
   reviewable step. Get the user's go-ahead before any large rewrite.
3. **For `scope: "in-place"`** — the borrowed mode already edited the files in
   `applied_in_place`. Review them, reconcile with your medium, surface what
   changed.
4. **Address any `open_questions`** — propose answers or ask the user.

A `status: "partial"` borrow produced something useful but left open
questions; a `status: "failed"` borrow produced nothing — handle both
gracefully.

## Notes

- One bounded job per borrow. Don't auto-borrow open-endedly, and don't chain
  borrows speculatively — wait for a clear need.
- This command works whether or not the `pneuma-project` skill is installed; it
  is self-contained.
