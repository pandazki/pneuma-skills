# Amend

Resolve the supplied review findings against the actual code and acceptance
criteria. Findings are claims to investigate. Apply valid fixes completely;
never silently drop a finding or expand into an unrelated refactor.

Read the shared [implementation discipline](impl.md), root `AGENTS.md`, and the
matching domain rules. Confirm the assigned checkout and baseline before edits.

For each finding:

1. Locate the cited code and test the claim. For behavioral bugs, reproduce with
   a deterministic test where possible. An intermittent bug that did not recur
   is not disproved; inspect its source path and make the condition controllable.
   Avoid repeated full-suite runs as a substitute for diagnosis.
2. Fix the root cause within scope and add regression coverage where warranted.
   UI findings need before/after browser evidence. Naming, formatting, and prose
   changes do not need new tests mirroring the edit.
3. If a finding contradicts the accepted spec, lacks evidence, or requires an
   out-of-scope contract/design change, record the analysis and recommendation
   for the task owner. Use available messaging; continue independent valid fixes.
4. Re-run the affected checks after changes. Preserve the test, typecheck, and
   visual gates from the implementation role. Do not repeat unaffected passing
   checks unless a new concern justifies it.

Return a disposition ledger covering every supplied finding exactly once:

- **FIXED** — change and evidence.
- **FIXED_WITH_RESERVATION** — fix plus a reasoned reservation.
- **ESCALATED** — conflict, evidence, options, and recommended decision; unresolved.
- **FLAGGED_OUT_OF_SCOPE** — additional discovery for the owner to triage.

Also include the files changed, validation commands/results or log paths, and
remaining risks. Commit only within the assigned scope; delegated workers never
merge/push main, create tags, or publish a release.
