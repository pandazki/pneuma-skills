---
name: dev-workflow
description: Plan, implement, review, verify, and amend substantial Pneuma Skills development work. Use for multi-step changes, architecture work, code review, or an explicitly requested development workflow; a small edit can follow AGENTS.md directly.
---

# Pneuma development workflow

This is the shared development procedure for Claude Code and Codex. Read root
`AGENTS.md`, the relevant domain rules it routes to, and the acceptance criteria.
Read `docs/reference/project-guide.md` for the affected contracts and their
definition → instantiation → consumer chain. Paths here are repo-relative.

## Choose the work shape

- A lookup or investigation uses [explore](references/roles/explore.md).
- Architecture design or design review uses [architect](references/roles/architect.md).
- A scoped implementation uses [impl](references/roles/impl.md).
- Applying code-review findings uses [amender](references/roles/amender.md).
- A new mode also uses the `create-mode` skill. A release uses `bump`.

These are role instructions, not a requirement to spawn agents. Work locally by
default. Delegate only when the user or the active task's instructions request
delegation and the harness provides it. Give each worker a bounded task, actual
checkout path, baseline, acceptance criteria, and the relevant role file. Inherit
the active harness's model choices; Claude model aliases are not Codex model IDs.

## Development loop

1. **Define the task.** Identify the concrete behavior, affected contracts, test
   scope, and acceptance bar. Use existing user decisions; resolve routine
   implementation choices without asking again. Check the working tree and
   preserve unrelated edits. Isolate concurrent writers in separate worktrees.
2. **Implement.** Read the implementation role. For behavior changes, reproduce
   the defect or pin the new behavior, implement, and verify. Documentation,
   discovery metadata, and formatting do not need tests that merely repeat text.
3. **Review.** Inspect the actual diff against the requirements and domain rules.
   Check failure paths, compatibility, state ownership, and propagation through
   consumers. For UI work, also inspect loading/empty/error states, interaction,
   design tokens, and browser evidence. Report concrete findings with location,
   impact, and severity; a missing review is not a passing review.
4. **Verify.** Run the relevant suite from `.claude/rules/testing.md`, plus
   `bun run typecheck` for code changes. Use `bun run test` for the routine
   repository gate and `bun run test:all` for releases. Inspect the contract
   boundaries: no React in manifests, no new hardcoded mode knowledge in
   server/CLI, and backend differences behind the backend seam. UI changes need
   a browser screenshot and interaction pass. Save command results and evidence.
5. **Amend.** Read the amendment role, address each valid finding, and repeat the
   affected checks. Accept only when verification passes and review has no open
   blocker or major finding. Report unresolved issues honestly; never silently
   count a crashed worker, unrun check, or missing result as success.

Review and verification may run concurrently when independent. When delegation
is unavailable or not requested, perform separate review and verification passes
locally and describe them as self-review; do not claim an independent reviewer.
After three rounds without convergence, reassess the cause and continue useful
authorized work. Ask for a decision only when the remaining fork exceeds scope.

## Harness adapters

- **Claude Code with the `Workflow` tool:** the existing
  `.claude/workflows/dev-master-orchestrator.js` automates delegated task waves.
  Read `.claude/workflows/README.md` for its arguments, worktree preconditions,
  and result schema. Its roster entries read the shared role files above.
- **Codex, or Claude Code without that tool:** execute the same loop using the
  tools actually exposed in this session. Do not try to run a workflow script
  in Bun/Node as if that supplied Claude's `Workflow` host, or assume `.claude`
  agent registrations are native Codex agents.
- Use the available planning, file-editing, browser, and question tools. Tool
  names such as `TaskCreate`, `AskUserQuestion`, or `Read` are capabilities, not
  prerequisites. A short written plan or direct question is a valid fallback.

## Completion

Report what changed and why, the checks actually run and their outcomes, and
material limitations. Provide log or screenshot paths when they carry evidence.
Commit/push/release only within the user's authorized scope. Never create tags;
CI owns release tags. Do not end with a request for confirmation already given.
