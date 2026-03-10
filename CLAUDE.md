# Pneuma Skills

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. It provides four pillars for isomorphic collaboration: a **visual environment** (live bidirectional workspace), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction and skill augmentation), and **distribution** (mode marketplace, publishing, sharing). Built atop mainstream code agents (currently Claude Code via `--sdk-url`), Pneuma doesn't replace your agent — it gives both of you a shared workspace to think in.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 2.3.9
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `mode-maker`, `evolve`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun >= 1.3.5 |
| Server | Hono 4.7 |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 + Zustand 5 |
| Terminal | xterm.js 6 + Bun native PTY |
| File Watching | chokidar 4 |
| Drawing | @excalidraw/excalidraw 0.18 |
| Desktop | Electron 35 + electron-builder + electron-updater |
| Agent | Claude Code CLI via `--sdk-url` WebSocket protocol |

## CLI Commands

```bash
# Development
bun run dev              # Launcher UI (no mode arg)
bun run dev doc          # Doc Mode (cwd as workspace)
bun run dev slide        # Slide Mode
bun run dev doc --workspace ~/notes --port 17996 --no-open --debug
bun run build            # Vite production build
bun test                 # All tests (bun:test)

# Skill evolution
pneuma evolve <mode>     # Launch evolution agent for a mode's skill

# Mode management
pneuma mode add <url>    # Install remote mode to ~/.pneuma/modes/
pneuma mode list         # List published modes on R2
pneuma mode publish      # Publish current workspace as mode

# Snapshot
pneuma snapshot push     # Upload workspace to R2
pneuma snapshot pull     # Download workspace from R2
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace <path>` | Workspace directory (default: cwd) |
| `--port <n>` | Server port (default: auto) |
| `--no-open` | Don't open browser |
| `--no-prompt` | Non-interactive mode (launcher uses this) |
| `--skip-skill` | Skip skill installation (session resume without update) |
| `--debug` | Enable debug mode |
| `--dev` | Force dev mode (Vite) |

## Ports

- **17996** — Vite dev server / production server
- **17007** — Hono backend (dev mode only, Vite proxies to it)
- Dev: browser → 17996 (Vite HMR), WebSocket → 17007 directly (Vite WS proxy broken with Bun)
- Both servers bind `hostname: "0.0.0.0"` to avoid IPv4/IPv6 dual-stack port collision

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry — mode resolution, agent launch, session registry
├── core/
│   ├── types/                 # Contract types (ModeManifest, ViewerContract, AgentBackend)
│   ├── mode-loader.ts         # Mode discovery & loading (builtin + external)
│   ├── mode-resolver.ts       # Source resolution (builtin/local/github/url → disk path)
│   └── utils/manifest-parser.ts  # Regex-based manifest.ts metadata extraction
├── modes/{webcraft,doc,slide,draw,mode-maker,evolve}/  # Builtin modes
├── backends/claude-code/      # AgentBackend impl — Bun.spawn with --sdk-url
├── server/
│   ├── index.ts               # Hono server + launcher endpoints + WS routing
│   ├── ws-bridge*.ts          # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON)
│   ├── skill-installer.ts     # Skill copy + template engine + CLAUDE.md injection
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven)
│   ├── terminal-manager.ts    # PTY terminal sessions
│   ├── path-resolver.ts       # Binary PATH resolution (cross-platform)
│   ├── system-bridge.ts       # OS-level operations (open, reveal, openUrl)
│   ├── mode-maker-routes.ts   # Mode Maker API routes (fork, play, publish, reset)
│   ├── evolution-agent.ts     # Evolution Agent launcher (spawns CC with analysis tools)
│   ├── evolution-proposal.ts  # Proposal CRUD + apply/rollback + CLAUDE.md sync
│   └── evolution-routes.ts    # Evolution API routes (/api/evolve/*)
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout, dynamic viewer loading
│   ├── store.ts               # Zustand store
│   ├── ws.ts                  # WebSocket client
│   └── components/
│       ├── Launcher.tsx       # Mode marketplace + recent sessions + local modes
│       ├── ChatPanel.tsx      # Chat feed with streaming
│       ├── ChatInput.tsx      # Message composer + image upload
│       ├── PermissionBanner.tsx  # Tool permissions + AskUserQuestion UI
│       ├── ContextPanel.tsx   # Session stats, tasks, MCP, git
│       └── ...                # TopBar, ToolBlock, Terminal, Diff, Editor panels
├── desktop/                   # Electron desktop client
│   ├── src/main/              # Main process (tray, windows, Bun spawner, Claude detector)
│   ├── src/preload/           # contextBridge for renderer
│   ├── scripts/               # Build scripts (download-bun.mjs)
│   └── electron-builder.yml   # Packaging config (mac/win/linux)
├── snapshot/                  # R2 push/pull for workspace snapshots + mode publishing
│   └── mode-publish.ts        # Mode package publishing to R2 registry
└── docs/                      # Architecture docs + ADRs
```

## Architecture

```
Layer 4: Mode Protocol     — ModeManifest (skill + viewer + agent config)
Layer 3: Content Viewer    — ViewerContract (render, select, agent-callable actions)
Layer 2: Agent Bridge      — AgentBackend (launch, resume, kill)
Layer 1: Runtime Shell     — WS Bridge, HTTP, File Watcher, Session, Frontend
```

### Core Contracts

| Contract | File | Purpose |
|----------|------|---------|
| **ModeManifest** | `core/types/mode-manifest.ts` | Skill, viewer config, agent preferences, init params, evolution |
| **ViewerContract** | `core/types/viewer-contract.ts` | Preview component, context extraction, workspace model |
| **AgentBackend** | `core/types/agent-backend.ts` | Launch, resume, kill, capabilities |
| **EvolutionConfig** | `core/types/mode-manifest.ts` | Evolution directive, tools (part of ModeManifest) |

### Communication

- Dual WebSocket: Browser (`/ws/browser/:sessionId`, JSON) ↔ Server ↔ CLI (`/ws/cli/:sessionId`, NDJSON)
- File changes: chokidar → WebSocket push to browser
- CLI: `claude --sdk-url ws://... --print --output-format stream-json --input-format stream-json --verbose -p ""`

## Mode Lifecycle

End-to-end flow from CLI entry to preview loop:

```
CLI Entry (bin/pneuma.ts)
  │
  ├─ No mode arg → Launcher Mode (marketplace UI)
  │   ├─ /api/registry → builtins + published + local
  │   ├─ /api/sessions → recent sessions
  │   └─ /api/launch → spawn child pneuma process
  │
  └─ Mode arg → Normal Mode
      │
      ├─ 1. Resolve: mode-resolver.ts
      │   builtin | local path | github:user/repo | https://...tar.gz
      │   → disk path with manifest.ts
      │
      ├─ 2. Load manifest: loadModeManifest()
      │   → ModeManifest (skill, viewer, agent config, init params)
      │
      ├─ 3. Session: load or create .pneuma/session.json
      │   → sessionId, agentSessionId
      │
      ├─ 4. Skill install: skill-installer.ts
      │   modes/<mode>/skill/ → workspace/.claude/skills/<installName>/
      │   Template: {{key}}, {{viewerCapabilities}}
      │   CLAUDE.md injection: <!-- pneuma:start/end -->
      │
      ├─ 5. Server start: server/index.ts
      │   Hono HTTP + dual WebSocket (browser JSON / CLI NDJSON)
      │
      ├─ 6. Agent launch: backends/claude-code/cli-launcher.ts
      │   claude --sdk-url ws://localhost:PORT/ws/cli/SESSION
      │
      ├─ 7. Frontend: mode-loader.ts → dynamic import viewer
      │   External modes: registerExternalMode() → Bun.build() → import map
      │
      └─ 8. Preview loop
          Agent edits → chokidar → WS → browser → viewer render
          User selects → <viewer-context> → agent message
          User actions → viewer notification → agent
```

## Mode System

### Mode Sources

Modes can come from four sources, resolved by `core/mode-resolver.ts`:

| Type | Specifier | Resolved Path |
|------|-----------|---------------|
| **builtin** | `doc`, `slide`, `draw`, `mode-maker`, `evolve` | `modes/<name>/` |
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

Global session history for the launcher "Recent Sessions" feature:

- **File:** `~/.pneuma/sessions.json`
- **Record:** `{ id: "${workspace}::${mode}", mode, displayName, workspace, lastAccessed }`
- Upserted on every mode launch, capped at 50 entries
- Launcher shows recent sessions with one-click resume (no dialog)

### Per-Workspace Persistence

Stored in `<workspace>/.pneuma/`:

| File | Purpose |
|------|---------|
| `session.json` | sessionId, agentSessionId, mode, createdAt |
| `history.json` | Message history (auto-saved every 5s) |
| `config.json` | Init params (e.g. slideWidth, API keys) |
| `skill-version.json` | `{ mode, version }` — installed skill version for update detection |
| `skill-dismissed.json` | `{ version }` — dismissed skill update version |
| `evolution/` | Evolution proposals, backups, and CLAUDE.md snapshots |

### Skill Installation & Update Detection

On startup, skills are copied from `modes/<mode>/skill/` to `<workspace>/.claude/skills/<installName>/`. Template params (`{{key}}`, `{{viewerCapabilities}}`) are applied. Two sections are injected into CLAUDE.md:
- `<!-- pneuma:start -->` / `<!-- pneuma:end -->` — Skill prompt
- `<!-- pneuma:viewer-api:start -->` / `<!-- pneuma:viewer-api:end -->` — Viewer API description

A third optional section is injected by the evolution system:
- `<!-- pneuma:evolved:start -->` / `<!-- pneuma:evolved:end -->` — Learned preferences summary (inside pneuma:start/end block)

After install, the mode version is written to `skill-version.json`. On session resume:
1. Launcher checks installed version vs current mode version
2. If different and not dismissed → inline "Skill update: X → Y" prompt with Update/Skip
3. Skip records the dismissed version; same version won't prompt again
4. `--skip-skill` flag skips skill installation entirely (used for dismissed updates)

## Launcher

The launcher starts when no mode arg is given (`bun run dev` / `pneuma`). It serves a marketplace UI.

### Launcher API Endpoints (server/index.ts, `launcherMode` block)

| Endpoint | Description |
|----------|-------------|
| `GET /api/registry` | Returns `{ builtins, published, local }` |
| `GET /api/sessions` | Returns `{ sessions, homeDir }` — filtered by existing workspace |
| `DELETE /api/sessions/:id` | Remove a session record |
| `DELETE /api/modes/:name` | Delete a local mode from `~/.pneuma/modes/` |
| `POST /api/launch/prepare` | Resolve mode, return initParams |
| `POST /api/launch/skill-check` | Compare installed vs current skill version |
| `POST /api/launch/skill-dismiss` | Record dismissed version |
| `POST /api/launch` | Spawn child `pneuma` process, wait for ready URL |

### Launcher UI Sections (Launcher.tsx)

1. **Recent Sessions** — one-click resume, inline delete, skill update prompt
2. **Built-in Modes** — doc, slide, draw
3. **Local Modes** — scanned from `~/.pneuma/modes/`, with delete
4. **Published Modes** — fetched from R2 registry

## Server API Reference

### Session & Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/session` | Current active session ID |
| GET | `/api/config` | Mode init params |
| GET | `/api/mode-info` | External mode info |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List files in workspace |
| POST | `/api/files` | Save file |
| GET | `/api/files/read` | Read single file |
| GET | `/api/files/tree` | File tree structure |

### Git

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/git/available` | Check if in git repo |
| GET | `/api/git/info` | Branch info and counts |
| GET | `/api/git/changed-files` | Changed files list |
| GET | `/api/git/diff` | File diff vs HEAD/branch |
| GET | `/api/git/status` | Git status --porcelain |

### Workspace & Viewer

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspace/scaffold` | Write/clear workspace files |
| POST | `/api/viewer/action` | Dispatch viewer action |

### System

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/system/open` | Open file/directory |
| POST | `/api/system/open-url` | Open URL in browser |
| POST | `/api/system/reveal` | Reveal file in file manager |

### Processes & Terminal

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes/system` | List dev processes with ports |
| POST | `/api/processes/:taskId/kill` | Kill process by task ID |
| POST | `/api/processes/system/:pid/kill` | Kill process by PID |
| GET | `/api/processes/children` | List child processes spawned by launcher |
| POST | `/api/processes/children/:pid/kill` | Kill a launcher child process by PID |
| POST | `/api/terminal/spawn` | Spawn PTY terminal |
| GET | `/api/terminal` | Get terminal info |
| POST | `/api/terminal/kill` | Kill terminal |

### Content & Assets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/content/*` | Serve workspace files |
| GET | `/mode-assets/*` | Compiled mode bundle (production) |
| GET | `/vendor/*` | React shims for external modes (react.js, react-dom.js, jsx-runtime) |

### Export (Slide Mode)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/export/slides` | Slide export HTML |
| GET | `/export/slides/download` | Download slides as HTML file |

### WebSocket

| Path | Protocol | Description |
|------|----------|-------------|
| `/ws/browser/:sessionId` | JSON | Browser ↔ server |
| `/ws/cli/:sessionId` | NDJSON | CLI ↔ server |
| `/ws/terminal/:terminalId` | binary | PTY terminal |

### Evolution API (when mode = evolve)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/evolve/proposals` | List all evolution proposals |
| GET | `/api/evolve/proposals/latest` | Most recent proposal |
| GET | `/api/evolve/proposals/:id` | Specific proposal by ID |
| POST | `/api/evolve/apply/:id` | Apply a pending proposal to skill files |
| POST | `/api/evolve/rollback/:id` | Rollback an applied proposal |
| POST | `/api/evolve/discard/:id` | Discard a pending proposal |
| POST | `/api/evolve/fork/:id` | Fork proposal into a new custom mode |

### Mode Maker API (when mode = mode-maker)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mode-maker/modes` | List builtin modes for forking |
| POST | `/api/mode-maker/fork` | Fork a builtin mode into workspace |
| POST | `/api/mode-maker/play` | Start test instance of mode |
| POST | `/api/mode-maker/play/stop` | Stop running test instance |
| GET | `/api/mode-maker/play/status` | Check if play instance is running |
| POST | `/api/mode-maker/publish` | Publish mode package to R2 |
| POST | `/api/mode-maker/reset` | Clear workspace and re-seed templates |

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: changes to contracts → update `core/types/` + `core/__tests__/`
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Zustand** single store (`src/store.ts`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`)

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

- **chokidar v4 glob broken**: Watch directory path, filter in callback. Don't use `watch("**/*.md", { cwd })`.
- **react-resizable-panels v4.6**: `Group` not `PanelGroup`, `Separator` not `PanelResizeHandle`, `orientation` not `direction`.
- **Vite WS proxy + Bun.serve**: Browser WS connects directly to backend port, bypassing Vite.
- **Stale `dist/`**: If `dist/index.html` exists, the server falls back to production mode. Launcher-spawned children auto-inherit `--dev` from the parent, but direct CLI usage without `--dev` may still hit this. Delete `dist/` or pass `--dev` explicitly.
- **Bun.serve dual-stack**: Must set `hostname: "0.0.0.0"` to avoid IPv6/IPv4 port collision on macOS.
- **CLAUDECODE env var**: Must be unset when spawning Claude Code CLI.
- **NDJSON**: Each message to CLI must end with `\n`.
- **Empty assistant messages**: `MessageBubble` returns null when content is empty (tool_use-only messages).
- **modelUsage cumulative**: Use delta (current - previous) for per-turn cost.
- **`backdrop-filter` containing block**: `backdrop-filter` creates a containing block for fixed-positioned children, causing coordinate offset in Excalidraw. Avoid or account for it.
- **`@zumer/snapdom`**: Used for slide thumbnail capture and export image mode. Renders DOM to canvas via snapshot cloning.
- **Windows compatibility**: Cross-platform support via:
  - `path-resolver.ts`: `where` instead of `which`, builds PATH from `LOCALAPPDATA`/`APPDATA`/`ProgramFiles`
  - `terminal-manager.ts`: `COMSPEC`/`cmd.exe` as shell, no `-l` flag
  - `system-bridge.ts`: `cmd /c start "" url` for browser opening, `explorer /select,` for revealing
  - `server/index.ts`: `NUL` for null device, `taskkill /F /PID` for process kill, lsof/ps gracefully return empty list
  - Path comparison is case-insensitive on win32

<!-- pneuma:viewer-api:start -->
## Viewer API

### Viewer Context

Each user message may be prefixed with a `<viewer-context>` block.
It describes what the user is currently seeing — the active file, viewport position, and selected elements.
Use this to resolve references like "this page", "here", "this section" in user messages.

### Workspace
- Type: all (multi-file)

<!-- pneuma:viewer-api:end -->
