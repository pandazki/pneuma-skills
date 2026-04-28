---
name: pneuma-project
description: Project-context awareness for sessions running inside a Pneuma project — cross-mode handoff and project-scoped preferences.
---

# Pneuma Project Skill

You are a session running inside a Pneuma **project** — a multi-session, multi-mode workspace organized around a shared goal. Read `$PNEUMA_PROJECT_ROOT/.pneuma/project.json` for the project identity and description.

## Layout you live in

- `$PNEUMA_PROJECT_ROOT/` — the user's project root. Final deliverables (websites, videos, docs the user actually wants) go here.
- `$PNEUMA_SESSION_DIR/` — your private working area (also your CWD). Drafts, scratch, internal-state files live here.
- `$PNEUMA_PROJECT_ROOT/.pneuma/preferences/{profile.md,mode-{name}.md}` — project-scoped preferences. Same schema as `~/.pneuma/preferences/`.
- `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` — cross-mode handoff messages (see below).
- `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<otherId>/` — sibling sessions. Do not read their internals; coordinate through handoffs.

## Cross-mode handoff protocol

When the user invokes mode switching, you receive a chat message like `<pneuma:request-handoff target="..." />`. Respond by writing a markdown file to `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` using the Write tool. Use unquoted scalar values in the frontmatter (the parser tolerates quotes but unquoted is the convention). Schema:

```markdown
---
handoff_id: hf-<unique-slug>
target_mode: <mode name>
target_session: <existing session id, "auto", or omit for new>
source_session: $PNEUMA_SESSION_ID
source_mode: <your mode>
source_display_name: <your session display name>
intent: <one-line user intent>
suggested_files:
  - <path relative to $PNEUMA_PROJECT_ROOT>
created_at: <ISO 8601 timestamp>
---

# Handoff: <source_mode> → <target_mode>

## Current progress
What's been done in this session that the target needs to know.

## Switching intent
Why are we switching? What does the user want next?

## Key decisions and constraints
Aesthetic, technical, scope decisions already locked in.

## Files the target should read first
Prioritized list with one-line "why" each.

## Open questions
Things you didn't decide; let the target judge.
```

After the file is written, the Pneuma UI captures it via filesystem watcher and asks the user to confirm. Do not delete it yourself — the **target** session will consume and remove it.

## Consuming a handoff

When you start, the CLAUDE.md `pneuma:handoff` block lists pending handoffs targeting you. For each:

1. Read the file with the Read tool
2. Internalize the context — let it shape your first response
3. Delete the file via `rm <path>` (Bash tool) once you've absorbed the context

Treat the handoff like a system briefing — its content takes precedence over your default mode skill for the immediate task.

## Project preferences (read-write rules)

Project preferences in `$PNEUMA_PROJECT_ROOT/.pneuma/preferences/` use the same schema as personal preferences:

- `profile.md` — cross-mode project preferences
- `mode-{name}.md` — per-mode project preferences (you create on demand)
- `<!-- pneuma-critical:start --> ... <!-- pneuma-critical:end -->` — hard constraints (auto-injected into your CLAUDE.md)
- `<!-- changelog:start --> ... <!-- changelog:end -->` — your update log

When updating: read first, then full-rewrite (last-writer-wins). Project preferences are scoped to *this* project — not generalize-able to the user's other work. Personal preferences live in `~/.pneuma/preferences/` and are managed by the `pneuma-preferences` skill.

**Conflict policy**: when project preferences contradict personal preferences, follow the project preference and tell the user once with a brief reason ("project says X; personal says Y; going with project for this session").

## Boundaries

- Do not write non-deliverable files into `$PNEUMA_PROJECT_ROOT/`. Scratch, drafts, templates → keep in `$PNEUMA_SESSION_DIR/`.
- Do not read sibling sessions' `history.json` or `shadow.git` directly. Coordinate through handoff files only.
- Do not modify `.pneuma/project.json` casually — that's project identity. Update it only when the user explicitly asks (e.g., rename, edit description).
