---
description: Hand this session's work to another mode — you leave, it takes over
argument-hint: <mode> <what it should do next>
---

<!-- pneuma:session-command name="handoff" -->

You are running INSIDE a live Pneuma session. The user invoked `/handoff`.

A **handoff** is a *goto*. You leave, the target mode takes over, and control
does not come back. Use it when the work has moved on to a different craft and
this session has nothing left to own. (Contrast with a borrow, which is a
subroutine call: you stay live, lend out ONE bounded job, and fold the result
back in. If the user wants something *for* the piece you are still building,
they want `/borrow`, not this.)

The command's argument is `$ARGUMENTS`.

## 1. Parse `$ARGUMENTS`

- The **first whitespace-separated token** is the target MODE (e.g.
  `webcraft`, `slide`, `doc`, `diagram`).
- The **remainder** is the INTENT — what the user wants the target to do.

If `$ARGUMENTS` is empty, or names a mode with no intent, **ask the user**.
Do not guess a mode and do not invent the intent: the target agent's first
turn is built out of what you write here, and it has no other way to learn
what this was about.

## 2. Write the brief, then emit it

Everything the target needs to not start from zero goes in one call. Emit
through `$PNEUMA_CLI` (it resolves to the right invocation regardless of how
Pneuma was installed):

```bash
$PNEUMA_CLI handoff --json '{
  "target_mode": "<MODE>",
  "intent": "<what the target should do, in the user'"'"'s terms>",
  "summary": "<2-4 sentences: what happened here and where it landed>",
  "suggested_files": ["<files the target should read first>"],
  "key_decisions": ["<already settled — the target must not re-litigate>"],
  "open_questions": ["<still undecided — the target should resolve or ask>"]
}'
```

Field guidance:

- `intent` — required. One sentence, in the user's language and their terms.
- `summary` — what this session actually produced and what state it is in.
  Write it for someone who was not here.
- `suggested_files` — the artifacts, not every file you touched.
- `key_decisions` — the ones that cost something to reach. A target that
  re-opens a settled decision wastes the user's time twice.
- `open_questions` — what you would have asked next.

## 3. Stop, and let the user decide

The CLI returns and a **review card appears in the user's browser** with
everything you wrote. Nothing happens until they press confirm — this is
their decision, not yours. Say the proposal is up and **stop**. Do not
start new work, and do not emit a second handoff while one is pending
(a new one supersedes the old).

Two ways it ends:

- **Confirmed** — this session is terminated and the browser moves to the
  target. You will not get another turn; there is nothing to clean up.
- **Cancelled** — a `<pneuma:handoff-cancelled reason="..." />` tag arrives as
  a user message. Read the reason, answer it, and carry on here. Do not
  re-emit the same handoff unless the user asks.

## Notes

- **Quick sessions can hand off too, and it means something specific.** A
  workspace that is not a Pneuma project holds one quick session at a time, so
  confirming hands this workspace to a new session in the target mode: the
  files stay, this session's chat history is replaced, and the two sessions
  are otherwise unrelated. The card tells the user this before they confirm.
  Sessions that need to *share* preferences, files and a panel are what a
  project is for — if the user wants both to keep existing side by side, they
  want a project, and you should say so rather than handing off.
- This command works whether or not the `pneuma-project` skill is installed;
  it is self-contained.
