# Changelog

All notable changes to this project will be documented in this file.

## [1.6.1] - 2026-03-01

### Changed
- Slide skill workflow: scaffold all empty slides + manifest first so the viewer shows the full deck structure immediately, then fill content slide-by-slide
- Updated CLAUDE.md, README.md with draw mode, mode-resolver, snapshot module, and accurate component/test counts

### Fixed
- Draw mode not registered in builtin mode tables (`mode-loader.ts` and `mode-resolver.ts`)

## [1.6.0] - 2026-03-01

### Added
- **Draw Mode** — Excalidraw whiteboard mode for `.excalidraw` file editing with live preview
- Remote mode loading — load custom modes from local paths (`pneuma /path/to/mode`) or GitHub repositories (`pneuma github:user/repo#branch`)
- New `core/mode-resolver.ts` for mode source resolution and GitHub clone caching (`~/.pneuma/modes/`)
- External mode registration in `core/mode-loader.ts` with support for both Bun backend and browser frontend (Vite `/@fs/` imports)
- `/api/mode-info` server endpoint for frontend external mode discovery
- Vite config `server.fs.allow` support for external mode directories
- AskUserQuestion interactive UI with option cards in PermissionBanner

### Changed
- Slide image generation script rewritten from Python (`generate_image.py`) to Node.js (`generate_image.mjs`) — zero external dependencies

### Fixed
- Slide sandboxed iframe image reload — uses meta tag injection instead of `location.reload()`

## [1.5.0] - 2026-02-28

### Added
- Self-contained HTML download for slide export — "Download HTML" button inlines all local assets (images, CSS, fonts) as base64 data URIs for fully offline viewing

### Fixed
- Export page slides not centered in viewport — body width moved to `@media print` only
- Export download failing with non-ASCII titles — RFC 5987 Content-Disposition encoding

## [1.4.1] - 2026-02-28

### Fixed
- Slide navigator thumbnails not showing images — proper URL resolution and base64 inlining for SVG foreignObject (#10)
- Grid view selected slide ring extending beyond thumbnail — removed redundant ring wrapper (#12)
- Export page losing styles: preserves `<head>` resources, `<body>` attributes, and theme background colors (#15)
- Export/print CJK text invisible — inject explicit CJK system fonts (PingFang SC, Noto Sans CJK SC, Microsoft YaHei) into `--font-sans` before `sans-serif`
- Export print missing backgrounds — add `print-color-adjust: exact` and `break-inside: avoid` for slides

### Changed
- Slide skill font guidance: `style_reference.md` and `SKILL.md` now require CJK system fonts in `--font-sans`

## [1.4.0] - 2026-02-28

### Added
- Element thumbnail capture: selected elements shown as SVG snapshots in ChatInput chip and SelectionCard
- CSS selector displayed in selection UI labels (replaces `<tag.class>` format)
- SVG icons directly selectable (added to semantic element list)

### Changed
- Simplified context sent to Claude Code: just `[User selected: <css-selector>]` instead of verbose 4-line format
- Selection bubble-up threshold lowered from 150×80 to 40×40 for better small element selection

### Fixed
- Clicking X on selection chip now clears highlight in viewer iframe (#13)
- `selector` field properly passed through full chain (iframe → store → extractContext)
- Selection with CSS selector but empty text content no longer silently dropped

## [1.3.2] - 2026-02-28

### Fixed
- Slide thumbnails missing viewport meta and base href, causing lost padding and broken assets

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
