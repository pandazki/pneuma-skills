---
name: pneuma-session
description: >
  Rewrite the active Pneuma session's UI title + one-line summary so the launcher
  and ProjectPanel rows reflect what the session is actually about. Use this skill
  whenever the user asks to "整理 / 概括 / refresh / re-title / summarize this
  session", whenever the conversation has produced substantive work and the
  default title ("WebCraft session") is now uninformative, or before the user
  pauses a long session — the next time they reopen it, the row needs to say
  more than "<pneuma:env reason='opened'>". Cheap to run, persistent across
  reopens, mode-agnostic.
---

# Refining your session's identity

Every Pneuma session has a row in the launcher (Recent Sessions) and inside its project (ProjectPanel). The row has two slots:

- **Title** — defaults to `"<Mode> session"` (e.g. "WebCraft session"). Mode-only.
- **Description / preview** — defaults to the first user prompt. For project sessions, the first prompt is the server-emitted `<pneuma:env reason="opened" />` synthetic tag — which carries zero information for a human scanning the list.

Until you refine, both fields are placeholders. Three "WebCraft session" rows look identical except for their thumbnails. The user has to remember by time, which they won't.

This skill is how you fix that. You write a meaningful title + one-sentence summary into `<sessionDir>/session.json`, and the launcher row updates in place. The data persists across reopens; the launcher's own listing always reads from your last refine.

## The mechanism

```bash
$PNEUMA_CLI session refine --json '{"displayName": "<≤40 chars>", "description": "<≤280 chars>"}'
```

Always call through the `$PNEUMA_CLI` env var, not the literal `pneuma` binary. The env var resolves to the right invocation regardless of how Pneuma was installed (npm-global, dev worktree, desktop bundle); writing the literal `pneuma session refine` only works when the binary happens to be on `PATH`, which it usually isn't inside the agent's sandbox. The Bash tool word-splits unquoted `$PNEUMA_CLI` correctly, so `$PNEUMA_CLI session refine ...` invokes as one command — don't quote it.

The command POSTs to the running Pneuma server (via `$PNEUMA_SERVER_URL`), which atomically rewrites `<sessionDir>/session.json`, syncs the global registry at `~/.pneuma/sessions.json`, and broadcasts an event so any open browsers refresh the row without a reload.

Both fields are optional. Sending just `displayName` rewrites only the title; just `description` rewrites only the summary. Send both when the session has changed enough to warrant a fresh pair. The server validates lengths and rejects empties.

Run it from your default Bash tool. It's a one-shot HTTP call — no background process, no follow-up needed. On success the command prints `Session meta refined.` and exits 0; on failure it prints the server's error to stderr and exits non-zero.

## What goes in each field

The goal is to make the row useful to a human scanning a list a week from now. Two principles:

**Describe the session, not the work.** The row is a session identifier, not a worklog. Write what the session is *about*, the user-facing concern, not the sequence of edits you made.

| Don't | Do |
|---|---|
| "Implemented three React hooks" | "加载状态卡片调研" |
| "Edited hero.html 7 times" | "Hero section landing-page iteration" |
| "Created file pricing.html and modified manifest.json" | "Pricing page draft for the launch site" |

**Match the user's register.** If the user has been writing in Chinese, the refined title should be in Chinese too — they're scanning their own list. If the project's `displayName` in `project.json` is English, English is fine. Read the room.

### displayName (≤40 chars)

The new title. Short. A scannable label, not a sentence. Capitalize as you would a headline. No trailing period.

Replacement, not augmentation — the mode is shown via the row's icon (and a hover tooltip), so don't prefix with "WebCraft · ". Just the topic.

Good shapes:

- `加载状态卡片调研`
- `Hero section iteration`
- `Pricing page · v3 layout`
- `负熵痕迹 · 写作框架`

If the user has explicitly renamed the session (via `--session-name` or a future rename UI), your `displayName` is recorded but the explicit name still wins in the listing — user intent beats inference. You don't need to detect this; the server handles precedence.

### description (≤280 chars)

The new summary. One or two sentences. Should fit on one line in the row, with the second sentence as overflow on hover. Plain prose, no markdown.

Tell a user re-encountering this row in a week: "what was I doing here?" and "should I open it?". Concrete enough to disambiguate from sibling sessions, abstract enough to survive minor reshuffles.

Good shapes:

- `Iterating on three loading-state card variants for the dashboard's data-fetching screens. Picked a skeleton + shimmer combo; still tuning the timing curve.`
- `Drafting the hero section for the launch site. Brand voice: "calm and clinical and careful". Holding on grayscale palette until copy lands.`
- `负熵痕迹（写作框架）的第一稿,聚焦"代码 agent 留下的 entropy 痕迹"这条主线。结构定了三段,标题待定。`

## When to refine

You'll find two natural triggers. Both go through the same CLI; only the framing differs.

### When the user asks

Phrases like:

- "整理一下会话信息"
- "重新概括下这个 session"
- "refresh the title / summary"
- "rename this session based on what we've done"
- "give this session a real title"

Run `$PNEUMA_CLI session refine` **synchronously** (no subagent). The user is asking right now; they're waiting for confirmation. Read the conversation so far, compose `displayName` + `description`, call the CLI, then reply with a one-line acknowledgment showing the new title.

### On your own judgment

The intent here is: when the row would actually be more useful with a refined title than the default, refine. When it wouldn't, don't. Default to not refining — premature refines write a title before the session has a clear shape, and you'll either churn it later or leave a misleading row.

Strong signals to refine:

- The conversation has gone past a clear inflection point: a brief was agreed, a direction was picked, a deliverable was produced. The session has a topic now.
- The user has been working for a while (rule of thumb: 15+ substantive user turns, or 3+ artifacts produced), and the default title is still `"<Mode> session"`.
- You hit a milestone the user will care about — a feature shipped, a draft completed, a critique pass finished — and the row should reflect the new state of play.

Weak signals (don't refine on these alone):

- A single message was exchanged.
- The user is still in the discovery / interview phase (their intent isn't settled yet).
- You wrote one file but the session's purpose is unclear.

When you decide to refine proactively, use a **subagent** so the main turn isn't blocked. The Task tool composes a fresh worker that reads the project atlas + the conversation so far and writes the refined fields. Pattern:

```
1. Identify that a refine would be useful.
2. Launch a Task subagent. Brief it:
   - "Read $PNEUMA_PROJECT_ROOT/.pneuma/project.json and project-atlas.md."
   - "Read the current conversation transcript above this prompt."
   - "Compose displayName (≤40 chars) and description (≤280 chars) describing
      what this session is *about* — the user-facing concern, in the user's
      language. Don't list what was done."
   - "Run: $PNEUMA_CLI session refine --json '<your json>'. Print the result and stop."
3. The subagent returns; you don't need to mention the refine to the user
   unless the user asks. The row updates silently.
```

If you don't have a Task tool available (rare; some backends), do the refine inline at a natural pause — between two unrelated turns, or right before you hand the conversation back to the user with a question. Don't refine mid-task; the user is watching you work.

### Refine cadence

Refining once at the right moment is far better than refining many times. As a soft cap: don't refine more than once per ~20 user turns unless the user asks or the session's topic genuinely changed (a pivot — different feature, different deliverable). A row that flickers between titles is worse than a stale one.

## When NOT to refine

- The session has done basically nothing yet. The default `"<Mode> session"` is the right title for an empty session — anything else is a lie.
- The user has explicitly renamed the session (via `--session-name` on launch). Your displayName write is recorded but doesn't change the listing; the noise isn't worth it. Still send a `description` if you have a good one.
- You've just refined recently and nothing has materially changed since.
- The user told you to leave the title alone, or set it themselves in chat.
- A handoff just landed and the session has only seen the handoff payload + one or two turns of orientation. Wait until real work shows the topic.

## Inputs you have

Compose the refined fields from these sources:

1. **The conversation transcript above this prompt.** What did the user ask for? What did you build? What direction did the session take?
2. **`$PNEUMA_PROJECT_ROOT/.pneuma/project.json`** (project sessions only). The project's `displayName` + `description` set the surrounding context. Your session is a *part* of this — refine accordingly. Don't repeat the project name verbatim in your session title; the row is already inside the project's scope.
3. **`$PNEUMA_PROJECT_ROOT/.pneuma/project-atlas.md`** (project sessions only, when present). The atlas describes the project's whole landscape — anchors, deliverables, open questions. Use it to figure out which slice of the project this session is hitting.
4. **The mode you're in.** Read `$PNEUMA_SESSION_DIR/.claude/skills/<mode>/SKILL.md` if you need a refresher on what the mode's job is. The title should still be domain-specific, not mode-specific.

You do **not** read other sibling sessions in the project. Cross-session inference is out of scope for this skill — each session refines itself.

## What success looks like

Open the launcher. Find your session's row. The title and the line below it together should answer "what is this session about, in a way that distinguishes it from the other rows around it?" If yes, the refine landed. If you scan the row and still can't tell what's going on, the description is too abstract; revise.

Three project sessions, all WebCraft:

- ✅ `Hero section · cinematic variant` / "Trying a darker hero direction with type-driven impact; layered on the existing palette so a rollback is one file."
- ✅ `Pricing page draft v3` / "Three-tier comparison with annual/monthly toggle. Holding on copy until the legal team weighs in."
- ✅ `Footer + nav rebuild` / "Replacing the placeholder footer + collapsing the nav from 6 items to 4. Affects every page; will need a polish pass after."

All three are clearly distinct topics in the same project. That's the bar.
