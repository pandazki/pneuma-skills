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

## Project meta — what the launcher / project chip read

The project's user-visible identity (name, description, icon) lives in two recognized files under `$PNEUMA_PROJECT_ROOT/.pneuma/`. Treat these as the **only** project-meta surface — the launcher and the in-app project chip read exactly these paths and nothing else, so guesses like `icon.png`, `cover.svg`, or `meta.json` will silently do nothing.

### `project.json` — manifest

Schema:

```json
{
  "version": 1,
  "name": "pneuma-demo-project",
  "displayName": "Pneuma Demo Project",
  "description": "...optional, shown under the title in the project chip and launcher card...",
  "createdAt": 1740000000000
}
```

- `name` is the directory-derived slug. Don't change it.
- `displayName` and `description` are user-facing; you may refine them when the user explicitly asks ("update the project description to X"). Otherwise leave them alone.
- `version` and `createdAt` are runtime fields. Don't touch.
- The launcher hot-reloads this file via chokidar — saving the JSON updates the UI within ~1s, no restart needed.

### `cover.png` — project icon

Strict rules:

- **Exact path:** `$PNEUMA_PROJECT_ROOT/.pneuma/cover.png`. Anything else (`icon.png`, `cover.jpg`, `cover.svg`, `cover@2x.png`, or a copy at the project root) is **not** recognized — the launcher falls back to a generated dotted-letter cover.
- **PNG only.** No JPEG / SVG / WebP fallback exists.
- **Square is best.** Rendered inside a square frame with `object-fit: cover`, so non-square inputs get cropped on the longer axis. Generate at 512×512 or larger; the runtime resizes for display.
- **Hot-reload.** The server watches `.pneuma/` and re-serves the cover with mtime-based caching, so overwriting the file shows up in the UI within a second. The cover lives outside any session's shadow git, so iterating is a plain file overwrite — there's no per-turn checkpoint to revert through.
- Don't write to `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<your-id>/thumbnail.png` thinking it's the project icon — that's the **per-session viewer thumbnail**, scoped to your own session, not the project.

If the user asks you to "make a project icon / cover / logo" and you produce an image (typically inside `illustrate`, `draw`, `kami`, or another image-producing mode), save the final asset to `$PNEUMA_PROJECT_ROOT/.pneuma/cover.png` and confirm the path back to the user. Don't drop it in your session dir — that won't be picked up.

## The Project Atlas — your canonical briefing

If your CLAUDE.md contains a `<!-- pneuma:project-atlas:start --> ... <!-- pneuma:project-atlas:end -->` block, the project has been atlas-seeded. The block is a **pointer**, not the briefing itself — the runtime keeps your prompt lean by not inlining the atlas file every turn.

**On session start (or your first action of substance), Read** `$PNEUMA_PROJECT_ROOT/.pneuma/project-atlas.md`. Treat its contents as authoritative for:

- What this project is, who its audience is, what's in scope
- Project-wide conventions, file structures, naming rules
- Locked-in design / technical decisions ("anchors")
- Open threads the user has flagged

**Use the atlas before re-asking the user.** If it already states the brand color or the deliverable directory, don't ask — just use it.

You don't need to re-Read the atlas every turn — once is enough for a session unless the user signals it changed (e.g. "I just refreshed the atlas"). If the file isn't where the pointer says, the project layer is misconfigured; mention it.

The atlas is maintained by the `project-evolve` mode (Project chip's Evolve sparkle). Never edit `project-atlas.md` yourself unless the user explicitly asks; let them trigger an evolution pass when the project context shifts. If you notice the atlas is missing details that would help your work, flag the gap — don't fabricate the missing parts.

If no `pneuma:project-atlas` block is in your CLAUDE.md, the project hasn't been atlas-seeded yet. That's normal for fresh projects — work from `project.json` + the user's prompt instead, and you can suggest "we could run project-evolve to seed an atlas if this becomes a multi-session effort."

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
            from_display_name="Brand exploration"
            inbound_path="/Users/.../.pneuma/sessions/<id>/.pneuma/inbound-handoff.json" />
```

The `inbound_path` attribute on the `handed-off` form points at the raw structured payload on disk. You usually don't need to read it — the `pneuma:handoff` block in your CLAUDE.md already carries the parsed content as a system briefing. Reach for `inbound_path` only when you need the original JSON (e.g. to iterate `suggested_files` precisely, or to verify a field that the CLAUDE.md formatting elided).

**`reason` semantics — adjust your behavior accordingly:**

- **`opened`** — fresh start. The user opened a new session; there's no precursor. **Reply once, with one short sentence**, and stop. State the mode is ready and you're waiting for the user. Don't repeat yourself across multiple turns ("ready", "standing by", "let me know"). Don't dump capabilities. Don't probe with tool calls. Wait for the user.

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

Once you've organized that context, **call the handoff CLI through the `$PNEUMA_CLI` env var**. This is the system function that hands the payload to Pneuma. The env var resolves to the right invocation regardless of how Pneuma was installed (production npm-install or dev worktree); writing the literal `pneuma handoff` only works when the binary is on PATH, so always prefer `$PNEUMA_CLI`. The command reads JSON from stdin or the `--json` flag:

```bash
$PNEUMA_CLI handoff --json '{
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

### What happens after you call `$PNEUMA_CLI handoff`

Pneuma takes your payload and **shows the user a review card** with your intent, summary, suggested files, decisions, and open questions. The user reads it and either:

- **Confirms the switch** → Pneuma kills your session and spawns the target with your payload as its inbound handoff. Your conversation here ends.
- **Cancels** → They reconsidered, or want you to refine first. You'll see a chat message:

  ```
  <pneuma:handoff-cancelled reason="<short reason if user provided one>" />
  ```

When you see the cancel tag: **continue the conversation naturally**. Don't be defensive about your handoff; the user is the decider. If they have feedback ("the summary missed the typography decisions"), incorporate it. When they're ready, they'll trigger Smart Handoff again. You don't need to re-call `$PNEUMA_CLI handoff` until then.

### One handoff at a time

Don't call `$PNEUMA_CLI handoff` autonomously — wait for the `<pneuma:request-handoff>` tag. Don't call it twice for the same request. If the user wants to switch *back* to this mode later, they'll do another Smart Handoff from there.

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

## Borrowing — delegating a bounded sub-task to another mode

A **handoff** is a *goto*: you leave, the target takes over, control doesn't come back. A **borrow** is a *subroutine call*: you stay live and in the foreground, you lend out one bounded job to another mode, it does the job in a background sub-session and **returns** a result, and you fold that result into your work. Use a borrow when **you want another mode's craft for a piece of what you're building, but you keep owning the whole.**

Driving examples:

- You're in `webcraft` with a finished, styled landing page. The prose needs the writing-taste treatment that lives in `wordtaste`. You **borrow `wordtaste`** to polish the copy, get polished markdown + change-notes back, and **you** weave it into the page (adapting it to your layout and visual tone — that's your job, not the borrowed mode's).
- You're in `webcraft` and need a logo. You **borrow `illustrate`** to produce one, get the file path back, and **you** place it in the page.

### Emitting a borrow (you are the host)

When the user wants another mode's capability for a bounded piece of your work — or you see a `<pneuma:request-borrow mode="..." />` tag arrive in chat — prepare a tight, bounded **brief** and call the borrow CLI through `$PNEUMA_CLI` (the env var resolves to the right invocation regardless of how Pneuma was installed):

```bash
$PNEUMA_CLI borrow --mode wordtaste --json '{
  "brief": "Polish the hero + about copy in the user'\''s confident, restrained voice. Keep it tight.",
  "inputs": ["site/index.html", "brand/voice.md"],
  "expects": "polished markdown for each section + a per-section change-notes list mapping original → revised with a one-line rationale",
  "scope": "return"
}'
```

Field reference:

| Field | Required | Notes |
|---|---|---|
| `mode` (via `--mode`) | yes | The mode to borrow (e.g. `wordtaste`, `illustrate`, `doc`) |
| `brief` | yes | The ONE bounded job, stated for the borrowed mode's first turn. Keep it scoped — a borrow is a sub-task, not an open-ended session |
| `inputs` | recommended | Host files/dirs the borrowed mode should read (read-only). Absolute or project-relative paths |
| `expects` | recommended | What it must produce, in its terms — be concrete about the deliverable shape |
| `scope` | no | `"return"` (default) — it returns content + notes, **you** apply them. `"in-place"` — it edits host files you name in `in_place_targets` directly (only for media it genuinely owns, e.g. regenerating an existing asset) |
| `in_place_targets` | only for `in-place` | Host files the borrowed mode may edit directly |
| `summary` | optional | Extra context the brief alone can't carry |

The CLI returns `{ borrow_id, state }` and **exits immediately** — the borrowed mode runs in the background. **You stay live and keep talking to the user.** Do not block waiting; carry on with whatever else the user wants.

**Default to `scope: "return"`.** You own your medium (the page, the deck, the doc); the borrowed mode owns its craft (the prose, the image). It produces the best version *in its terms*; *you* adapt and place it so the whole stays unified. Reach for `in-place` only when the borrowed mode genuinely owns the exact file (e.g. regenerating `assets/logo.png`).

### Receiving the result (control returns to you)

When the borrowed mode finishes, you'll see a tag arrive at a safe turn boundary (never mid-turn):

```
<pneuma:borrow-returned borrow_id="..." mode="wordtaste" status="completed" result_path="/abs/path/to/borrow-result.json" />
```

On this tag:

1. **Read the `result_path` file.** It's a `BorrowResult`: `produced[]` (the deliverable paths), `change_notes` (what changed and why, in the borrowed mode's voice), optional `applied_in_place` and `open_questions`. Treat a missing/invalid file as a failed borrow — tell the user, don't fabricate.
2. **For `scope: "return"`** — the result lives in the borrowed mode's reach. **You** apply it: read `produced[]`, weave the content into your host artifact, adapting it to your layout/medium. Surface the `change_notes` to the user so the application is a visible, reviewable step. Get the user's go-ahead before large rewrites.
3. **For `scope: "in-place"`** — the borrowed mode already edited the host files in `applied_in_place`. Review them, reconcile with your medium, and surface what changed.
4. **Address any `open_questions`** — propose answers or ask the user.

A `status: "partial"` borrow still produced something useful but left open questions; a `failed` borrow produced nothing — handle both gracefully.

### If you were borrowed (you are the borrowed mode)

If you were spawned as a borrow target, your CLAUDE.md carries a `pneuma:handoff` block **framed as a borrow** (`<pneuma:env reason="borrow" .../>` on start). That block tells you the bounded job, the inputs, the expected deliverable, the `scope`, and — crucially — **the exact `pneuma borrow-return` call to make when you're done**, with the `borrow_id` + `host_server_url` pre-filled. Do the bounded job, write your deliverable(s) into your **own** session dir (for `scope: "return"`), then make that `borrow-return` call and `rm .pneuma/borrow-brief.json`. **Do not** treat it as a terminal handoff (you are not taking over) and **do not** start unrelated work — a borrow is one bounded job, then control returns to the host.

### Borrow vs handoff — which to use

- **Handoff** when the *center of gravity moves*: the user is done in this mode and continuing the work in another mode (brand identity → build the site → write the deck). You leave.
- **Borrow** when the *center of gravity stays here*: you need one piece done in another mode's craft, then you keep building. You stay.

Don't auto-borrow open-endedly. A borrow is a deliberate, bounded delegation — wait for a clear need (the user asks for another mode's capability, or a `<pneuma:request-borrow>` tag), keep the brief tight, and fold the result back yourself.

## Boundaries

- Don't snoop sibling sessions. Use handoffs for cross-session context.
- Don't write to other session dirs. Yours is `$PNEUMA_SESSION_DIR`.
- Don't modify `project.json`. The user manages that via the launcher's edit dialog.
- Don't auto-handoff. Wait for the user's `<pneuma:request-handoff>` tag.
- Don't auto-borrow open-endedly. Borrow for a clear, bounded need; keep the brief tight; default to `scope: "return"` and apply the result yourself.
- Don't write `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` files manually — that was the v1 protocol. Now the handoff goes through `$PNEUMA_CLI handoff`.
- When uncertain about project-scoped intent (vs your local mode work), check `$PNEUMA_PROJECT_ROOT/.pneuma/preferences/profile.md` first.
