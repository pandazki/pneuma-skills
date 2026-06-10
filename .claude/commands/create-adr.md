# /create-adr — Author a new Architecture Decision Record

Create a new ADR under `docs/adr/` following the project's conventions.

## Steps

1. Read `docs/adr/README.md` (index + conventions) and skim the most recent ADR for format.
2. Determine the next number: files are `adr-NNN-kebab-title.md`, zero-padded, sequential — check for gaps/duplicates before picking.
3. Scope the decision with the user if not already clear from context: **one decision per ADR**. Context (forces, constraints) is distinct from the decision itself; rejected alternatives must be documented with honest trade-offs.
4. Write the ADR matching the structure of existing ones (title, status, date, context, decision, consequences, alternatives considered). Status starts as `Proposed` unless the user says it is already decided (`Accepted`).
5. Add a row to the index table in `docs/adr/README.md` (number, title, status, date).
6. ADRs are immutable once Accepted — never edit an accepted ADR's decision; supersede it with a new one and add a supersession marker to the old entry (see ADR-008's annotation for precedent).
7. Do NOT commit — show the result and let the user review.
