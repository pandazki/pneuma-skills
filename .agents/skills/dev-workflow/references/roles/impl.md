# Implement

Implement one bounded task completely: behavior, meaningful tests, documentation,
and evidence. The user's request and assigned acceptance criteria define scope.
Do not substitute a different design or stop at a partial workaround.

## Before editing

- Confirm the actual repository root, branch, and working tree. When dispatched
  to a worktree, work only there and verify the assigned branch. A delegated
  worker must not write to `main` or another worker's checkout. For local work,
  follow the active task's checkout and authorization.
- Read `AGENTS.md` and every matching domain rule. Use
  `docs/reference/project-guide.md` to find contract definitions and consumers.
- Check feasibility against real symbols and signatures with `rg`. Plan only
  as much as the task warrants, using the available planning tool or plain text.
- Preserve unrelated edits. Do not stash or discard someone else's work.

## Implement and validate

- Behavior changes: write a meaningful regression/acceptance test, observe the
  relevant failure, implement, then refactor while keeping the test green.
  Contract changes update `core/__tests__/` and the reference documents together.
  Cross-component flows need a flow-level check, not only mocked unit tests.
- Documentation and formatting edits need proportionate validation, not tests
  that assert their prose. Do not invent a test just to satisfy a ritual.
- Keep contracts explicit, TypeScript strict, and manifests free of React. Keep
  mode knowledge out of server/CLI and backend details behind their seam.
- Handle failure paths, timeouts, cleanup, path boundaries, bounded resources,
  and state-write serialization where the implementation requires them. Preserve
  intentional soft-error contracts; errors must remain observable.
- Run `bun run typecheck` for code changes and the appropriate suite from
  `.claude/rules/testing.md`. The routine repository suite is `bun run test`;
  release validation is `bun run test:all`. Never equate bare `bun test` with
  the full release gate. Do not repeat passing checks without new cause.
- UI work requires browser interaction and screenshot evidence, with the
  `cc-*` tokens and loading/empty/error states checked. Start a disposable
  session with `--dev`; use viewing mode when only inspecting. Do not awaken
  an unrelated persisted agent to obtain screenshots.

## Scope and reporting

Resolve local implementation problems yourself. For a design conflict outside
the assignment, investigate, then report the conflict, options, recommendation,
and current state to the task owner. If messaging exists, use it while continuing
independent work; otherwise return the decision request. Existing authorization
is not invalidated by a harness lacking a particular tool.

Commit coherent changes on an assigned feature branch when that is part of the
task. A delegated worker does not merge/push main or publish. Never create tags.
Honor an explicitly assigned deadline; do not invent a fixed time budget.

Return changed files and rationale, commands with exit status and useful output
or log paths, UI evidence when applicable, and remaining risks. A concise summary
is useful, but cannot replace actual validation evidence.
