# Design: `pneuma library upgrade`

> **Status:** Design sketch — not implemented. Depends on the `pneumaVersion` data model that ships in [#116](https://github.com/pandazki/pneuma-skills/pull/116).
>
> **Audience:** Maintainers of `pneuma-skills` upstream and authors of mode libraries (`pneuma library init` repos) who will eventually need to migrate their modes across Pneuma major versions.

## Problem

Today, when Pneuma releases a breaking-change major version (e.g. 4.0 with a new ViewerContract or a renamed source kind), the burden falls entirely on each library author: open every mode, read the upstream changelog, hand-edit, retest, push. No tooling helps with the diff between "what your mode declares as compatible" and "what the runtime expects now."

The new `pneumaVersion` field (#116) tells us what each mode targets. We can leverage that field to build a guided upgrade flow.

## Goal

```bash
pneuma library upgrade <library-id>
```

Walks the author through every mode in their library whose `pneumaVersion` is incompatible with the currently-installed runtime, surfaces the migration steps for the version delta, optionally automates the field bumps, and either applies changes directly or hands off to a mode-authoring session for the agent to do the work.

Designed to be the *iteration* counterpart to `pneuma library init` + `pneuma library publish`. Same data model, same CLI verb family, no new concepts for the author.

## Two strategies (pick one or offer both)

### Strategy A — guided manual

The lightest possible flow. CLI does:

1. Load the library's sidecar; for each activated mode, compare `pneumaVersion` against runtime.
2. For each incompatible mode, print:
   - The mode name + declared range + runtime version
   - A list of relevant migration docs (`docs/migration/<from>-to-<to>-*.md`) for the version delta
   - A 1-line summary of each migration
3. Prompt the author per mode:
   - `[s]kip` — leave as-is, mark in `.library.json.upgradeSkipped[modeName] = "<runtime>"` so the next upgrade run can short-circuit
   - `[r]ead` — open the migration doc(s) in the system browser (`open <path>`)
   - `[b]ump` — just change the manifest's `pneumaVersion` field to a new range the author types; useful when the migration is a no-op and they've verified manually
   - `[a]gent` — hand off to Strategy B for this mode (described below)
4. After all modes processed, optionally run `pneuma-skills library publish` to commit + push.

**Pros:** simple, no agent involved unless asked. Author keeps full control. Easy to ship: ~150 lines of CLI plus minimal sidecar bookkeeping.

**Cons:** doesn't actually do the work. Bulk migrations across a 30-mode library still require ~30 individual edits.

### Strategy B — agent-driven (per mode)

When the author picks `[a]gent` (or `--mode-agent` for the whole library), the CLI:

1. Locates the migration doc(s) for the version delta — e.g. `docs/migration/3.x-to-4.0-viewer-contract.md`
2. Spawns a Pneuma session pointing at the mode dir (the actual `.../my-mode/` inside the library repo) with:
   - The `create-mode` skill from the library's `.claude/skills/create-mode/` (gives the agent full ModeManifest + ViewerContract context — see [`pneuma-mode-gallery`](https://github.com/pandazki/pneuma-mode-gallery))
   - The relevant migration doc(s) injected into the session's `<pneuma:env>` greeting as a one-shot "here's what changed, apply it" briefing
   - A clear constraint: edit only this mode's files, bump `manifest.pneumaVersion` when done
3. Author watches via the regular Pneuma UI, intervenes when needed (same workflow they use to author new modes).
4. On agent-done signal (a small synthetic tag the agent emits, or just session close), CLI marks the mode as migrated and moves to the next.

**Pros:** actually does the work. Reuses the create-mode skill investment. Author retains review power but doesn't have to type the edits.

**Cons:** more moving parts. Per-version migration docs need to be authored with enough rigor that an agent can apply them mechanically — this raises the bar on upstream's documentation quality (which is probably a good thing anyway).

**Recommendation:** ship Strategy A first (most of the value, smallest surface area). Add Strategy B once we have one full version-bump migration doc as a worked example.

## Migration doc format

Authoring contract for `docs/migration/<from>-to-<to>-<topic>.md`:

```markdown
---
fromRange: ^3.x      # semver range this migration covers as INPUT
toRange: ^4.0        # semver range it produces
appliesWhen:         # optional — narrow the trigger
  - "manifest.sources.*.kind === 'aggregate-file'"
agentReady: true     # whether an agent can run this end-to-end
estimatedMinutes: 5  # human estimate when running manually
---

# Migrating from 3.x to 4.0 (Viewer Contract)

> **TL;DR:** <one paragraph an author / agent can act on>

## Why
<intent + why upstream had to break>

## Decision tree
<branches by what the mode uses today — same shape as the 2.29 migration doc>

## Mechanical changes
<exact diff patterns the agent can apply; each pattern has a `match` regex and a `replace` template>

## Verification
<how to confirm the migration worked — `bun run dev <mode>` + check X, Y, Z>
```

The existing `docs/migration/2.29-source-abstraction.md` is a near-perfect example of the format we're standardizing. Strategy B requires the `## Mechanical changes` section to be precise enough for an agent to apply; Strategy A can rely on the prose alone.

## Sidecar changes

Add two optional fields to `InstalledLibrary`:

```typescript
interface InstalledLibrary {
  // ...existing
  /** Pneuma version that the last successful `library upgrade` targeted. */
  lastUpgradedTo?: string;
  /** Per-mode upgrade-skipped markers — set when the author chose to skip this round. */
  upgradeSkipped?: Record<string, string>;  // modeName → skipped-at-runtime-version
}
```

These are diagnostic only — they don't change resolution. The launcher already uses `pneumaVersion` + cached compat to render state.

## CLI surface

```bash
pneuma library upgrade <library-id>                     # interactive, Strategy A by default
pneuma library upgrade <library-id> --mode-agent        # all modes via Strategy B
pneuma library upgrade <library-id> --mode foo,bar      # only specific modes
pneuma library upgrade <library-id> --dry-run           # show diffs / steps without applying
pneuma library upgrade <library-id> --auto-bump-only    # only bump pneumaVersion fields, no other edits
```

Help text mirrors the existing `library publish` / `library sync` style — short, example-driven.

## Open questions

1. **Migration doc discovery** — should the docs ship in `pneuma-skills/docs/migration/` (what we have today) or in a separate `@pneuma/migrations` npm package the CLI can install on-demand? The first is simpler; the second scales better if migrations grow large.
2. **Agent backend default** — Strategy B spawns a Pneuma session. Should it default to the library author's last-used backend (read from `~/.pneuma/sessions.json`) or always prompt?
3. **Rollback** — when an agent-driven migration goes wrong, what's the undo? Git revert is the obvious answer, but the CLI should at least leave a clean commit point per mode.
4. **Pre-release versions** — should an author be able to declare `pneumaVersion: "^4.0.0-rc.1"` and have `upgrade` honor that? The compat utility (#116) handles pre-release leniently; the upgrade flow should match.

## Rollout phases

1. **Phase 1 (now-ish):** Strategy A only. Authors run it manually, read migration docs themselves, bump fields with `[b]ump`. Establishes the data and the CLI shape.
2. **Phase 2 (when upstream ships first real breaking change):** Author the first per-version migration doc using the format above as a real worked example. Confirm the doc format works for both human and Strategy A consumption.
3. **Phase 3:** Add Strategy B (`--mode-agent` flag). Requires the doc format to be locked in.
4. **Phase 4:** Surface the upgrade flow from the launcher UI — "1 library has 3 incompatible modes — Upgrade" button on the library card.

## Not in scope

- Auto-upgrade on `pneuma mode add` / `pneuma library sync`. Compatibility is information, not coercion — the user decides when to migrate.
- Cross-library batching. Each library is independent; the CLI walks one at a time.
- Migrating from external git sources whose upstream maintainer is unreachable. Authors fork in that case.

## See also

- [#116](https://github.com/pandazki/pneuma-skills/pull/116) — pneumaVersion field + launcher incompatibility UI (the data + display this command consumes)
- [`pneuma-mode-gallery`](https://github.com/pandazki/pneuma-mode-gallery) — reference library with the `create-mode` skill Strategy B reuses
- `docs/migration/2.29-source-abstraction.md` — format precedent for per-version migration docs
