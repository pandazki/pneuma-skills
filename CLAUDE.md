# Pneuma Skills

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. The underlying bet: **coding agents already do the actual work against a directory of files; the system's job is to make human observation and optional participation intuitive**. Agents edit files directly through their native tools (Read/Edit/Write) — files remain the canonical collaboration surface and are not abstracted away. Viewers are live **players** for agent output, rendering the work in domain terms (a deck, a board, a project) so humans can watch what's happening, make direct decisions in the UI when needed, and reach for structured command suggestions when deeper guidance helps. Four pillars for isomorphic collaboration: a **visual environment** (live players for agent work with optional human participation), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction and skill augmentation), and **distribution** (mode marketplace, publishing, sharing). The runtime supports multiple agent backends (Claude Code, Codex) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 2.41.0
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `mode-maker`, `evolve`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun >= 1.3.5 |
| Server | Hono 4.7 |
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 + Zustand 5 |
| Terminal | xterm.js 6 + Bun native PTY |
| File Watching | chokidar 5 |
| Drawing | @excalidraw/excalidraw 0.18 |
| Diagramming | draw.io viewer-static.min.js (CDN) + rough.js 4.6 |
| Video | remotion 4.0 + @remotion/player + @remotion/web-renderer + @babel/standalone |
| Desktop | Electron 41 + electron-builder + electron-updater |
| Agent | Claude Code CLI via stdio stream-json (`-p --input-format stream-json --output-format stream-json`); Codex CLI via `app-server` stdio JSON-RPC (`node:child_process`) |

## CLI Commands

```bash
# Development
bun run dev              # Launcher UI (no mode arg)
bun run dev doc          # Doc Mode (cwd as workspace)
bun run dev slide        # Slide Mode
bun run dev doc --workspace ~/notes --port 17996 --backend claude-code --no-open --debug
bun run build            # Vite production build
bun test                 # All tests (bun:test)

# Skill evolution
pneuma evolve <mode>     # Launch evolution agent for a mode's skill

# Mode management
pneuma mode add <url>    # Install remote mode to ~/.pneuma/modes/
pneuma mode list         # List published modes on R2
pneuma mode publish      # Publish current workspace as mode

# Session registry
pneuma sessions rebuild  # Scan ~/pneuma-projects/ and restore missing Continue entries

# Plugin management
pneuma plugin add <source>   # Install plugin from path/github/URL to ~/.pneuma/plugins/
pneuma plugin list           # List builtin + external plugins with enabled status
pneuma plugin remove <name>  # Remove an external plugin

# Snapshot
pneuma snapshot push     # Upload workspace to R2
pneuma snapshot pull     # Download workspace from R2

# History sharing & replay
pneuma history export [--output FILE]  # Export session as shareable .tar.gz
pneuma history share [--title NAME]    # Export + upload to R2, return link
pneuma history open <path-or-url>      # Download/prepare replay package
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace <path>` | Workspace directory (default: cwd) |
| `--port <n>` | Server port (default: auto) |
| `--backend <type>` | Select backend at startup (`claude-code` or `codex`; session stays fixed to it) |
| `--no-open` | Don't open browser |
| `--no-prompt` | Non-interactive mode (launcher uses this) |
| `--skip-skill` | Skip skill installation (session resume without update) |
| `--debug` | Enable debug mode |
| `--dev` | Force dev mode (Vite) |
| `--replay <path>` | Load a replay package on startup (enters replay mode) |
| `--replay-source <path>` | Source workspace for existing session replay (exports + replays) |
| `--session-name <name>` | Custom session display name (default: `{mode}-{timeTag}`) |
| `--viewing` | Start in viewing mode (`editing: false` — skip skill install + agent spawn) |
| `--project <path>` | Run as a session inside the project at `<path>` (state lives under `<path>/.pneuma/sessions/{id}/`) |
| `--session-id <id>` | Resume the project session with this id (must be combined with `--project`) |

## Ports

- **17996** — default Vite dev server / production server
- **17007** — default Hono backend in dev mode
- Dev: browser → Vite, WebSocket → backend directly (`Vite` WS proxy is bypassed)
- Launcher child sessions auto-increment both ports when the defaults are occupied
- Both servers bind `hostname: "0.0.0.0"` to avoid IPv4/IPv6 dual-stack port collision

## Project Structure

```
pneuma-skills/
├── bin/                       # CLI entry — mode resolution, agent launch, session registry
├── core/
│   ├── types/                 # Contract types (ModeManifest, ViewerContract, AgentBackend, SharedHistory, PluginManifest)
│   ├── mode-loader.ts         # Mode discovery & loading (builtin + external)
│   ├── mode-resolver.ts       # Source resolution (builtin/local/github/url → disk path)
│   ├── plugin-registry.ts     # Plugin discovery, filtering, loading, activation, route mounting
│   ├── hook-bus.ts            # Waterfall event bus for plugin hooks (soft error)
│   ├── settings-manager.ts    # Plugin settings persistence (~/.pneuma/settings.json)
│   └── utils/manifest-parser.ts  # Regex-based manifest.ts metadata extraction
├── plugins/                   # Builtin plugins (same lifecycle as third-party)
│   ├── vercel/                # Vercel deploy plugin (routes + hooks + manifest)
│   └── cf-pages/              # Cloudflare Pages deploy plugin
├── modes/{webcraft,doc,slide,draw,diagram,illustrate,remotion,gridboard,kami,clipcraft,mode-maker,evolve}/
├── modes/_shared/skills/      # Global skills installed for all modes (e.g. pneuma-preferences)
├── modes/_shared/scripts/     # Shared script sources (generate_image.mjs, edit_image.mjs) — opted into per-mode via SkillConfig.sharedScripts, copied into each mode's installed skill dir at install time
├── backends/
│   ├── index.ts               # Backend registry + descriptors + capabilities + availability
│   ├── claude-code/           # Claude backend — node:child_process with -p --input-format/--output-format stream-json
│   └── codex/                 # Codex backend — stdio JSON-RPC via node:child_process
├── server/                    # Hono server, WS bridges, skill installer, file watcher, etc.
│   ├── index.ts               # Main server + launcher endpoints + WS routing
│   ├── routes/                # Export routes, deploy UI
│   ├── ws-bridge*.ts          # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON / Codex stdio)
│   ├── skill-installer.ts     # Skill copy + template engine + instructions injection
│   └── shadow-git.ts          # Shadow git init, checkpoint capture, bundle export
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout, dynamic viewer loading
│   ├── store/                 # Zustand store (9 protocol-aligned slices, including plugin-slice)
│   ├── ws.ts                  # WebSocket client
│   └── components/            # Chat, permissions, launcher, replay, context panels
├── desktop/                   # Electron desktop client (main process, preload, build scripts)
├── web/                       # Landing page (static site, CF Pages deployment)
├── snapshot/                  # R2 push/pull for workspace snapshots + mode publishing
└── docs/                      # Supplementary docs (design/, reference/, adr/, archive/)
```

> **Documentation hierarchy:** `README.md` / `CLAUDE.md` / `AGENT.md` are the source of truth.
> `docs/` contains supplementary material — see `docs/README.md` for the reading guide.

## Architecture

```
Layer 4: Mode Protocol     — ModeManifest (skill + viewer + agent config)
Layer 3: Content Viewer    — ViewerContract (render, select, agent-callable actions)
Layer 2: Agent Runtime     — AgentBackend + normalized session state + protocol bridge
Layer 1: Runtime Shell     — WS Bridge, HTTP, File Watcher, Session, Frontend
```

### Core Contracts

| Contract | File | Purpose |
|----------|------|---------|
| **ModeManifest** | `core/types/mode-manifest.ts` | Skill, viewer config, agent preferences, init params, evolution |
| **ViewerContract** | `core/types/viewer-contract.ts` | Preview component, context extraction, workspace model |
| **AgentBackend** | `core/types/agent-backend.ts` | Launch, resume, kill, capabilities |
| **EvolutionConfig** | `core/types/mode-manifest.ts` | Evolution directive, tools (part of ModeManifest) |
| **SharedHistoryPackage** | `core/types/shared-history.ts` | Exported session bundle: messages, checkpoints, metadata, summary |
| **PluginManifest** | `core/types/plugin.ts` | Plugin capabilities: hooks, slots, routes, settings |

### Plugin System

Extensible plugin architecture for deploy workflows, metadata injection, and future domains.

**Core components:** `PluginRegistry` (discovery + lifecycle), `HookBus` (waterfall events), `SettingsManager` (config persistence)

**Plugin sources:** builtin (`plugins/`), external (`~/.pneuma/plugins/`), installed via `pneuma plugin add`

**Four layers (all opt-in):**
- **Hooks** — `deploy:before/after`, `session:start/end`, `export:before/after` — modify payloads in waterfall
- **Slots** — `deploy:pre-publish`, `deploy:provider` — UI injection (declarative form or custom component)
- **Routes** — Hono sub-apps mounted at `/api/plugins/{name}/*`
- **Settings** — Schema-driven config, auto-rendered in Launcher, persisted to `~/.pneuma/settings.json`

**Lifecycle:** discover → filter (enabled/disabled) → resolve (mode/scope) → load → activate → mount routes

**Soft error:** Plugin failures (load, hook, render, route) are caught and logged — never break the main flow.

**Deploy flow:** Frontend → `POST /api/deploy` → `deploy:before` hooks → provider plugin route → `deploy:after` hooks → result

### Communication

- Browser WS `/ws/browser/:sessionId` (JSON) ↔ Server ↔ backend (both Claude and Codex use stdio; the `/ws/cli/:sessionId` endpoint is retained for legacy compatibility but no current backend connects to it)
- File changes: chokidar → WS push to browser
- Claude: `claude --print --output-format stream-json --input-format stream-json --include-partial-messages --include-hook-events --verbose --permission-mode bypassPermissions [--resume <id>]` via `node:child_process`; the launcher hands its stdin/stdout pipes to `WsBridge.attachCLITransport` / `feedCLIMessage` so the existing `routeCLIMessage` pipeline keeps working unchanged
- Codex: `codex app-server` via `node:child_process` stdio; `CodexAdapter` translates protocol via `ws-bridge-codex.ts`
- Browser session init carries normalized `backend_type`, `agent_capabilities`, `agent_version` for UI feature gating

## Mode Lifecycle

1. **Resolve** — `mode-resolver.ts` maps specifier (builtin/local/github/url) to disk path with `manifest.ts`
2. **Load manifest** — `loadModeManifest()` → ModeManifest (skill, viewer, agent config, init params)
3. **Session** — load or create `<sessionDir>/session.json` (sessionId, agentSessionId, backendType). For quick sessions `sessionDir = workspace`; for project sessions `sessionDir = <project>/.pneuma/sessions/<sessionId>/`.
4. **Skill install** — `skill-installer.ts` copies `modes/<mode>/skill/` to workspace (Claude: `.claude/skills/` + `CLAUDE.md`; Codex: `.agents/skills/` + `AGENTS.md`), applies `{{key}}` / `{{viewerCapabilities}}` templates
5. **Server start** — Hono HTTP + WebSocket + backend transport bridge
6. **Backend selection** — startup-only, workspace-locked; cannot switch mid-session
7. **Agent launch** — Claude: `claude --print --output-format stream-json --input-format stream-json …` (stdio); Codex: `codex app-server` (stdio)
8. **Frontend** — `mode-loader.ts` dynamically imports viewer; external modes use `registerExternalMode()` → `Bun.build()` → import map
9. **Preview loop** — Agent edits → chokidar → WS → browser → viewer render; User selects → `<viewer-context>` → agent

No mode arg → Launcher mode (marketplace UI, recent sessions, spawn child processes via `/api/launch`).

## Mode System

### Mode Sources

Modes can come from four sources, resolved by `core/mode-resolver.ts`:

| Type | Specifier | Resolved Path |
|------|-----------|---------------|
| **builtin** | `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `mode-maker`, `evolve` | `modes/<name>/` |
| **local** | `/abs/path`, `./rel` | As-is |
| **github** | `github:user/repo` | `~/.pneuma/modes/<user>-<repo>/` |
| **url** | `https://...tar.gz` | `~/.pneuma/modes/<name>/` |

A mode package must contain `manifest.ts` exporting a `ModeManifest`.

### Local Mode Management

- External modes are stored in `~/.pneuma/modes/`
- `pneuma mode add <url>` downloads and extracts to this directory
- Launcher scans this directory and displays "Local Modes" section
- Modes can be deleted from the launcher UI (inline confirm, not popup)
- `parseManifestTs()` in `core/utils/manifest-parser.ts` extracts metadata via regex without TS evaluation

### Session Registry

Global session history for the launcher "Recent Sessions" / "Recent Projects" surface:

- **File:** `~/.pneuma/sessions.json`
- **Schema (3.0):** `{ projects: ProjectRegistryEntry[], sessions: SessionRegistryEntry[] }`
- Each session entry carries `kind: "quick" | "project"`. Quick sessions store `workspace`; project sessions also store `projectRoot` and `sessionId`.
- Legacy 2.x array format (`SessionRegistryEntry[]`) is auto-upgraded on read; the first write persists the new shape.
- Upserted on every mode launch and project create, capped at 50 sessions / 50 projects.
- Launcher shows recent projects + recent sessions with one-click resume.

### User Preferences

Persistent user preference files managed by the agent. Two scopes, both with the same schema:

- **Personal (cross-project):** `~/.pneuma/preferences/`
- **Project-scoped (3.0):** `<projectRoot>/.pneuma/preferences/` — orthogonal to personal; only loaded for sessions inside that project.
- **Files:** `profile.md` (cross-mode), `mode-{name}.md` (per-mode).
- **Format:** Agent-managed Markdown with two system markers:
  - `<!-- pneuma-critical:start/end -->` — Hard constraints, extracted and injected into instructions file at startup.
  - `<!-- changelog:start/end -->` — Update log for incremental refresh.
- **Injection:** Personal critical → `<!-- pneuma:preferences:start/end -->` block. Project critical → `<!-- pneuma:project:start/end -->` block (alongside the project manifest summary).
- **Skill:** `pneuma-preferences` installed as global dependency for all modes; `pneuma-project` is additionally installed for project sessions.
- **Source:** `modes/_shared/skills/pneuma-preferences/`, `modes/_shared/skills/pneuma-project/`.

### Per-Session Persistence + Project Layer

Session state lives in `<stateDir>/`. The location depends on whether the session belongs to a project:

- **Quick session** — `stateDir = <workspace>/.pneuma/` (legacy 2.x layout, unchanged).
- **Project session** — `stateDir = <projectRoot>/.pneuma/sessions/<sessionId>/`. The state files sit flat in this directory (no nested `.pneuma/`); `.claude/skills/` and `CLAUDE.md` also live here so the agent's CWD = `stateDir`.

| File | Purpose |
|------|---------|
| `session.json` | sessionId, agentSessionId, mode, backendType, createdAt |
| `history.json` | Message history (auto-saved every 5s) |
| `config.json` | Init params (e.g. slideWidth, API keys) |
| `skill-version.json` | `{ mode, version }` — installed skill version for update detection |
| `skill-dismissed.json` | `{ version }` — dismissed skill update version |
| `shadow.git/` | Bare git repo for workspace change tracking (per-turn checkpoints) |
| `checkpoints.jsonl` | Checkpoint index: `{ turn, ts, hash }` per line |
| `replay-checkout/` | Temp extraction dir for checkpoint files during replay |
| `resumed-context.xml` | Injected context when continuing from replay |
| `evolution/` | Evolution proposals, backups, and CLAUDE.md snapshots |
| `deploy.json` | Deploy bindings keyed by contentSet: `{ vercel: { _default: {...} }, cfPages: { _default: {...} } }` |

**Project layer (3.0)** — `<projectRoot>/.pneuma/`:

| Path | Purpose |
|------|---------|
| `project.json` | `ProjectManifest`: `{ version, name, displayName, description?, createdAt }` |
| `preferences/` | Project-scoped preferences (`profile.md`, `mode-{name}.md`) |
| `handoffs/<id>.md` | Cross-mode handoff messages (transient — target session deletes after consuming) |
| `sessions/<sessionId>/` | One subdir per session; contents are the per-session table above |

### Skill Installation & Update Detection

On startup, skills are copied to the backend-appropriate directory under `<sessionDir>` (= workspace for quick sessions, `<project>/.pneuma/sessions/<id>/` for project sessions):
- Claude Code: `<sessionDir>/.claude/skills/<installName>/` + `CLAUDE.md`
- Codex: `<sessionDir>/.agents/skills/<installName>/` + `AGENTS.md`

Template params (`{{key}}`, `{{viewerCapabilities}}`) are applied. The instructions file is assembled from these marker blocks:
- `<!-- pneuma:start -->` / `<!-- pneuma:end -->` — Mode skill prompt (mode description, architecture, core rules)
- `<!-- pneuma:viewer-api:start -->` / `<!-- pneuma:viewer-api:end -->` — Viewer API (context, actions, scaffold, locator cards, native desktop APIs)
- `<!-- pneuma:preferences:start -->` / `<!-- pneuma:preferences:end -->` — Personal preferences critical constraints (extracted from `~/.pneuma/preferences/`)
- `<!-- pneuma:project:start -->` / `<!-- pneuma:project:end -->` — *project sessions only*; project manifest summary + project-scoped preferences critical constraints
- `<!-- pneuma:handoff:start -->` / `<!-- pneuma:handoff:end -->` — *project sessions only*; pending handoff messages targeted at this session (path + intent + suggested files; agent reads then `rm`s the file)

Two additional optional blocks are injected by other subsystems:
- `<!-- pneuma:evolved:start -->` / `<!-- pneuma:evolved:end -->` — Learned preferences summary (inside the `pneuma:start/end` block, written by the evolution system)
- `<!-- pneuma:resumed:start -->` / `<!-- pneuma:resumed:end -->` — Resume / replay context

After install, the mode version is written to `skill-version.json`. On session resume:
1. Launcher checks installed version vs current mode version
2. If different and not dismissed → inline "Skill update: X → Y" prompt with Update/Skip
3. Skip records the dismissed version; same version won't prompt again
4. `--skip-skill` flag skips skill installation entirely (used for dismissed updates)

## Project Lifecycle (3.0)

A project is a user directory marked by `<root>/.pneuma/project.json`. Inside a project you can run multiple sessions in different modes (or the same mode multiple times). All sessions share `<root>/.pneuma/preferences/` and coordinate through `<root>/.pneuma/handoffs/`.

### Project Structure

```
<project>/
├── .pneuma/
│   ├── project.json                 # ProjectManifest: name, displayName, description, createdAt
│   ├── preferences/                 # Project-scoped preferences (orthogonal to personal)
│   │   ├── profile.md
│   │   └── mode-{name}.md
│   ├── handoffs/                    # Cross-mode handoff messages (transient)
│   │   └── <id>.md
│   └── sessions/                    # Per-session state
│       └── <sessionId>/             # session.json, history.json, .claude/, CLAUDE.md, etc.
└── <user content>                   # deliverables — agent writes here
```

### Detection

On startup, `core/project-loader.detectWorkspaceKind(workspace)` returns `"project"` iff `<workspace>/.pneuma/project.json` exists. Otherwise the run is a quick session (legacy 2.x layout). `--project <path>` forces project mode and selects/creates a session id under `sessions/`.

### Environment Variables

Every session injects:

- `PNEUMA_SESSION_DIR` — the agent's CWD; where `.claude/skills/`, `CLAUDE.md`, and state files live
- `PNEUMA_HOME_ROOT` — user-facing root (project root for project sessions, workspace for quick)
- `PNEUMA_SESSION_ID` — session UUID

Project sessions also inject:

- `PNEUMA_PROJECT_ROOT` — absolute path to the project root

### Cross-Mode Handoff Protocol

The source agent writes a markdown file to `<projectRoot>/.pneuma/handoffs/<id>.md` with YAML frontmatter (`handoff_id`, `target_mode`, `target_session`, `source_session`, `source_mode`, `intent`, `suggested_files`, `created_at`). Pneuma watches the directory (`server/handoff-watcher.ts`) and surfaces a Handoff Card UI. On user confirm: source backend killed (best-effort), source `history.json` gets a `switched_out` event, target session launched, target `history.json` gets a `switched_in` event. The target's CLAUDE.md `pneuma:handoff` block names the file; the target reads + deletes it.

See `docs/design/2026-04-27-pneuma-projects-design.md` for the full design and `docs/reference/viewer-agent-protocol.md` for the env-var + frontmatter reference tables.

## Launcher

The launcher starts when no mode arg is given (`bun run dev` / `pneuma`). It serves a marketplace UI with sections: Recent Sessions, Recent Projects, Built-in Modes, Local Modes, Published Modes, and Backend Picker. See `server/index.ts` launcher block and `src/components/Launcher.tsx` for endpoints and UI.

## Server Routes

Server routes are defined in `server/index.ts` (main), `server/routes/export.ts` (export), `server/evolution-routes.ts` (evolution), `server/mode-maker-routes.ts` (mode maker). WebSocket paths: `/ws/browser/:sessionId` (JSON), `/ws/cli/:sessionId` (NDJSON), `/ws/terminal/:terminalId` (binary). Codex uses stdio JSON-RPC, not WebSocket.

Native desktop APIs (`/api/native/*`) are available only in Electron. Architecture: Server → WS `native_request` → Browser → Electron IPC → result → WS `native_result` → Server. Web environments return `{ available: false }`.

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: changes to contracts → update `core/types/` + `core/__tests__/`
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Backend selected at startup only** — do not add runtime backend switching to the session UI
- **Zustand** sliced store (`src/store/`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`)
- **English only** in source code — all comments, JSDoc, variable names, commit messages, and documentation in `core/`, `server/`, `src/`, `backends/`, `bin/`. Chinese is allowed only in mode seed templates (e.g. `zh-light/`, `zh-dark/`), showcase content, and `docs/` archive
- **Visual verification for frontend changes**: After modifying viewer components, CSS, or any UI-facing code, use `chrome-devtools-mcp` to take a screenshot of the running dev server and verify the rendered result before reporting completion. Do not rely solely on reading code to judge visual correctness.

## Release Process

CI (`release.yml`) handles tagging, GitHub Release, and npm publish on push to `main`.

**Do NOT manually create or push git tags.**

### Version Bump Checklist

Update in the same commit:
1. `package.json` — `"version"`
2. `CLAUDE.md` — `**Version:**` line
3. `CHANGELOG.md` — new version section

Then `git push origin main` (no `--tags`). CI creates tag, release, and publishes.

## Known Gotchas

- **chokidar glob**: Watch directory path, filter in callback. Don't use `watch("**/*.md", { cwd })`.
- **react-resizable-panels v4.6**: `Group` not `PanelGroup`, `Separator` not `PanelResizeHandle`, `orientation` not `direction`.
- **Vite WS proxy + Bun.serve**: Browser WS connects directly to backend port, bypassing Vite.
- **Stale `dist/`**: If `dist/index.html` exists, the server falls back to production mode. Delete `dist/` or pass `--dev` explicitly. Launcher-spawned children auto-inherit `--dev`.
- **Bun.serve dual-stack**: Must set `hostname: "0.0.0.0"` to avoid IPv6/IPv4 port collision on macOS.
- **CLAUDECODE env var**: Must be unset when spawning Claude Code CLI.
- **Backend persistence**: `backendType` in `.pneuma/session.json` and `~/.pneuma/sessions.json` is part of resume identity.
- **NDJSON**: Each message to CLI must end with `\n`.
- **Empty assistant messages**: `MessageBubble` returns null when content is empty (tool_use-only messages).
- **modelUsage cumulative**: Use delta (current - previous) for per-turn cost.
- **`backdrop-filter` containing block**: Creates a containing block for fixed-positioned children, causing coordinate offset in Excalidraw. Avoid or account for it.
- **`@zumer/snapdom`**: Capture iframes must be `display: none` during snapdom calls — visible iframes cause foreignObject text reflow. See `useSlideThumbnails.ts` and `export.ts`.
- **GridBoard JSX tag limitation**: Tile compiler (Babel + eval) cannot resolve locally-defined components as JSX tags. Use `{renderMyComponent(...)}` function calls instead.
- **Shadow-git checkpoint queue**: All checkpoint operations are serialized via Promise chain to prevent `index.lock` conflicts. Do not parallelize.
- **Codex gotchas**: (1) `ws-bridge-codex.ts` must merge adapter's partial session with server's full state before broadcasting — adapter omits `agent_capabilities`, causing UI crashes if sent raw. (2) Bun's `proc.stdout` ReadableStream may close prematurely; Codex uses `node:child_process` instead — do not switch back without verifying the Bun bug is fixed. (3) Codex uses stdio (no `cliSocket`), so `handleBrowserOpen` and `getActiveSessionId` must check `codexAdapters` map to avoid `cli_disconnected` or null.
- **Replay gotchas**: (1) When `--replay` is passed, agent launch is deferred until `/api/replay/continue`; server holds a `replayContinueCallback`. (2) Each checkout cleans `.pneuma/replay-checkout/` before extracting for checkpoint-accurate state; Continue Work extracts final checkpoint to workspace root. (3) File navigation must run AFTER checkpoint loads (not during `displayMessage`), because content sets aren't computed until `setFiles` completes.
- **Proxy gotchas**: (1) `proxy.json` changes are hot-reloaded via chokidar, no restart needed. (2) Default allowed method is GET only — POST/PUT/PATCH require explicit `"methods"` in config. (3) Bun's `fetch()` auto-decompresses gzip/br; proxy strips `content-encoding` to prevent double-decompression.
- **Editing/readonly distinction**: `editing` is a session boolean (`true` = creating, `false` = consuming). Modes opt in via `editing: { supported: true }` in manifest. When `editing: false`, no agent runs; switching to `true` triggers skill install + agent spawn; switching back kills the agent. `readonly` (replay) disables ALL interactions, while `editing: false` only hides Pneuma editing UI — content-internal interactions (clicks, links) remain functional.
- **Windows compatibility**: Cross-platform support in `path-resolver.ts` (`where` vs `which`, PATH from `LOCALAPPDATA`/`APPDATA`), `terminal-manager.ts` (`COMSPEC`/`cmd.exe`), `system-bridge.ts` (`cmd /c start`), `server/index.ts` (`NUL`, `taskkill`). Path comparison is case-insensitive on win32.
- **Native bridge timeout**: Routes through browser WS — if no browser tab is connected, native calls timeout after 10s.
- **Diagram viewer**: See `modes/diagram/viewer/DiagramPreview.tsx` header comments for architecture and gotchas (native events, SVG pointer-events, sketch injection, rough.js load order).
- **Handoff confirm cannot kill its own session**: when a project session's HandoffCard is clicked Confirm, `killActiveSession(sourceSessionId)` runs in the source session's own server — but the source process was spawned by the launcher (or directly), not by itself. The source backend keeps running until the user closes the tab. The `switched_out` history event is still recorded; the target launches normally.
- **Project session state pollution if `--project` is dropped**: subcommands that don't parse `--project` would write state into the project root, conflicting with the project layer. All built-in subcommands (including `evolve`) now respect `--project`; external mode authors must mirror this when authoring custom CLI entry points.
- **Empty shell renders without `modeViewer`**: the `?project=<root>` URL (no `session`, no `mode`) lands on `EmptyShell` which mounts `TopBar` *without* a session. `TopBar` gates the tabs row, share dropdown, and editing toggle on `!!modeViewer`; the left chip strip stays. Any new TopBar feature must guard for `modeViewer` being null in this state. `ProjectChip` lives in the strip and reads `projectContext` (which `EmptyShell` populates from `/api/projects/:id/sessions`); the chip's auto-open is computed inside the chip via URL inspection (no prop threading from `TopBar`).
- **Project session id vs backend id**: for project sessions, `<projectRoot>/.pneuma/sessions/<id>/session.json`'s top-level `sessionId` is the *project session* id (= directory name = what the URL carries as `--session-id`). The backend's protocol id is stored separately in `agentSessionId`. `scanProjectSessions` falls back to the directory name if `sessionId` is missing/empty (defensive against pre-fix sessions). Reopening a project session uses the project session id; routing CLI ↔ backend uses `agentSessionId`. **Never** let the backend id leak into the registry / panel — it'll resolve to a non-existent directory.
