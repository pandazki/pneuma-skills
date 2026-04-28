---
name: pneuma-project
description: Project-context awareness — multi-session workflows around one topic, shared materials and preferences, and cross-mode handoffs as a high-value user path.
---

# You're inside a Pneuma project

A Pneuma project is the user's **organizational unit for one ongoing topic** — think "Brand identity for a startup", "Marketing site for a product launch", "Pitch package for a Series A". Inside one project, the user runs **multiple sessions in different modes** that all contribute to the same goal: a session in `illustrate` produces brand visuals, a session in `webcraft` builds the marketing site, a session in `slide` writes the pitch deck. They share materials, share preferences, and can hand off context to each other.

You are one of those sessions. The work you do here is part of a larger arc, not a standalone exercise. Approach the conversation with that in mind.

## Where you live, where the project lives

Two paths matter, both injected as env vars:

- `$PNEUMA_PROJECT_ROOT` — the user's project directory. **Final deliverables go here.** Websites, decks, videos, docs the user will actually use — they all land in this directory or its subfolders.
- `$PNEUMA_SESSION_DIR` — your private working area, also your CWD. Drafts, scratch notes, internal state, intermediate artifacts. **Don't write deliverables here.**

Project metadata lives at `$PNEUMA_PROJECT_ROOT/.pneuma/project.json`. Read it for project identity and description. Don't edit it casually — that's the project's identity, the user manages it.

## You have siblings

The user may have other sessions in this project, running now or completed earlier. They live at `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<otherId>/`. List them with `ls $PNEUMA_PROJECT_ROOT/.pneuma/sessions/`.

**Don't read inside other sessions' directories.** Their `history.json`, `shadow.git/`, scratch — that's their workspace, not yours. If you need context from a sibling, it should come through one of:

1. **Files the sibling produced under `$PNEUMA_PROJECT_ROOT/`** — shared assets, shared deliverables. These are the project's common ground.
2. **Project preferences** (next section).
3. **A handoff** — explicit, structured context handoff. See "Handoffs" below.

This isolation isn't bureaucratic. It keeps each session focused, and makes the handoff the **explicit, visible path** for moving work between modes — which is exactly the user-facing feature.

## Project preferences

`$PNEUMA_PROJECT_ROOT/.pneuma/preferences/` holds project-scoped preferences. Same schema as personal preferences in `~/.pneuma/preferences/`, but scoped to *this* project:

- `profile.md` — cross-mode project preferences
- `mode-{name}.md` — per-mode project preferences (create on demand)
- `<!-- pneuma-critical:start --> ... <!-- pneuma-critical:end -->` — hard constraints, auto-injected into your CLAUDE.md `pneuma:project` block at session start
- `<!-- changelog:start --> ... <!-- changelog:end -->` — your update log

When updating: read first, then full-rewrite (last-writer-wins). Project preferences belong to *this* project — they're not generalizable to the user's other work. Personal preferences live in `~/.pneuma/preferences/` and are managed by the `pneuma-preferences` skill.

**Conflict policy**: when project preferences contradict personal preferences, follow the project preference and tell the user once with a brief reason ("project says X; personal says Y; going with project for this session").

## How you got here — the `<pneuma:env>` start signal

**Every session starts with an environment-context message** injected into your chat as the first user-side turn. It looks like:

```
<pneuma:env reason="opened" project="Pneuma Demo Project" mode="webcraft" />
```

or:

```
<pneuma:env reason="switched"
            project="Pneuma Demo Project"
            from_session="dd2573f5"
            from_mode="illustrate"
            from_display_name="Brand exploration" />
```

or, if you were spawned from an explicit Smart Handoff:

```
<pneuma:env reason="handed-off"
            project="Pneuma Demo Project"
            from_session="dd2573f5"
            from_mode="illustrate"
            from_display_name="Brand exploration" />
```

**`reason` semantics — adjust your behavior accordingly:**

- **`opened`** — fresh start. The user opened a new session; there's no precursor. Greet briefly (one short line), state what this mode is about, and wait for the user's intent. Don't dump capabilities at them.

- **`switched`** — the user clicked over from a sibling session in the same project, **without** doing a Smart Handoff. They didn't ask the previous session to prepare context for you, but they're clearly working on the same project. Your job: **decide based on their next message** whether to mine the project for related work.

  - If their next message implies continuity (e.g. "continue what we were doing", "follow up on the brand", "use that palette"): scan `$PNEUMA_PROJECT_ROOT/` for relevant deliverables (the previous session's outputs would have been promoted there). Mention what you found.
  - If their message is unrelated or starts something new: don't mine. Just work on what they asked.
  - **Don't read `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<from_session>/` internals** — that's the previous session's private workspace. Cross-session context flows through deliverables in the project root, not by snooping.
  - If the user implies continuity but you can't find anything in the project root, say so plainly: "I don't see deliverables from the previous session in the project root yet. Want me to start fresh based on what you tell me, or should I wait for them to be promoted?"

- **`handed-off`** — Smart Handoff was used and the previous session prepared a structured payload for you. Your CLAUDE.md will also contain a `pneuma:handoff` block with intent / summary / suggested files / decisions / open questions. Treat that block as authoritative; see "Receiving a handoff" below.

The `<pneuma:env>` tag is **informational, not directive**. You don't need to acknowledge it explicitly in your reply — just let it shape your first response. Reply to whatever the user actually said next, with awareness of how you got here.

## Handoffs — moving work between sessions

Because a project is multi-session by design, the user often wants to **take what you've built here and continue in a different mode**. That's a handoff: you summarize the state, the system shows the user a review, and a sibling session — new or existing — picks up with your context loaded in.

This is a **high-value user path**, not a side feature. The user explicitly chose multi-session over a single megasession because the task spans multiple modes. Handoffs are how the modes connect. Treat handoff preparation as a first-class step of your work.

Two directions matter to you: **emitting** a handoff (someone — usually you — is leaving for another mode) and **receiving** one (you were spawned with an inbound handoff).

### Emitting a handoff

The user triggers an outbound handoff via the UI's **Smart Handoff** control. You'll see a chat message arrive that looks like:

```
<pneuma:request-handoff target="webcraft" target_session="auto" intent="Build a one-page landing site from this brand identity" />
```

This is your cue to **prepare a structured handoff** for the target. Think hard about what the target needs:

- **What's the user's current intent?** Often an elaboration of the `intent` from the tag — refine it with what you know.
- **What progress has been made here that the target should know?** Files produced, decisions locked in, mood and aesthetic established.
- **What files should the target read first?** Be specific — paths relative to `$PNEUMA_PROJECT_ROOT`. Order them by importance.
- **What's already decided?** Aesthetic, technical, scope decisions the target shouldn't relitigate.
- **What's still open?** Things you didn't decide; let the target judge or ask the user.

Once you've organized that context, **call the `pneuma handoff` command**. This is the system function that hands the payload to Pneuma. The command reads JSON from stdin or the `--json` flag:

```bash
pneuma handoff --json '{
  "target_mode": "webcraft",
  "target_session": "auto",
  "intent": "Build a one-page landing site from this brand identity",
  "summary": "Created a brand identity with serif logo (Fraunces), warm orange palette anchored on #f97316, and an editorial photo treatment. Brand voice: confident, restrained, technical.",
  "suggested_files": [
    "brand/logo.svg",
    "brand/palette.md",
    "brand/voice.md"
  ],
  "key_decisions": [
    "Single-page scroll, no nav",
    "Serif/sans pairing locked: Fraunces + DM Sans",
    "Hero image style: warm, editorial, not stock"
  ],
  "open_questions": [
    "What's the primary CTA copy?",
    "Sign-up form or email-only capture?"
  ]
}'
```

Field reference:

| Field | Required | Notes |
|---|---|---|
| `target_mode` | yes | Mode name (e.g. `webcraft`, `slide`, `doc`) |
| `target_session` | no | Existing session id to resume into; `auto` or omit to spawn fresh |
| `intent` | yes | One sentence — what the target should accomplish |
| `summary` | recommended | A few sentences on what's done in this session |
| `suggested_files` | recommended | Ordered list of `$PNEUMA_PROJECT_ROOT`-relative paths the target should read first |
| `key_decisions` | optional | What's locked in — saves the target from relitigating |
| `open_questions` | optional | What's still open — gives the target permission to decide or ask |

### What happens after you call `pneuma handoff`

Pneuma takes your payload and **shows the user a review card** with your intent, summary, suggested files, decisions, and open questions. The user reads it and either:

- **Confirms the switch** → Pneuma kills your session and spawns the target with your payload as its inbound handoff. Your conversation here ends.
- **Cancels** → They reconsidered, or want you to refine first. You'll see a chat message:

  ```
  <pneuma:handoff-cancelled reason="<short reason if user provided one>" />
  ```

When you see the cancel tag: **continue the conversation naturally**. Don't be defensive about your handoff; the user is the decider. If they have feedback ("the summary missed the typography decisions"), incorporate it. When they're ready, they'll trigger Smart Handoff again. You don't need to re-call `pneuma handoff` until then.

### One handoff at a time

Don't call `pneuma handoff` autonomously — wait for the `<pneuma:request-handoff>` tag. Don't call it twice for the same request. If the user wants to switch *back* to this mode later, they'll do another Smart Handoff from there.

### Receiving a handoff

If you were **spawned because someone handed off to you**, your CLAUDE.md will contain a `pneuma:handoff` block with the inbound payload, formatted like:

```
<!-- pneuma:handoff:start -->

**Inbound from <source-mode>** (session <source-session-id>)

**Intent**: <intent>

**Summary**: <source's summary>

**Suggested files** (read in order):
- `path/to/file.ext` — why
- ...

**Decisions already locked in**:
- ...

**Open questions**:
- ...

<!-- pneuma:handoff:end -->
```

Treat this as a **system briefing**. Its content takes precedence over your default mode skill for the immediate task. Your first move:

1. **Read the suggested files in order.** Internalize the source's context before you say anything.
2. **Acknowledge the handoff in your first reply.** Show the user you understand where the previous session left off — quote a key decision, reference a specific file. Don't act like a fresh session.
3. **Address the open questions** — either propose answers or ask the user. Don't silently inherit ambiguity.
4. **Then start the actual work.**

Don't ignore an inbound handoff. The user explicitly asked for this transition; they expect continuity, not amnesia.

## Boundaries

- Don't snoop sibling sessions. Use handoffs for cross-session context.
- Don't write to other session dirs. Yours is `$PNEUMA_SESSION_DIR`.
- Don't modify `project.json`. The user manages that via the launcher's edit dialog.
- Don't auto-handoff. Wait for the user's `<pneuma:request-handoff>` tag.
- Don't write `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` files manually — that was the v1 protocol. Now the handoff goes through `pneuma handoff`.
- When uncertain about project-scoped intent (vs your local mode work), check `$PNEUMA_PROJECT_ROOT/.pneuma/preferences/profile.md` first.
