# AGENT.md

## Purpose

Project-local guidance for agents working in `pneuma-skills`.

## Current Backend Model

- Claude Code is the only implemented runtime backend today.
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

- `ModelSwitcher` depends on `agent_capabilities.modelSwitch`
- `Schedules` is Claude-specific

Do not spread backend-specific conditionals throughout unrelated components if the behavior can be centralized in session/capability handling.

## Documentation Policy

- Historical ADRs should not be rewritten to describe current implementation drift.
- For architecture changes, add a new ADR instead of mutating old ones.
- Keep `README.md` and `CLAUDE.md` aligned with the current implementation.

## Verification

Before closing substantial changes, prefer running:

```bash
bun test
bun run build
```
