# Pneuma Skills

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. Agents edit files directly (Read/Edit/Write); files remain the canonical collaboration surface. Viewers are live **players** for agent output, rendering work in domain terms (a deck, a board, a project) so humans can watch, intervene in the UI, or hand structured guidance back. Four pillars: a **visual environment** (live players with optional participation), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction), and **distribution** (mode marketplace, publishing, sharing). Multiple agent backends (Claude Code, Codex, Kimi CLI) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 3.10.5
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `mode-maker`, `evolve`, `project-evolve`, `project-onboard`

> Modes can set `hidden: true` to disappear from user-pickable lists (launcher grids, ProjectPanel mode-tile picker). Internal modes (`evolve`, `project-evolve`, `project-onboard`) are hidden — triggered by specific UI affordances or programmatically, never by a "what mode to start?" choice.

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
| Agent | Claude Code CLI stdio stream-json; Codex CLI `app-server` stdio JSON-RPC; Moonshot Kimi CLI stdio stream-json (`kimi --print … -y`) — all via `node:child_process` |

## CLI Commands

```bash
# Development
bun run dev              # Launcher UI (no mode arg)
bun run dev doc          # Doc Mode (cwd as workspace)
bun run dev doc --workspace ~/notes --port 17996 --backend claude-code --no-open --debug
bun run build            # Vite production build
bun test                 # All tests (bun:test)

# Skill evolution
pneuma evolve <mode>

# Mode management
pneuma mode add <url>        # Install remote mode (single → ~/.pneuma/modes/; library → ~/.pneuma/libraries/)
pneuma mode list             # List published modes on R2
pneuma mode publish          # Publish workspace as mode

# Mode libraries (multi-mode GitHub repos)
pneuma library init <name> [--github user/repo] [--private]
pneuma library link <github:user/repo>           # Alias for `mode add`
pneuma library list
pneuma library sync <id>                         # Pull latest (git fetch + checkout)
pneuma library publish <mode> [--to id] [--as name] [--push]
pneuma library push <id>                         # `git push origin HEAD`
pneuma library activate|deactivate <id> <mode>
pneuma library unlink <id>                       # Remove library + clone

# Project recovery / plugins / snapshot / history
pneuma project add <path>                        # Register existing project into ~/.pneuma/sessions.json
pneuma plugin add|list|remove <source>           # Install to ~/.pneuma/plugins/
pneuma snapshot push|pull                        # R2 workspace snapshot
pneuma history export [--output FILE]            # Session as .tar.gz
pneuma history share [--title NAME]              # Export + upload to R2
pneuma history open <path-or-url>                # Prepare replay package

# Agent command distribution (3.10.0)
pneuma agent-command status [--backend claude-code|codex|all] [--json]
pneuma agent-command install [--backend claude-code|codex|all] [--force] [--json]
pneuma agent-command uninstall [--backend claude-code|codex|all] [--force] [--json]
pneuma agent-command update [--backend claude-code|codex|all] [--json]
pneuma mode list --local [--json]                # builtins + ~/.pneuma/modes + activated library modes
pneuma handoff-from-external --intent <text> --mode <name> [--cwd <path>] \
    [--init-project|--quick] [--source-agent claude-code|codex] [--json] [--dry-run]
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace <path>` | Workspace directory (default: cwd) |
| `--port <n>` | Server port (default: auto) |
| `--backend <type>` | Startup backend selection (`claude-code` or `codex`; locked for session) |
| `--no-open` | Don't open browser |
| `--no-prompt` | Non-interactive (used by launcher) |
| `--skip-skill` | Skip skill installation (session resume) |
| `--debug` | Enable debug mode |
| `--dev` | Force dev mode (Vite) |
| `--replay <path>` | Load replay package on startup (replay mode) |
| `--replay-source <path>` | Source workspace for existing-session replay |
| `--session-name <name>` | Custom display name (default: `{mode}-{timeTag}`) |
| `--viewing` | Viewing mode (`editing: false` — skip skill install + agent spawn) |
| `--project <path>` | Run as session inside the project at `<path>` |
| `--session-id <id>` | Resume project session (requires `--project`) |

## Ports

- **17996** — Vite dev server / production server
- **17007** — Hono backend in dev mode
- Dev: browser → Vite, WebSocket → backend directly (Vite WS proxy bypassed)
- Launcher children auto-increment when defaults occupied
- Both servers bind `hostname: "0.0.0.0"` to avoid IPv4/IPv6 dual-stack port collision

## Project Structure

```
pneuma-skills/
├── bin/                       # CLI entry — mode resolution, agent launch, session registry
├── core/
│   ├── types/                 # Contracts (ModeManifest, ViewerContract, AgentBackend, SharedHistory, PluginManifest, LibraryManifest)
│   ├── mode-loader.ts         # Mode discovery & loading
│   ├── mode-resolver.ts       # Source resolution (builtin/local/github/url → disk); single-vs-library detection at install
│   ├── library-registry.ts    # ~/.pneuma/libraries/<id>/ CRUD: detectRepoShape, linkLibrary, syncLibrary, activate/unlink, sidecar I/O
│   ├── library-publish.ts     # Author side: initLocalLibrary, publishModeToLibrary, pushLibrary
│   ├── github-cli.ts          # `gh` wrapper — detectGh + createRepo
│   ├── favorites.ts           # ~/.pneuma/favorites.json
│   ├── plugin-registry.ts     # Plugin discovery, lifecycle, route mounting
│   ├── hook-bus.ts            # Waterfall hook event bus (soft error)
│   ├── settings-manager.ts    # Plugin settings persistence
│   └── utils/manifest-parser.ts  # Regex-based manifest.ts metadata extraction
├── plugins/                   # Builtin plugins (vercel/, cf-pages/)
├── modes/{webcraft,doc,slide,draw,diagram,illustrate,remotion,gridboard,kami,clipcraft,mode-maker,evolve}/
├── modes/_shared/skills/      # Global skills for all modes (e.g. pneuma-preferences)
├── modes/_shared/scripts/     # Shared scripts (generate_image.mjs, edit_image.mjs); opted in via SkillConfig.sharedScripts and copied per-mode at install
├── backends/
│   ├── index.ts               # Pure registry over per-backend manifests; getInstallConventions / getBackendModule / descriptor / capability / availability helpers
│   ├── __tests__/lifecycle-harness.ts   # Shared 6-scenario harness reused by every backend
│   ├── claude-code/{manifest.ts,README.md,__tests__/}    # stdio stream-json
│   ├── codex/{manifest.ts,README.md,__tests__/}          # stdio JSON-RPC
│   └── kimi-cli/{manifest.ts,README.md,__tests__/}       # stdio stream-json (--print)
├── server/
│   ├── index.ts               # Hono server + launcher endpoints + WS routing
│   ├── routes/                # Export routes, deploy UI
│   ├── library-routes.ts      # /api/libraries/* + /api/github/status (launcher-scope)
│   ├── agent-command-routes.ts # /api/agent-commands/* + /api/handoffs/external + /api/cli/* (launcher-scope)
│   ├── ws-bridge*.ts          # WS bridge to browsers (JSON); per-backend BridgeBackends in ws-bridge-{kimi,codex}.ts
│   ├── ws-bridge-backend.ts   # BridgeBackend interface (attach / routeBrowserMessage / injectUserMessage / disconnect)
│   ├── skill-installer.ts     # Skill copy + template engine + instructions injection
│   └── shadow-git.ts          # Shadow git, per-turn checkpoint capture, bundle export
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout, dynamic viewer loading
│   ├── store/                 # Zustand store (9 protocol-aligned slices)
│   ├── hooks/                 # Reusable hooks (useFavorites, useThumbnailCapture, …)
│   ├── ws.ts                  # WebSocket client
│   └── components/            # Chat, permissions, launcher, replay, context panels
├── desktop/                   # Electron client
├── web/                       # Landing page (CF Pages)
├── snapshot/                  # R2 push/pull
└── docs/                      # Supplementary docs (design/, reference/, adr/, archive/)
```

> **Documentation hierarchy:** `README.md` / `CLAUDE.md` / `AGENTS.md` are the source of truth. `docs/` contains supplementary material — see `docs/README.md`.

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
| **ModeManifest** | `core/types/mode-manifest.ts` | Skill, viewer config, agent prefs, init params, evolution |
| **ViewerContract** | `core/types/viewer-contract.ts` | Preview component, context extraction, workspace model |
| **AgentBackend** | `core/types/agent-backend.ts` | Launch/resume/kill/capabilities (process-lifecycle layer) |
| **BridgeBackend** | `server/ws-bridge-backend.ts` | Per-backend bridge handler; non-Claude backends (codex, kimi-cli) implement so central WsBridge stays backend-agnostic |
| **BackendModule** | `core/types/agent-backend.ts` | Self-describing per-backend manifest: identity, capabilities, install conventions (skillsDir / instructionsFile / displayLabel), install hint, default models, lifecycle factories. Each backend ships its own `manifest.ts`; `backends/index.ts` is a pure registry. Optional `toolFileRef(name, input)` → normalized file ref for chat previews/actions. |
| **EvolutionConfig** | `core/types/mode-manifest.ts` | Evolution directive, tools |
| **SharedHistoryPackage** | `core/types/shared-history.ts` | Exported bundle: messages, checkpoints, metadata, summary |
| **PluginManifest** | `core/types/plugin.ts` | Plugin capabilities: hooks, slots, routes, settings |

### Plugin System

Extensible architecture for deploy workflows, metadata injection, future domains.

- **Core:** `PluginRegistry` (discovery + lifecycle), `HookBus` (waterfall events), `SettingsManager` (config persistence)
- **Sources:** builtin (`plugins/`), external (`~/.pneuma/plugins/`), via `pneuma plugin add`
- **Four layers (all opt-in):** **Hooks** (`deploy:before/after`, `session:start/end`, `export:before/after` — waterfall payload mutation) / **Slots** (`deploy:pre-publish`, `deploy:provider` — UI injection) / **Routes** (Hono sub-apps at `/api/plugins/{name}/*`) / **Settings** (schema-driven, auto-rendered, persisted to `~/.pneuma/settings.json`)
- **Lifecycle:** discover → filter → resolve → load → activate → mount routes
- **Soft error:** plugin failures (load, hook, render, route) are caught + logged; main flow never breaks
- **Deploy flow:** Frontend → `POST /api/deploy` → `deploy:before` → provider plugin route → `deploy:after` → result

### Communication

- Browser WS `/ws/browser/:sessionId` (JSON) ↔ Server ↔ backend (all backends use stdio; `/ws/cli/:sessionId` retained for legacy, no current backend uses it)
- File changes: chokidar → WS push to browser
- Claude: `claude --print --output-format stream-json --input-format stream-json --include-partial-messages --include-hook-events --verbose --permission-mode bypassPermissions [--resume <id>]` via `node:child_process`; launcher hands stdin/stdout to `WsBridge.attachCLITransport` / `feedCLIMessage` so `routeCLIMessage` stays unchanged
- Codex: `codex app-server` stdio; `CodexAdapter` translates via `ws-bridge-codex.ts`
- Session init carries normalized `backend_type`, `agent_capabilities`, `agent_version` for UI feature gating
- `tool_use` blocks may carry normalized `fileRef` (`{ path, kind }`), stamped server-side by `stampFileRefs` (`server/file-ref.ts`) via each `BackendModule`'s `toolFileRef`. Chat renders inline image previews (`FilePreview`) + system-open actions (`ToolFileActions` — open/editor/reveal via `/api/system/*`) with zero tool-name knowledge

## Mode Lifecycle

1. **Resolve** — `mode-resolver.ts` maps specifier (builtin/local/github/url) to disk path with `manifest.ts`
2. **Load manifest** — `loadModeManifest()` → ModeManifest
3. **Session** — load or create `<sessionDir>/session.json`. Quick: `sessionDir = workspace`; project: `sessionDir = <project>/.pneuma/sessions/<sessionId>/`
4. **Skill install** — `skill-installer.ts` copies `modes/<mode>/skill/` (Claude: `.claude/skills/` + `CLAUDE.md`; Codex: `.agents/skills/` + `AGENTS.md`), applies `{{key}}` / `{{viewerCapabilities}}`
5. **Server start** — Hono HTTP + WebSocket + backend transport bridge
6. **Backend selection** — startup-only, workspace-locked
7. **Agent launch** — stdio per backend
8. **Frontend** — `mode-loader.ts` dynamic import; external modes via `registerExternalMode()` → `Bun.build()` → import map
9. **Preview loop** — Agent edits → chokidar → WS → browser → viewer render; User selects → `<viewer-context>` → agent

No mode arg → Launcher (marketplace UI, recent sessions, spawn children via `/api/launch`).

## Mode System

### Mode Sources (resolved by `core/mode-resolver.ts`)

| Type | Specifier | Resolved Path |
|------|-----------|---------------|
| **builtin** | `webcraft`, `doc`, `slide`, etc. | `modes/<name>/` |
| **local** | `/abs/path`, `./rel` | As-is |
| **github (single)** | `github:user/repo` with root `manifest.ts` | `~/.pneuma/modes/<user>-<repo>/` |
| **github (library)** | `github:user/repo` with `pneuma.library.json` OR N subdirs each having `manifest.ts` | `~/.pneuma/libraries/<user>-<repo>/` |
| **url** | `https://...tar.gz` | `~/.pneuma/modes/<name>/` (or libraries if archive is a library) |

A mode package contains `manifest.ts` exporting a `ModeManifest`. Library detection runs AFTER clone/extract — the single-mode path is byte-identical for repos that don't look like libraries.

### Local Modes

- External modes in `~/.pneuma/modes/`; installed via `pneuma mode add <url>`
- Launcher scans + displays under "Local Modes"; deletable inline (not popup)
- `parseManifestTs()` in `core/utils/manifest-parser.ts` extracts metadata via regex without TS evaluation

### Mode Libraries (3.7.0)

Multi-mode GitHub repo. One `pneuma mode add` clones the whole repo into `~/.pneuma/libraries/<id>/`; each mode is independently activated, version-tracked, and surfaced in Mode Gallery + Quick Start.

| Path | Purpose |
|------|---------|
| `~/.pneuma/libraries/<id>/` | Cloned repo (or scaffolded). `<id>` defaults to `<user>-<repo>` |
| `~/.pneuma/libraries/<id>/.library.json` | Consume-side sidecar: `{ version, id, name, source, sha, lastSync, pneumaVersion?, modes: [{ name, path, manifestVersion, pneumaVersion?, activated, installedVersion }] }`. Atomic tmp-then-rename writes |
| `<repo-root>/pneuma.library.json` | Optional author-side index. Absent → resolver auto-scans subdirs |

**Resolver behavior** (`core/mode-resolver.ts`):
- `resolveModeOrLibrary(specifier)` — install-aware entry, returns discriminated `ResolveResult` (`kind: "single" | "library"`). Used by `pneuma mode add`, `library link`, `/api/libraries/link`
- `resolveMode(specifier)` — legacy; for launch-path callers. Library specifier → helpful error pointing to `pneuma mode add`
- Shape detection (`detectRepoShape` in `core/library-registry.ts`): root `manifest.ts` → single; root `pneuma.library.json` → library; otherwise auto-scan immediate subdirs

**Consume side** (`core/library-registry.ts`): `linkLibrary`, `syncLibrary` (reconciles sidecar against current state — preserves activation, surfaces updates without auto-accepting), `setModeActivated`, `acceptModeUpdate`, `unlinkLibrary`, `getLibraryModePath`.

**Author side** (`core/library-publish.ts`): `initLocalLibrary` (scaffold + git init + commit), `publishModeToLibrary` (cp -r + upsert index + sync sidecar + commit), `pushLibrary`. `--github` on `library init` calls `core/github-cli.ts::createRepo` (`gh repo create --source --push`). No PAT fallback in v1; Settings → GitHub card surfaces install + sign-in hints when `gh` missing/unauth.

**Mode Gallery surface:** Libraries group between Local and Published. Each library: identity strip (display name, source URL chip, last-synced ts) + inline Sync / + Publish / Unlink, then `GalleryModeCard` per activated mode, then collapsible "N inactive modes" footer. Library-activated modes also appear in Quick Start via `/api/registry` `local[]` (with `librarySource: { id, name, displayName? }` tag).

### Pneuma version compatibility (3.9.0)

External mode authors declare `pneumaVersion` (semver range, e.g. `"^3.8.0"`) in `manifest.ts`. Library authors can stamp the same field in `pneuma.library.json` as a fallback. The launcher pre-computes compat (`core/version-compat.ts::checkCompat`) for every local entry and renders:

- **`major-drift`** → `GalleryModeCard` dims + red "Incompatible" chip + destructive launch button (confirm-before-launch); `QuickStartTile` dims + bottom-right red dot + confirm-on-click
- **`minor-drift`** → amber "Minor drift" chip on the card (non-blocking)
- **`match`** / **`unknown`** (no declaration) → render unchanged; the check is opt-in

`/api/registry` carries `runtimeVersion` + per-entry `compat: { level, declared, runtime, reason? }`. Builtins never receive a compat field (they ship with the runtime). Resolution precedence: per-mode `pneumaVersion` > sidecar cache > library-level fallback. See `docs/design/pneuma-library-upgrade.md` for the planned `pneuma library upgrade` CLI that will consume these declarations.

### Favorites (3.7.0)

Persistent list of pinned modes; bubble to front of every picker.

- **File:** `~/.pneuma/favorites.json` — atomic write, graceful fallback to `["webcraft", "slide", "diagram", "illustrate", "remotion", "kami"]` if missing/malformed
- **Hook:** `src/hooks/useFavorites.ts` — `useFavorites()` returns `{ favorites, isFavorite, toggle }`. Optimistic toggle with write-sequence guard. `sortFavoritesFirst(modes, favorites, getName)` is the stable-sort helper
- **Surfaces:** QuickStartTile renders filled-star top-left when favorited (pairs with library link glyph top-right). GalleryModeCard header has star toggle next to Evolve/Edit. ProjectPanel mode-tile picker orders favorites first → used-in-project recency → rest by builtin priority

### Session Registry

Global session history for launcher Recent Sessions/Projects:

- **File:** `~/.pneuma/sessions.json` (single source of truth — no auto-scan, no auto-recovery)
- **Schema (3.0):** `{ projects: ProjectRegistryEntry[], sessions: SessionRegistryEntry[] }`. Each session has `kind: "quick" | "project"`. Quick: `workspace`; project also: `projectRoot`, `sessionId`
- Legacy 2.x array format auto-upgraded on read
- Upserted on every launch/project create; capped at 50 sessions / 50 projects
- **Project recovery (3.4.0):** if Project drops out of registry, restore via (a) *Create Project* on same path — Open-or-Create logic detects existing `<root>/.pneuma/project.json` (or sessions/ dir without manifest), loads/synthesizes, stamps `onboardedAt`, upserts; or (b) `pneuma project add <path>`. Startup auto-scan of `~/pneuma-projects/` was removed in 3.4.0 — predictable registry over silent recovery

### Running-Session Registry (3.5.1)

`~/.pneuma/running/` — pid-files, one per live `pneuma <mode>` process (`bin/running-registry.ts`). Each process writes on startup (`{ id, kind, mode, displayName, workspace, projectRoot?, sessionId?, sessionDir, backendType, url, pid, startedAt }`, `id` = `sessions.json` scheme) and removes on exit; readers prune dead-PID/gone-workspace. System-wide truth for "which sessions are running" — orthogonal to a launcher's `childProcesses` map (which only knows children *it* spawned; Smart Handoff and `project-onboard` apply spawn from *other* session servers). `GET /api/running` reads it; the launcher's Continue surface uses it, so a project that switched modes internally shows its *current* mode. Temp workspaces + launcher process skipped.

### User Preferences

Agent-managed persistent preference files. Two scopes, same schema:

- **Personal:** `~/.pneuma/preferences/` (cross-project)
- **Project (3.0):** `<projectRoot>/.pneuma/preferences/` (orthogonal; only for sessions inside)
- **Files:** `profile.md` (cross-mode), `mode-{name}.md` (per-mode)
- **Markers:** `<!-- pneuma-critical:start/end -->` (hard constraints → injected into instructions at startup); `<!-- changelog:start/end -->` (update log)
- **Injection:** Personal critical → `<!-- pneuma:preferences:start/end -->`. Project critical → `<!-- pneuma:project:start/end -->`
- **Skill:** `pneuma-preferences` (global, all modes); `pneuma-project` (additionally for project sessions). Sources in `modes/_shared/skills/`

### Per-Session Persistence + Project Layer

Session state in `<stateDir>/`:
- **Quick:** `stateDir = <workspace>/.pneuma/` (legacy 2.x)
- **Project:** `stateDir = <projectRoot>/.pneuma/sessions/<sessionId>/`. State files flat (no nested `.pneuma/`); `.claude/skills/` + `CLAUDE.md` also here so agent CWD = `stateDir`

| File | Purpose |
|------|---------|
| `session.json` | sessionId, agentSessionId, mode, backendType, createdAt; optional `displayName`/`description`/`refinedAt` from `pneuma session refine` |
| `history.json` | Message history (auto-saved every 5s) |
| `config.json` | Init params |
| `skill-version.json` | `{ mode, version }` — installed skill for update detection |
| `skill-dismissed.json` | `{ version }` — dismissed update |
| `shadow.git/` | Bare git for workspace tracking (per-turn checkpoints) |
| `checkpoints.jsonl` | `{ turn, ts, hash }` per line |
| `replay-checkout/` | Temp extraction during replay |
| `resumed-context.xml` | Injected context when continuing replay |
| `evolution/` | Evolution proposals, backups, CLAUDE.md snapshots |
| `deploy.json` | Deploy bindings keyed by contentSet: `{ vercel: { _default: {...} }, cfPages: { _default: {...} } }` |

**Project layer (3.0)** — `<projectRoot>/.pneuma/`:

| Path | Purpose |
|------|---------|
| `project.json` | `ProjectManifest`: `{ version, name, displayName, description?, createdAt, founderSessionId?, onboardedAt? }` |
| `preferences/` | Project-scoped preferences |
| `sessions/<id>/.pneuma/inbound-handoff.json` | Handoff payload, written by `/api/handoffs/:id/confirm` pre-spawn; target agent reads + `rm`s on first turn |
| `sessions/<sessionId>/` | Per-session state (table above) |

### Session-meta refine (3.6.0)

Every session has a row in Recent Sessions. Default title/summary is `"<Mode> session"` + first user-message preview (the synthetic `<pneuma:env reason="opened">` for project sessions — uninformative). `pneuma session refine` lets the agent rewrite both once substance accumulates.

- **CLI:** `pneuma session refine --json '{"displayName": "<≤40 chars>", "description": "<≤280 chars>"}'` (reads `PNEUMA_SERVER_URL` / `PNEUMA_SESSION_ID`)
- **Route:** `POST /api/session/refine` — atomically rewrites `<sessionDir>/session.json`, syncs registry entry (unless `sessionName` explicitly set), broadcasts `session_meta_updated`
- **Skill:** `pneuma-session` (global, all sessions). Teaches when to refine, how to phrase (topic, not work done), and to use a Task subagent for proactive non-blocking refines
- **UI:** ProjectPanel session row prefers `description` over `preview`, mode-icon chip next to title; re-fetches on `session_meta_updated`

### Skill Installation & Update Detection

Skills copied to backend-appropriate dir under `<sessionDir>`. Mapping lives in each backend's `manifest.ts` (`installConventions`); resolved via `getInstallConventions(backendType)`:
- Claude: `<sessionDir>/.claude/skills/<installName>/` + `CLAUDE.md`
- Codex: `<sessionDir>/.agents/skills/<installName>/` + `AGENTS.md`
- Kimi: `<sessionDir>/.kimi/skills/<installName>/` + `AGENTS.md` (kimi reads `AGENTS.md` + `.kimi/AGENTS.md` per `kimi_cli/soul/agent.py:88-132`; does NOT read `CLAUDE.md`)

Template params (`{{key}}`, `{{viewerCapabilities}}`) applied. Instructions file assembled from marker blocks:
- `<!-- pneuma:start/end -->` — Mode skill prompt (description, architecture, core rules)
- `<!-- pneuma:viewer-api:start/end -->` — Viewer API (context, actions, scaffold, locator cards, native APIs)
- `<!-- pneuma:preferences:start/end -->` — Personal critical constraints
- `<!-- pneuma:project:start/end -->` — *project only*; manifest summary + project critical constraints
- `<!-- pneuma:project-atlas:start/end -->` — *project only*; **pointer** (path + mtime + size) to `<projectRoot>/.pneuma/project-atlas.md` maintained by `project-evolve`. Only when atlas exists. Pointer-not-inline keeps prompt lean; `pneuma-project` skill instructs Read at session start
- `<!-- pneuma:handoff:start/end -->` — *project only*; pending handoff messages (path + intent + suggested files; agent reads then `rm`s)

Optional blocks injected elsewhere:
- `<!-- pneuma:evolved:start/end -->` — Learned preferences summary (inside `pneuma:start/end`, written by evolution)
- `<!-- pneuma:resumed:start/end -->` — Resume/replay context

Mode version → `skill-version.json`. On resume: launcher checks installed vs current; if different and not dismissed → inline "Skill update: X → Y" with Update/Skip. Skip records dismissed version. `--skip-skill` skips install entirely.

## Project Lifecycle (3.0)

A project is a user directory marked by `<root>/.pneuma/project.json`. Multiple sessions in different modes share `<root>/.pneuma/preferences/` and coordinate via Smart Handoff (the `pneuma handoff` CLI invoked after a `<pneuma:request-handoff>` chat tag).

### Project Structure

```
<project>/
├── .pneuma/
│   ├── project.json                 # ProjectManifest
│   ├── preferences/                 # Project-scoped (profile.md, mode-{name}.md)
│   └── sessions/<sessionId>/        # Per-session state (session.json, history.json, .claude/, CLAUDE.md, etc.)
└── <user content>                   # deliverables — agent writes here
```

(Handoffs flow through `pneuma handoff` + in-memory proposal map — see Cross-Mode Handoff Protocol.)

### Detection

`core/project-loader.detectWorkspaceKind(workspace)` returns `"project"` iff `<workspace>/.pneuma/project.json` exists; otherwise quick session. `--project <path>` forces project mode and selects/creates a session id.

### Fresh-project onboarding (`project-onboard`)

User opens project URL (`?project=<root>`) with no sessions and no `onboardedAt` → `EmptyShell` auto-launches hidden `project-onboard`. Agent mines directory (README, package manifest, visuals) and writes one `proposal.json` to `<sessionDir>/onboard/`. Discovery Report viewer renders hero + anchors + open questions + two task cards. `POST /api/projects/onboard/apply` lands writes — `project.json` (with `onboardedAt`), `project-atlas.md`, `cover.{png,jpg,jpeg,webp,svg}` (extension preserved). Clicking a task card mints target session, stages `inbound-handoff.json`, spawns target mode in one round-trip. Auto-trigger gate is one-shot per project; re-run via **Re-discover** in `ProjectPanel`.

### Environment Variables

Every session: `PNEUMA_SESSION_DIR` (agent CWD; where `.claude/skills/`, `CLAUDE.md`, state files live), `PNEUMA_HOME_ROOT` (project root for project sessions, workspace for quick), `PNEUMA_SESSION_ID`.

Project sessions also: `PNEUMA_PROJECT_ROOT`.

### Cross-Mode Handoff Protocol

Source agent invokes `pneuma handoff --json '{...}'` (CLI wired via `PNEUMA_SERVER_URL`). CLI POSTs to `/api/handoffs/emit`; server stores in in-memory `Map<handoff_id, HandoffProposal>` (30-min TTL) and broadcasts `handoff_proposed` over WS to source browser. HandoffCard renders intent, summary, files, decisions, open questions. On confirm: server writes `<targetSessionDir>/.pneuma/inbound-handoff.json` atomically, kills source backend (best-effort), records `switched_out`/`switched_in`, spawns target. Target skill installer reads `inbound-handoff.json` into `pneuma:handoff` block; agent reads + `rm`s on first turn. On cancel: server dispatches `<pneuma:handoff-cancelled reason="..." />` synthetic user message back to source. See `server/handoff-routes.ts` and `docs/design/2026-04-28-handoff-tool-call.md`.

See `docs/design/2026-04-27-pneuma-projects-design.md` for full design and `docs/reference/viewer-agent-protocol.md` for env-var + frontmatter tables.

## Agent Command Distribution (3.10.0)

`/handoff-pneuma` is a user-level slash command Pneuma ships into other code agents (Claude Code, Codex) so they can hand work off to Pneuma without the user ever opening the launcher. The agent in CC/Codex runs `/handoff-pneuma "make a finance dashboard"`, picks a mode, and Pneuma spins up a session in the current shell directory with the intent already staged.

### Install paths

| Backend | File installed | Slash invocation |
|---|---|---|
| Claude Code | `~/.claude/commands/handoff-pneuma.md` | `/handoff-pneuma <intent>` |
| Codex | `~/.codex/prompts/handoff-pneuma.md` | `/handoff-pneuma <intent>` (Codex CLI ≥ slash-commands era) |

Source template: `templates/agent-commands/handoff-pneuma.md`. The marker comment `<!-- pneuma:agent-command version="X" backend="..." -->` (under the YAML frontmatter — line 1 stays as `---` so frontmatter parsers don't break) identifies files we own; absence of the marker is treated as user-authored and never overwritten without `--force`. Per-install state in `~/.pneuma/agent-commands.json` (`{ version, promptDismissed, autoUpdate, installed: { [backend]: { version, path, installedAt } } }`).

### Two paths from agent → Pneuma

The slash template makes the agent try in order:

1. **CLI path** — `command -v pneuma` succeeds → `pneuma handoff-from-external --intent ... --mode ... [--init-project] --source-agent {{sourceAgent}}`. The CLI validates the mode, optionally writes `<cwd>/.pneuma/project.json`, mints a session id, stages `inbound-handoff.json` under `<sessionDir>/.pneuma/`, picks a free port via `node:net listen 0`, spawns `pneuma <mode> --no-prompt --project <cwd> --session-id <id> --port <p>` detached, and prints the URL.
2. **URL-scheme path** — CLI missing, macOS desktop app installed → agent emits `open "pneuma://handoff?intent=...&mode=...&cwd=...&init-project=0|1&source-agent=..."`. Electron's `handlePneumaUrl` (`desktop/src/main/index.ts`) handles the `handoff` case: it POSTs the same body to `<launcherUrl>/api/handoffs/external` and opens a new mode window pointing at the spawned session.

Both paths terminate in the same launcher Bun route, which wraps `runHandoffFromExternal` (`bin/handoff-from-external-cli.ts`) — single source of truth for staging + spawn.

### Inbound payload

Same schema as Smart Handoff (`InboundHandoffPayload` in `server/skill-installer.ts`). External handoffs set `source_session_id = "external:<sourceAgent>"`, `source_mode = "external"`. The skill installer reads the file into the `<!-- pneuma:handoff:start/end -->` block; the target agent reads + `rm`s on its first turn.

### Lifecycle

- **First-launch prompt**: `<AgentCommandBanner />` in the launcher renders when `promptDismissed=false && installed is empty`. Per-backend checkboxes + Install/Skip.
- **Settings**: `<AgentCommandSettings />` (reached from `AppSettings` popover → "Manage agent commands…") — per-backend status, install/update/uninstall, auto-update toggle, CLI presence + one-click symlink to `~/.local/bin/pneuma-skills` (with shell-rc hint when that dir isn't on PATH).
- **Auto-update**: `bootstrapAgentCommandAutoUpdate` runs on launcher boot. Silently re-stamps installed files whose `fileVersion !== currentPneumaVersion` (when `autoUpdate: true`, the default). Skips conflict (= non-marker file at the same path).

### Routes (launcher-scope)

`server/agent-command-routes.ts`:
- `GET /api/agent-commands` — full status JSON
- `POST /api/agent-commands/:backend/(install|uninstall)` — body `{ force?: boolean }`; returns refreshed state
- `POST /api/agent-commands/dismiss-prompt`, `POST /api/agent-commands/auto-update` — flag toggles
- `POST /api/handoffs/external` — body `{ intent, mode, cwd?, initProject?, sourceAgent?, displayName?, dryRun? }`; returns `{ ok, url, sessionId, inboundFile, pid, ... }`
- `GET /api/cli/status` — `pneuma` on PATH? bundled entry? default symlink state? shell-rc hint?
- `POST /api/cli/symlink` — create symlink at `~/.local/bin/pneuma-skills` (or supplied `target`), pointing at `PNEUMA_CLI_ENTRY` / `process.argv[1]`

### URL scheme (Electron)

Already-existing `pneuma://` scheme (`app.setAsDefaultProtocolClient('pneuma')`). Cases: `open`, `import`, `mode`, plus new `handoff`. Cold-start path: `open-url` fires before `app.whenReady()` → queue into `pendingPneumaUrl` → process after launcher Bun spawns. Cross-platform: Windows/Linux receive the URL as an `argv` entry on `second-instance`; we match `pneuma://` prefix.

## Launcher

Starts when no mode arg given (`bun run dev` / `pneuma`). Marketplace UI: Recent Sessions, Recent Projects, Built-in Modes, Local Modes, Published Modes, Backend Picker. See `server/index.ts` launcher block and `src/components/Launcher.tsx`.

## Server Routes

Defined in `server/index.ts` (main), `server/routes/export.ts`, `server/evolution-routes.ts`, `server/mode-maker-routes.ts`, `server/library-routes.ts` + `server/agent-command-routes.ts` (launcher-scope). WebSocket: `/ws/browser/:sessionId` (JSON), `/ws/cli/:sessionId` (NDJSON), `/ws/terminal/:terminalId` (binary). Codex uses stdio, not WebSocket.

Key endpoints:
- `GET /api/file?path=<abs>` — workspace-contained file reads (chat image previews)
- `GET /api/running` — all running sessions system-wide; each entry carries current mode + optional `thumbnailUrl`
- `POST /api/session/thumbnail` — base64 PNG → `<stateDir>/thumbnail.png`
- `GET/POST /api/favorites` — pinned-modes list
- `GET /api/github/status` — `{ installed, authenticated, username?, version?, hint? }` from `gh` probe (Launcher Settings → GitHub card)
- `/api/libraries/*` (launcher-only): `GET`, `link`, `init`, `:id/sync`, `:id/mode/:name/(activate|deactivate|accept-update)`, `:id/publish`, `:id/push`, `DELETE :id`. Broadcasts `libraries_updated` over WS on every mutation; invalidates `/api/registry` SWR cache so library-activated modes appear in Quick Start without lag
- `/api/agent-commands/*` (launcher-only): `GET`, `:backend/install`, `:backend/uninstall`, `dismiss-prompt`, `auto-update`. Manages `/handoff-pneuma` installation. See **Agent Command Distribution** above
- `POST /api/handoffs/external` (launcher-only): server-side wrapper around `runHandoffFromExternal` — used by Electron's `pneuma://handoff` URL scheme handler so desktop users don't need the CLI on PATH
- `/api/cli/*` (launcher-only): `GET status` (detect pneuma on PATH + bundled entry), `POST symlink` (create `~/.local/bin/pneuma-skills` → bundled CLI). Driven by `PNEUMA_CLI_ENTRY` env var when set by the Electron host

Native desktop APIs (`/api/native/*`) only in Electron: Server → WS `native_request` → Browser → Electron IPC → result → WS `native_result` → Server. Web returns `{ available: false }`.

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: contract changes → update `core/types/` + `core/__tests__/`
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Backend selected at startup only** — no runtime backend switching in session UI
- **Zustand** sliced store (`src/store/`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`)
- **English only** in source code — comments, JSDoc, identifiers, commit messages, docs in `core/`, `server/`, `src/`, `backends/`, `bin/`. Chinese allowed only in mode seed templates (`zh-light/`, `zh-dark/`), showcase content, `docs/` archive
- **Visual verification for frontend changes**: After modifying viewer components, CSS, or any UI-facing code, use `chrome-devtools-mcp` to screenshot the running dev server and verify before reporting completion. Do not judge visual correctness by reading code alone

## Release Process

CI (`release.yml`) handles tagging, GitHub Release, and npm publish on push to `main`. **Do NOT manually create or push git tags.**

### Version Bump Checklist (same commit)
1. `package.json` — `"version"`
2. `desktop/package.json` — `"version"`, **must equal** `package.json`'s value. `electron-updater` reads this when comparing the running app to the latest release; pre-3.10.0 it drifted (desktop sat at 2.x while npm advanced), so users on those builds never saw the update prompt. From 3.10.3 onward the two are unified — bumping only one is a bug.
3. `CLAUDE.md` — `**Version:**` line
4. `CHANGELOG.md` — new section

Then `git push origin main` (no `--tags`). CI creates tag, release, publishes.

## Known Gotchas

- **`pneuma handoff-from-external` detached spawn**: Always pass `--no-prompt` to the child. With `stdio: "ignore"` and `detached: true`, the child has no stdin; mode `init.params` prompts (e.g. webcraft's fal.ai key) would block forever. `--no-prompt` makes the launcher use defaults silently.
- **Machine-readable CLI subcommands bypass `p.intro()`**: `agent-command`, `mode list --local`, and `handoff-from-external` are dispatched in `bin/pneuma.ts:main()` BEFORE the clack `p.intro(...)` banner runs. Otherwise the banner pollutes stdout and breaks `JSON.parse` on the agent side. Any future subcommand whose stdout the agent parses must do the same.
- **Agent-command marker placement**: The `<!-- pneuma:agent-command version="..." backend="..." -->` marker sits BELOW the YAML frontmatter (`---`), not at line 1. Both Claude Code and Codex require frontmatter to start on line 1; a line-1 HTML comment breaks `description` / `argument-hint` parsing. The installer scans the full file (not just line 1) for the marker.
- **Bun's `os.homedir()` is process-start-cached**: Setting `process.env.HOME` after boot does NOT change what `homedir()` returns. Modules whose tests need a tmp home (`core/agent-command-installer.ts`) read `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` instead. The `library-registry.ts::getLibrariesDir` uses `homedir()` directly — accept that local-mode tests may pick up real `~/.pneuma/libraries/` entries.
- **chokidar glob**: Watch directory path, filter in callback. Don't use `watch("**/*.md", { cwd })`.
- **react-resizable-panels v4.6**: `Group` not `PanelGroup`, `Separator` not `PanelResizeHandle`, `orientation` not `direction`.
- **Vite WS proxy + Bun.serve**: Browser WS connects directly to backend port, bypassing Vite.
- **Stale `dist/`**: If `dist/index.html` exists, server falls back to production mode. Delete `dist/` or pass `--dev`. Launcher-spawned children auto-inherit `--dev`.
- **Bun.serve dual-stack**: Must set `hostname: "0.0.0.0"` to avoid IPv6/IPv4 port collision on macOS.
- **Backend persistence**: `backendType` in `.pneuma/session.json` and `~/.pneuma/sessions.json` is part of resume identity.
- **Empty assistant messages**: `MessageBubble` returns null when content is empty (tool_use-only messages).
- **modelUsage cumulative**: Use delta (current - previous) for per-turn cost.
- **`backdrop-filter` containing block**: Creates a containing block for fixed-positioned children, causing coordinate offset in Excalidraw. Avoid or account for it.
- **`@zumer/snapdom`**: Capture iframes must be `display: none` during snapdom calls — visible iframes cause foreignObject text reflow. See `useSlideThumbnails.ts` and `export.ts`.
- **Session thumbnail capture** (`src/hooks/useThumbnailCapture.ts`): priority is viewer `captureViewport()` → Electron `pneumaDesktop.capturePage(rect)` (real window screenshot — only path that sees iframe content, e.g. webcraft/mode-maker Play) → snapdom fallback (browser dev only; no iframe contents). Waits for finite CSS animations to settle; fires on escalating timers after mount + debounce after file changes; near-uniform (blank) frames dropped. Blank Electron capture is *not* backfilled with snapdom (snapdom renders iframe as white rect — worse than mode-icon fallback). Web dev: webcraft etc. simply won't get a real thumbnail.
- **GridBoard JSX tag limitation**: Tile compiler (Babel + eval) cannot resolve locally-defined components as JSX tags. Use `{renderMyComponent(...)}` calls instead.
- **Shadow-git checkpoint queue**: All checkpoint ops serialized via Promise chain to prevent `index.lock` conflicts. Do not parallelize.
- **Claude Code backend**: see `backends/claude-code/README.md` for NDJSON termination, `CLAUDECODE` env, `system.init`-after-first-prompt.
- **Codex backend**: see `backends/codex/README.md` for protocol details, `node:child_process` rationale, adapter quirks, codex-cli 0.128+ approval-policy variant.
- **Kimi-cli backend**: see `backends/kimi-cli/README.md` for pre-allocated UUID, synthesised envelopes, `<system>` markers, k2.6 model bugs.
- **Replay**: (1) `--replay` defers agent launch until `/api/replay/continue`; server holds `replayContinueCallback`. (2) Each checkout cleans `.pneuma/replay-checkout/` before extracting; Continue Work extracts final checkpoint to workspace root. (3) File navigation must run AFTER checkpoint loads (not during `displayMessage`), because content sets aren't computed until `setFiles` completes.
- **Proxy**: (1) `proxy.json` hot-reloaded via chokidar. (2) Default allowed method is GET only — POST/PUT/PATCH require explicit `"methods"`. (3) Bun's `fetch()` auto-decompresses gzip/br; proxy strips `content-encoding` to prevent double-decompression.
- **Editing/readonly distinction**: `editing` is a session boolean (`true` = creating, `false` = consuming). Modes opt in via `editing: { supported: true }`. When `false`: no agent runs; switching to `true` triggers skill install + agent spawn; switching back kills the agent. `readonly` (replay) disables ALL interactions; `editing: false` only hides Pneuma editing UI — content-internal interactions remain.
- **Windows compatibility**: Cross-platform in `path-resolver.ts` (`where` vs `which`, PATH from `LOCALAPPDATA`/`APPDATA`), `terminal-manager.ts` (`COMSPEC`/`cmd.exe`), `system-bridge.ts` (`cmd /c start`), `server/index.ts` (`NUL`, `taskkill`). Path comparison case-insensitive on win32.
- **Native bridge timeout**: Routes through browser WS — if no browser tab connected, native calls timeout after 10s.
- **Diagram viewer**: See `modes/diagram/viewer/DiagramPreview.tsx` header for architecture and gotchas (native events, SVG pointer-events, sketch injection, rough.js load order).
- **Handoff confirm cannot kill its own session**: `killActiveSession(sourceSessionId)` runs in the source's own server, but the source process was spawned by launcher/directly, not by itself — source backend keeps running. `switched_out` event still recorded; target launches normally. *Mitigation (3.5.3):* a desktop mode-window tracks every URL it navigates through and on close tears down all session servers it hosted (matched by port via `/api/running` — covers sessions spawned by other servers); `/api/processes/children/:pid/kill` escalates SIGTERM→SIGKILL so wedged sessions can't become un-closable.
- **Project session state pollution if `--project` dropped**: subcommands not parsing `--project` would write into project root and conflict with the project layer. All built-in subcommands (including `evolve`) respect `--project`; external mode authors must mirror this.
- **Empty shell renders without `modeViewer`**: `?project=<root>` (no `session`, no `mode`) → `EmptyShell` mounts `TopBar` without a session. `TopBar` gates tabs row, share dropdown, editing toggle on `!!modeViewer`; left chip strip stays. Any new TopBar feature must guard for `modeViewer` being null. `ProjectChip` lives in the strip and reads `projectContext` (populated by `EmptyShell` from `/api/projects/:id/sessions`); chip auto-open computed inside the chip via URL inspection (no prop threading).
- **TopBar drag region in launcher-reused windows**: `TopBar` is `WebkitAppRegion: "drag"`; three pill sub-containers (left chip strip, center tabs, right share/edit) are `no-drag`. Required because launcher's `window.location.href` flow reuses the launcher `BrowserWindow` for sessions — window keeps `titleBarStyle: "hiddenInset"` + `trafficLightPosition: { y: 18 }`, and on macOS Sequoia the OS-managed drag inset extends to ~y=56 to fit the lowered traffic lights, eating clicks on the upper edge of TopBar pills. Any new clickable element directly under TopBar root must carry `no-drag` (or sit inside an existing `no-drag` sub-container); pure spacers can stay at inherited `drag`.
- **Project session id vs backend id**: for project sessions, `<projectRoot>/.pneuma/sessions/<id>/session.json` top-level `sessionId` is the *project session* id (= directory name = `--session-id` from URL). Backend protocol id is `agentSessionId`. `scanProjectSessions` falls back to directory name if `sessionId` missing/empty (defensive against pre-fix sessions). Reopening uses project session id; CLI ↔ backend routing uses `agentSessionId`. **Never** let backend id leak into registry/panel.
- **Launcher has no agent session, so WS broadcasts don't reach it (3.7.0)**: `WsBridge.broadcastAll` iterates per-session browser sockets; launcher main page mounts before any session exists. Library-routes (and any future launcher-scope mutation) must dispatch `pneuma:libraries-updated` (or equivalent) DOM events locally; launcher's window-event listener fans out to `refreshLibraries()` + `refreshModes()`. Sibling tab inside a real session still gets WS-driven refresh — two paths converge on the same event name.
- **`line-clamp` requires `display: -webkit-box`**, which Tailwind's `block` utility overrides in source order (3.7.0): pairing `block` with `line-clamp-N` silently disables clamp. `QuickStartTile` hit this with Guizang Ppt's marathon description (~10 lines vs neighbors' 2). Drop `block`; line-clamp's own display rule is enough.
- **React key collision for same-named modes (3.7.0)**: a builtin (`slide`) evolved locally into `slide-evolved-*` typically keeps `name: "slide"`. Using `mode.name` as React key collides across `builtins[]` + `local[]` and makes per-tile state (favorite badge, library origin glyph) render onto only one tile. Compose key from `${source}::${path || name}` for any list mixing builtin + local modes.
