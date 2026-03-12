# AGENT.md

## Purpose

Project-local guidance for agents working in `pneuma-skills`.

## Current Backend Model

- Claude Code and Codex are the two implemented runtime backends.
- Backend selection happens only at startup.
- Backend identity is persisted in:
  - `<workspace>/.pneuma/session.json`
  - `~/.pneuma/sessions.json`
- Existing workspace sessions are backend-locked. Do not add runtime backend switching unless the architecture is intentionally redesigned.

## Runtime Contract

Prefer the normalized session layer over backend-specific assumptions.

Important session fields:

- `backend_type`
- `agent_capabilities`
- `agent_version`

Claude compatibility fields may still exist, but new logic should prefer the normalized fields first.

## UI Feature Gating

If a feature is not guaranteed across backends, gate it through capabilities or explicit backend checks near the shell boundary.

Current examples:

- `ModelSwitcher` depends on `agent_capabilities.modelSwitch` and `session.available_models`
- `ContextPanel` hides cost/lines stats for backends that don't provide them (Codex)
- `Schedules` is Claude-specific

Do not spread backend-specific conditionals throughout unrelated components if the behavior can be centralized in session/capability handling.

## Documentation Policy

### Root Files (single source of truth)

| File | Read by | Purpose |
|------|---------|---------|
| `README.md` | Humans | User-facing: what this is, install, usage |
| `CLAUDE.md` | Claude Code | Project instructions for Claude Code agent |
| `AGENT.md` | Codex / other coding agents | Project instructions for non-Claude agents |

`CLAUDE.md` and `AGENT.md` serve the same role — project-level agent instructions — for different backends. Keep their content aligned where applicable (architecture, conventions, contracts). Backend-specific guidance goes in the respective file only.

All three files are kept in sync with the codebase. Update on every release.

### docs/ Structure

| Directory | Purpose | Lifecycle |
|-----------|---------|-----------|
| `docs/design/` | Active design docs for current/next version | Feature ships → `archive/proposals/` |
| `docs/reference/` | Stable technical references, maintained long-term | Rewrite or delete when outdated |
| `docs/adr/` | Architecture Decision Records | Never move; mark Deprecated if superseded |
| `docs/archive/` | Historical: implemented proposals, work summaries, legacy drafts | Final resting place |

### Rules

- Do not rewrite historical ADRs to match current implementation — add a new ADR instead.
- `docs/design/` should only contain docs for work in progress. Do not let implemented designs accumulate here.
- Implemented proposals move to `docs/archive/proposals/`, not deleted — they preserve decision history.
- Work summaries move to `docs/archive/work-summaries/` after the branch merges.
- See `docs/README.md` for the full reading guide.

## Verification

Before closing substantial changes, prefer running:

```bash
bun test
bun run build
```
