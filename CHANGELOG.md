# Changelog

All notable changes to this project will be documented in this file.

## [1.3.1] - 2026-02-28

### Fixed
- Default slide outline position to bottom for narrow screens (was left sidebar)
- Chat panel narrowed to 40% (from 45%), preview widened to 60%
- Arrow keys no longer captured by slide navigation when typing in input fields (#7, #8)

## [1.3.0] - 2026-02-28

### Added
- `pneuma snapshot push/pull/list` commands for workspace distribution via Cloudflare R2
- `--include-skills` flag to optionally bundle `.claude/skills/` in snapshots
- `InitParam.sensitive` field in ModeManifest — sensitive config values stripped on snapshot push
- Pull prompts before overwriting existing directory
- Pull offers to launch immediately after extraction
- Auto port retry on EADDRINUSE (up to 10 consecutive ports)
- Skill editing workflow: scope determination step (deck-wide vs single slide)

### Changed
- Slide API key params (`openrouterApiKey`, `falApiKey`) marked as `sensitive: true`
- CLI hint commands now use `bunx pneuma-skills` prefix
