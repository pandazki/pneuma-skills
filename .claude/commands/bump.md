# /bump — Version Bump & Release

Perform a full version bump: sync main, write changelog, refresh top-level docs, bump version, and push.

## Steps

### 1. Sync main

```
git checkout main && git pull origin main
```

If the working tree is dirty, stop and ask the user to resolve it first.

### 2. Determine version bump

Review all commits since the last version tag to decide the bump level per [Semantic Versioning](https://semver.org):

- **patch** (x.y.Z): bug fixes, minor improvements, doc updates
- **minor** (x.Y.0): new features, new modes, new API endpoints, new viewer capabilities
- **major** (X.0.0): breaking changes to contracts, CLI interface, or manifest format

Read the current version from `package.json`. Compute the new version. If unsure, ask the user.

### 3. Write CHANGELOG entry

Read `CHANGELOG.md` and the git log since the last version bump commit. Write a new version section at the top following the existing format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...

### Improved
- ...
```

Rules:
- Group changes by category (Added / Fixed / Improved / Changed / Removed)
- Each bullet should be a concise, user-facing description — not a commit message copy
- Bold the feature name, then describe what it does
- Omit categories with no entries
- Do NOT include chore/CI/version-bump commits

### 4. Refresh top-level docs

Review `README.md` and `AGENTS.md` against the current codebase state. Fix any contradictions, outdated info, or missing features. This is a **holistic review**, not just appending — trim stale content, update tables, fix version numbers.

> `AGENTS.md` is the single source of agent instructions; `CLAUDE.md` is a one-line `@AGENTS.md` import — never write content into it.

Specifically check:
- `AGENTS.md` `**Version:**` line → update to new version
- `AGENTS.md` `**Builtin Modes:**` list → matches `core/mode-loader.ts` registrations
- `AGENTS.md` tech stack table → matches `package.json` dependencies
- `AGENTS.md` project structure tree → reflects any new/moved directories
- `AGENTS.md` server API reference → includes any new endpoints
- `.claude/rules/*.md` → add any newly discovered gotchas to the matching domain rule, remove resolved ones
- `README.md` mode table → matches manifest descriptions
- `README.md` CLI help section → matches actual CLI output
- `README.md` feature list / roadmap → reflects current state

Do NOT bloat these files — keep them concise and accurate. Remove outdated entries rather than accumulating.

### 4b. Update mode `changelog` for any mode whose skill version moved

If this release bumps any mode's `manifest.ts` `version` field, you MUST also update that manifest's `changelog` map with a matching entry — the launcher's skill-update prompt extracts these bullets to tell the user what changed in the skill they're about to reinstall. Skip this step when no mode skill version changed.

For each touched mode:
- Add a key under `changelog` matching the new `version` (e.g. `"1.3.0": [ ... ]`).
- Each bullet is a one-line user-visible summary, no markdown, no trailing period — they render as `· bullet` in a small UI surface.
- Keep at most ~6 bullets per version. The full prose lives in the project `CHANGELOG.md`.
- Don't backfill old versions you didn't ship — only annotate the version you're releasing now (and leave any pre-existing entries untouched).

**Also grep for the old literal before bumping**, in case a test hardcodes it. Tests under `server/__tests__/` and the `backends/*/[__tests__]/` lifecycle harnesses sometimes pin `webcraftManifest.version`, `slideManifest.version`, etc. with a string equality. Before the commit:

```bash
# e.g. webcraft going 1.3.0 → 1.4.0
grep -rn '"1\.3\.0"' --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.claude --exclude-dir=.worktrees .
```

Any test hit needs the new string. A miss here is silent locally but fails CI's `Release > Test, Build & Release` step on push and forces a follow-up commit.

The desktop auto-updater also surfaces highlights in its "Update Available" / "Update Ready" dialogs, but it parses them straight from the project `CHANGELOG.md` you wrote in step 3 — so a well-formed `- **Bold headline** — description` bullet there is enough; no extra wiring needed.

### 5. Bump version

Update all three files in a single commit:
1. `package.json` — `"version": "X.Y.Z"`
2. `CLAUDE.md` — `**Version:** X.Y.Z`
3. `CHANGELOG.md` — new version section (from step 3)

Plus any doc changes from step 4.

Commit message format:
```
chore: bump version to X.Y.Z — <brief milestone description>
```

### 5b. Pre-push sanity — run the test suite

Before pushing, run the **full** test suite locally — this is the one moment
it is required:

```
bun run test:all
```

Day-to-day work runs `bun run test` (everything except `backends/`, ~34s).
`test:all` is the superset, and the extra ~4 minutes is entirely the backend
lifecycle harness spawning real `claude` / `codex` / `kimi acp` processes.
Run it here anyway: a release is exactly when "the backends still boot" is
worth four minutes. (See `.claude/rules/testing.md` for the suite table and
for `kimi-cli > resume`, a live-model assertion that flakes on a machine with
the binary installed — check `git diff <base> --stat -- backends/` before
treating it as yours.)

CI runs the same suite as the gate before tagging + publishing — so a local pass is the cheapest way to avoid burning a CI cycle on a hardcoded-version mismatch or a typing slip that only manifests when something downstream re-imports the manifest. Expected output:

```
 NNNN pass
 NN skip
 0 fail
```

A non-zero `fail` count means stop and fix before pushing. The backend lifecycle suites under `backends/*/[__tests__]/` count their `(skip) ... binary not available` lines toward `skip`, not `fail`; those are fine. A `fail` for a hardcoded version expectation usually points back at step 4b's grep — re-run that grep with the previous version string and patch every hit.

### 6. Push

```
git push origin main
```

Do NOT create or push tags — CI handles that automatically.

### 6b. Deploy the online player when the release touched it

**Automatic — do this on every release whose diff touches the player, without
being asked.** CI never deploys the player; it only tags, releases and
publishes to npm. The hosted player at `pneuma.deepaste.ai` is a separate
Cloudflare Pages surface, and viewers are compiled **into its bundle at build
time** — so "the mode is in the whitelist" is not the same as "the online
player can play it", and a viewer fix that shipped in npm is still absent from
every shared link until this runs.

Decide by looking at what actually changed since the previous tag:

```bash
PREV=$(git describe --tags --abbrev=0 HEAD^)
git diff --name-only "$PREV"...HEAD -- \
  core/player-support.ts 'src/player/**' web/ 'modes/*/viewer/**' 'modes/*/domain.ts' 'modes/*/pneuma-mode.ts'
```

Any output at all means deploy. (`domain.ts` and `pneuma-mode.ts` are on the
list because a mode's viewer bundle imports them, so a change there reaches the
player even when no `viewer/` file moved.)

```bash
bash scripts/deploy-player.sh
```

Needs wrangler already logged in on this machine (`npx wrangler whoami`); if it
is not, say so and hand the command to the user rather than skipping in
silence. The script builds `dist-player/`, then deploys it plus the landing
page to the `pneuma-landing` Pages project on the `production` branch. Success
ends with `Deployment complete!` and a `*.pages.dev` preview URL; the custom
domain `pneuma.deepaste.ai` follows.

Two failure shapes worth knowing:

- **A whitelisted mode with no viewer in the deployed bundle is a hard error,
  not a degradation.** The exporter stamps a package `supported: true` from the
  whitelist in the repo, and the live player's `loadMode()` throws on a mode it
  was not built with — the user sees "This shared link could not be loaded".
  That is what happened to every eli5 link shared after 3.37.0.
- **A stale viewer degrades quietly instead.** The mode loads, but renders with
  the old build — a new construct comes out as raw markdown, which reads as
  broken without saying so.

### 7. Report

Print a summary:
- Previous version → new version
- Bump type (patch/minor/major)
- Key changes included
- Whether the online player was redeployed, and why or why not
- Confirm CI will handle tag + release + npm publish
