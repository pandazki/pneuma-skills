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

Review `README.md` and `CLAUDE.md` against the current codebase state. Fix any contradictions, outdated info, or missing features. This is a **holistic review**, not just appending — trim stale content, update tables, fix version numbers.

Specifically check:
- `CLAUDE.md` `**Version:**` line → update to new version
- `CLAUDE.md` `**Builtin Modes:**` list → matches `core/mode-loader.ts` registrations
- `CLAUDE.md` tech stack table → matches `package.json` dependencies
- `CLAUDE.md` project structure tree → reflects any new/moved directories
- `CLAUDE.md` server API reference → includes any new endpoints
- `CLAUDE.md` known gotchas → add any new ones discovered, remove resolved ones
- `README.md` mode table → matches manifest descriptions
- `README.md` CLI help section → matches actual CLI output
- `README.md` feature list / roadmap → reflects current state

Do NOT bloat these files — keep them concise and accurate. Remove outdated entries rather than accumulating.

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

### 6. Push

```
git push origin main
```

Do NOT create or push tags — CI handles that automatically.

### 7. Report

Print a summary:
- Previous version → new version
- Bump type (patch/minor/major)
- Key changes included
- Confirm CI will handle tag + release + npm publish
