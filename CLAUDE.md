# Pneuma Skills

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. It provides four pillars for isomorphic collaboration: a **visual environment** (live bidirectional workspace), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction and skill augmentation), and **distribution** (mode marketplace, publishing, sharing). The runtime supports multiple agent backends (Claude Code, Codex) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 2.26.0
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `illustrate`, `remotion`, `gridboard`, `mode-maker`, `evolve`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun >= 1.3.5 |
| Server | Hono 4.7 |
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 + Zustand 5 |
| Terminal | xterm.js 6 + Bun native PTY |
| File Watching | chokidar 5 |
| Drawing | @excalidraw/excalidraw 0.18 |
| Video | remotion 4.0 + @remotion/player + @remotion/web-renderer + @babel/standalone |
| Desktop | Electron 41 + electron-builder + electron-updater |
| Agent | Claude Code CLI via `--sdk-url`; Codex CLI via `app-server` stdio JSON-RPC (`node:child_process`) |

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

## Ports

- **17996** — default Vite dev server / production server
- **17007** — default Hono backend in dev mode
- Dev: browser → Vite, WebSocket → backend directly (`Vite` WS proxy is bypassed)
- Launcher child sessions auto-increment both ports when the defaults are occupied
- Both servers bind `hostname: "0.0.0.0"` to avoid IPv4/IPv6 dual-stack port collision

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry — mode resolution, agent launch, session registry
├── bin/pneuma-cli-helpers.ts  # Shared CLI helpers (startViteDev, etc.)
├── core/
│   ├── types/                 # Contract types (ModeManifest, ViewerContract, AgentBackend, SharedHistory)
│   ├── mode-loader.ts         # Mode discovery & loading (builtin + external)
│   ├── mode-resolver.ts       # Source resolution (builtin/local/github/url → disk path)
│   └── utils/manifest-parser.ts  # Regex-based manifest.ts metadata extraction
├── modes/{webcraft,doc,slide,draw,illustrate,remotion,gridboard,mode-maker,evolve}/  # Builtin modes
├── modes/_shared/skills/          # Global skills installed for all modes (e.g. pneuma-preferences)
├── backends/
│   ├── index.ts               # Backend registry + descriptors + capabilities + availability
│   ├── claude-code/           # Claude backend — Bun.spawn with --sdk-url
│   └── codex/                 # Codex backend — stdio JSON-RPC via node:child_process
├── server/
│   ├── index.ts               # Hono server + launcher endpoints + WS routing
│   ├── routes/export.ts       # Slide + webcraft + remotion export routes
│   ├── routes/deploy-ui.ts    # Shared deploy UI (CSS, HTML, JS) for export pages
│   ├── vercel.ts              # Vercel deploy: config, CLI detection, deploy (CLI + API)
│   ├── cloudflare-pages.ts    # CF Pages deploy: config, wrangler CLI, Direct Upload API
│   ├── utils.ts               # Shared server utilities (pathStartsWith, isWin)
│   ├── ws-bridge*.ts          # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON)
│   ├── skill-installer.ts     # Skill copy + template engine + instructions injection (CLAUDE.md / AGENTS.md)
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven)
│   ├── terminal-manager.ts    # PTY terminal sessions
│   ├── path-resolver.ts       # Binary PATH resolution (cross-platform)
│   ├── system-bridge.ts       # OS-level operations (open, reveal, openUrl)
│   ├── mode-maker-routes.ts   # Mode Maker API routes (fork, play, publish, reset)
│   ├── shadow-git.ts          # Shadow git init, checkpoint capture, bundle export
│   ├── history-export.ts      # Bundle messages + checkpoints into shareable .tar.gz
│   ├── history-import.ts      # Load and parse shared history packages
│   ├── history-summary.ts     # Mechanical session summary generation
│   ├── replay-continue.ts     # Prepare workspace for replay → normal transition
│   ├── share.ts               # R2 upload/download, API key management
│   ├── evolution-agent.ts     # Evolution Agent launcher (spawns CC with analysis tools)
│   ├── evolution-proposal.ts  # Proposal CRUD + apply/rollback + CLAUDE.md sync
│   └── evolution-routes.ts    # Evolution API routes (/api/evolve/*)
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout, dynamic viewer loading
│   ├── replay-engine.ts       # Replay playback engine (checkpoint switching, auto-navigate)
│   ├── store/                 # Zustand store (8 protocol-aligned slices)
│   │   ├── index.ts           # Combined store + re-export barrel
│   │   ├── session-slice.ts   # Connection, agent session lifecycle
│   │   ├── chat-slice.ts      # Messages, streaming, permissions
│   │   ├── workspace-slice.ts # Files, content sets, workspace items
│   │   ├── viewer-slice.ts    # Selection, annotations, navigation, actions
│   │   ├── mode-slice.ts      # Viewer config, commands, layout
│   │   ├── agent-data-slice.ts # Tasks, cron jobs, processes, git state
│   │   ├── ui-slice.ts        # Active tab, terminal, debug mode
│   │   └── replay-slice.ts   # Replay mode state, playback controls
│   ├── utils/api.ts           # Shared getApiBase() utility
│   ├── ws.ts                  # WebSocket client
│   └── components/
│       ├── Launcher.tsx       # Mode marketplace + recent sessions + local modes
│       ├── ChatPanel.tsx      # Chat feed with streaming
│       ├── ChatInput.tsx      # Message composer + image upload
│       ├── PermissionBanner.tsx  # Tool permissions + AskUserQuestion UI
│       ├── ContextPanel.tsx   # Session stats, tasks, MCP, git
│       ├── ReplayPlayer.tsx   # Replay controls bar (progress, speed, Continue Work)
│       ├── AppModeToggle.tsx  # Hover-reveal Edit button for viewing (app) layout
│       ├── AppSettings.tsx    # App settings popover (window size, resizable)
│       └── ...                # TopBar, ToolBlock, Terminal, Diff, Editor panels
├── desktop/                   # Electron desktop client
│   ├── src/main/              # Main process (tray, windows, Bun spawner, Claude detector)
│   ├── src/preload/           # contextBridge for renderer
│   ├── scripts/               # Build scripts (download-bun.mjs)
│   └── electron-builder.yml   # Packaging config (mac/win/linux)
├── web/                       # Landing page (static site, CF Pages deployment)
│   ├── index.html             # Single-page landing with OS-specific download
│   ├── styles.css             # Ethereal Tech themed styles
│   ├── script.js              # OS detection, download links, deep link handling
│   └── deploy.sh              # CF Pages publish script (.deploy.env gitignored)
├── snapshot/                  # R2 push/pull for workspace snapshots + mode publishing
│   ├── mode-publish.ts        # Mode package publishing to R2 registry
│   └── history-share.ts       # History package push/pull via R2
└── docs/                      # Supplementary documentation
    ├── design/                # Active design docs (current/next version)
    ├── reference/             # Stable technical references (maintained)
    ├── adr/                   # Architecture Decision Records (immutable)
    └── archive/               # Historical: proposals, work summaries, legacy
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

### Backend Abstraction

Current implementation separates backend concerns into two layers:

1. **Lifecycle layer** — `AgentBackend` starts, resumes, tracks, and kills agent processes.
2. **Session contract layer** — the browser and most of the server consume normalized session fields:
   - `backend_type`
   - `agent_capabilities`
   - `agent_version`

Backend-specific wire details live in `backends/<name>/` and `server/ws-bridge*.ts`. Frontend feature gating uses `agent_capabilities` instead of assuming backend behavior.

### Communication

- Browser WebSocket: `/ws/browser/:sessionId` (JSON) ↔ Server ↔ backend transport (Claude: `/ws/cli/:sessionId` NDJSON; Codex: stdio JSON-RPC)
- File changes: chokidar → WebSocket push to browser
- Claude transport: `claude --sdk-url ws://... --print --output-format stream-json --input-format stream-json --verbose -p ""`
- Codex transport: `codex app-server` via `node:child_process` stdio JSON-RPC (Bun.spawn avoided due to premature ReadableStream closure); `CodexAdapter` translates between Codex protocol and Pneuma `BrowserIncomingMessage` format via `ws-bridge-codex.ts`
- Browser session init carries normalized backend identity and capabilities so UI can degrade backend-specific features cleanly

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
      │   → sessionId, agentSessionId, backendType
      │
      ├─ 4. Skill install: skill-installer.ts
      │   modes/<mode>/skill/ → workspace skills dir (backend-aware)
      │   Claude: .claude/skills/ + CLAUDE.md; Codex: .agents/skills/ + AGENTS.md
      │   Template: {{key}}, {{viewerCapabilities}}
      │
      ├─ 5. Server start: server/index.ts
      │   Hono HTTP + WebSocket + backend transport bridge
      │
      ├─ 6. Backend selection: startup-only, workspace-locked
      │   existing workspace backend cannot be switched mid-session
      │
      ├─ 7. Agent launch: backends/<backend>/
      │   Claude: claude --sdk-url ws://localhost:PORT/ws/cli/SESSION
      │   Codex: codex app-server (stdio JSON-RPC)
      │
      ├─ 8. Frontend: mode-loader.ts → dynamic import viewer
      │   External modes: registerExternalMode() → Bun.build() → import map
      │
      └─ 9. Preview loop
          Agent edits → chokidar → WS → browser → viewer render
          User selects → <viewer-context> → agent message
          User actions → viewer notification → agent
```

## Mode System

### Mode Sources

Modes can come from four sources, resolved by `core/mode-resolver.ts`:

| Type | Specifier | Resolved Path |
|------|-----------|---------------|
| **builtin** | `webcraft`, `doc`, `slide`, `draw`, `illustrate`, `remotion`, `mode-maker`, `evolve` | `modes/<name>/` |
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
- **Record:** `{ id: "${workspace}::${mode}", mode, displayName, workspace, backendType, lastAccessed }`
- Upserted on every mode launch, capped at 50 entries
- Launcher shows recent sessions with one-click resume (no dialog)

### User Preferences

Persistent user preference files managed by the agent:

- **Directory:** `~/.pneuma/preferences/`
- **Files:** `profile.md` (cross-mode), `mode-{name}.md` (per-mode)
- **Format:** Agent-managed Markdown with two system markers:
  - `<!-- pneuma-critical:start/end -->` — Hard constraints, extracted and injected into instructions file at startup
  - `<!-- changelog:start/end -->` — Update log for incremental refresh
- **Injection:** `<!-- pneuma:preferences:start/end -->` marker in CLAUDE.md/AGENTS.md (critical only)
- **Skill:** `pneuma-preferences` installed as global dependency for all modes
- **Source:** `modes/_shared/skills/pneuma-preferences/`

### Per-Workspace Persistence

Stored in `<workspace>/.pneuma/`:

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

### Skill Installation & Update Detection

On startup, skills are copied to the backend-appropriate directory:
- Claude Code: `<workspace>/.claude/skills/<installName>/` + `CLAUDE.md`
- Codex: `<workspace>/.agents/skills/<installName>/` + `AGENTS.md`


Template params (`{{key}}`, `{{viewerCapabilities}}`) are applied. Three sections are injected into the instructions file:
- `<!-- pneuma:start -->` / `<!-- pneuma:end -->` — Mode skill prompt (mode description, architecture, core rules)
- `<!-- pneuma:viewer-api:start -->` / `<!-- pneuma:viewer-api:end -->` — Viewer API (context, actions, scaffold, locator cards, native desktop APIs)
- `<!-- pneuma:preferences:start -->` / `<!-- pneuma:preferences:end -->` — User preferences critical constraints (extracted from `~/.pneuma/preferences/`)

A fourth optional section is injected by the evolution system:
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
| `GET /api/backends` | Returns backend descriptors + availability + default backend |
| `GET /api/modes/:name/showcase/*` | Serve mode showcase assets |
| `GET /api/sessions` | Returns `{ sessions, homeDir }` — filtered by existing workspace |
| `GET /api/sessions/thumbnail` | Get session thumbnail image |
| `DELETE /api/sessions/:id` | Remove a session record |
| `PATCH /api/sessions/:id` | Rename a session (`{ sessionName }`) |
| `DELETE /api/modes/:name` | Delete a local mode from `~/.pneuma/modes/` |
| `GET /api/browse-dirs` | List directories for workspace picker |
| `GET /api/workspace-check` | Check if workspace has existing session |
| `POST /api/launch/prepare` | Resolve mode, return initParams |
| `POST /api/launch/skill-check` | Compare installed vs current skill version |
| `POST /api/launch/skill-dismiss` | Record dismissed version |
| `POST /api/launch` | Spawn child `pneuma` process, wait for ready URL |

### Launcher UI Sections (Launcher.tsx)

1. **Recent Sessions** — one-click resume, inline rename/delete, search, skill update prompt
2. **Built-in Modes** — webcraft, doc, slide, draw, illustrate, mode-maker, evolve
3. **Local Modes** — scanned from `~/.pneuma/modes/`, with delete
4. **Published Modes** — fetched from R2 registry
5. **Backend Picker** — choose backend at launch; existing workspaces stay locked to their original backend

## Server API Reference

### Session & Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/session` | Current active session ID |
| POST | `/api/session/thumbnail` | Upload session thumbnail |
| POST | `/api/session/editing` | Toggle editing state (`{ editing: bool }` — launches/kills agent) |
| GET | `/api/app-settings` | Per-workspace app settings (window size, resizable) |
| POST | `/api/app-settings` | Update app settings (merges with existing) |
| GET | `/api/config` | Mode init params, layout, editing state, app settings |
| GET | `/api/mode-info` | External mode info |
| GET | `/api/viewer-state` | Persisted viewer position (content set + file) |
| POST | `/api/viewer-state` | Save viewer position |

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

### History & Checkpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history/checkpoints` | List shadow-git checkpoints |
| POST | `/api/history/export` | Export session as shareable .tar.gz |

### Replay

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/replay/load` | Load a replay package from local path |
| GET | `/api/replay/messages` | Get all messages from loaded replay |
| POST | `/api/replay/checkout/:hash` | Extract checkpoint files, return file list |
| GET | `/api/replay/status` | Check if server is in replay mode |
| POST | `/api/replay/continue` | Transition from replay to normal session |

### Sharing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/share/result` | Upload workspace files to R2 |
| POST | `/api/share/process` | Upload full history package to R2 |
| GET | `/api/r2/status` | Check R2 configuration status |
| POST | `/api/import` | Download shared package, prepare workspace |

### Deploy (Vercel)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vercel/status` | Check Vercel availability (CLI or token) |
| GET | `/api/vercel/config` | Get Vercel token config (masked) |
| POST | `/api/vercel/config` | Save Vercel token |
| GET | `/api/vercel/teams` | List Vercel teams |
| GET | `/api/vercel/binding` | Get deploy binding for contentSet |
| POST | `/api/vercel/deploy` | Deploy files to Vercel |
| DELETE | `/api/vercel/binding` | Clear deploy binding |

### Deploy (Cloudflare Pages)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cf-pages/status` | Check CF Pages availability (CLI or token) |
| GET | `/api/cf-pages/config` | Get CF Pages config (masked) |
| POST | `/api/cf-pages/config` | Save CF Pages API token + account ID |
| GET | `/api/cf-pages/binding` | Get deploy binding for contentSet |
| POST | `/api/cf-pages/deploy` | Deploy files to Cloudflare Pages |

### Workspace & Viewer

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspace/scaffold` | Write/clear workspace files |
| POST | `/api/viewer/action` | Dispatch viewer action |

### Proxy

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/proxy/<name>/*` | Reverse proxy to external API (config from manifest + proxy.json) |

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
| GET | `/vendor/*` | React shims for external modes (react.js, react-dom.js, jsx-runtime) + snapdom.js |

### Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/export/slides` | Slide export HTML |
| GET | `/export/slides/download` | Download slides as HTML file |
| GET | `/export/webcraft` | Webcraft export HTML |
| GET | `/export/webcraft/download` | Download webcraft as HTML file |
| GET | `/export/webcraft/zip` | Download webcraft as ZIP archive |
| GET | `/export/remotion` | Remotion export HTML with player + MP4/WebM export |
| GET | `/export/remotion/download` | Download Remotion as standalone HTML file |

### Native (Electron desktop only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/native` | List available capabilities (or `{ available: false }` in web) |
| POST | `/api/native/:capability/:method` | Invoke a native method (body: JSON args array) |

Available capabilities when running in desktop app: `clipboard` (readText, writeText, readHTML, writeHTML, readImage→base64 PNG, writeImage←base64, availableFormats), `shell` (openPath, openExternal, showItemInFolder, beep), `app` (getVersion, getName, getPath, getLocale), `system` (platform, arch, cpus, totalMemory, freeMemory, hostname, homedir, tmpdir, uptime), `theme` (shouldUseDarkColors, themeSource), `screen` (getPrimaryDisplay, getAllDisplays, getCursorScreenPoint), `notification` (show, isSupported), `window` (minimize, maximize, isMaximized, isFullScreen, setAlwaysOnTop, getBounds).

Architecture: Server → WS `native_request` → Browser → Electron IPC → result → WS `native_result` → Server.

### WebSocket

| Path | Protocol | Description |
|------|----------|-------------|
| `/ws/browser/:sessionId` | JSON | Browser ↔ server |
| `/ws/cli/:sessionId` | NDJSON | Claude Code CLI ↔ server |
| `/ws/terminal/:terminalId` | binary | PTY terminal |

Note: Codex uses stdio JSON-RPC (not WebSocket). `CodexAdapter` bridges Codex ↔ browser via `ws-bridge-codex.ts`.

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
- **Stale `dist/`**: If `dist/index.html` exists, the server falls back to production mode. Launcher-spawned children auto-inherit `--dev` from the parent, but direct CLI usage without `--dev` may still hit this. Delete `dist/` or pass `--dev` explicitly.
- **Bun.serve dual-stack**: Must set `hostname: "0.0.0.0"` to avoid IPv6/IPv4 port collision on macOS.
- **CLAUDECODE env var**: Must be unset when spawning Claude Code CLI.
- **Backend persistence**: `backendType` in `.pneuma/session.json` and `~/.pneuma/sessions.json` is part of resume identity.
- **Codex session state merge**: `ws-bridge-codex.ts` must merge adapter's partial session with server's full state before broadcasting to browser — adapter omits `agent_capabilities`, which causes UI crashes if sent raw.
- **Bun.spawn stdout ReadableStream**: Bun's `proc.stdout` ReadableStream may close prematurely while the process is still alive (`exitCode=null, killed=false`). Codex launcher uses `node:child_process` instead to avoid this. Do not switch back to `Bun.spawn` for Codex without verifying the Bun bug is fixed.
- **Codex WsBridge routing**: Codex uses stdio (no `cliSocket`), so `handleBrowserOpen` and `getActiveSessionId` must check `codexAdapters` map in addition to `cliSocket` to avoid sending `cli_disconnected` or returning null.
- **NDJSON**: Each message to CLI must end with `\n`.
- **Empty assistant messages**: `MessageBubble` returns null when content is empty (tool_use-only messages).
- **modelUsage cumulative**: Use delta (current - previous) for per-turn cost.
- **`backdrop-filter` containing block**: `backdrop-filter` creates a containing block for fixed-positioned children, causing coordinate offset in Excalidraw. Avoid or account for it.
- **`@zumer/snapdom`**: Used for slide thumbnail capture and export image mode. Renders DOM to canvas via snapshot cloning. **Important:** capture iframes must be `display: none` during snapdom calls — visible iframes cause foreignObject text reflow (wider text metrics, unexpected line breaks). See `useSlideThumbnails.ts` and `export.ts` for the pattern.
- **Windows compatibility**: Cross-platform support via:
  - `path-resolver.ts`: `where` instead of `which`, builds PATH from `LOCALAPPDATA`/`APPDATA`/`ProgramFiles`
  - `terminal-manager.ts`: `COMSPEC`/`cmd.exe` as shell, no `-l` flag
  - `system-bridge.ts`: `cmd /c start "" url` for browser opening, `explorer /select,` for revealing
  - `server/index.ts`: `NUL` for null device, `taskkill /F /PID` for process kill, lsof/ps gracefully return empty list
  - Path comparison is case-insensitive on win32
- **Shadow-git checkpoint queue**: All checkpoint operations are serialized via Promise chain to prevent `index.lock` conflicts. Do not parallelize shadow-git operations.
- **Replay mode deferred agent launch**: When `--replay` is passed, agent launch is deferred until `/api/replay/continue` is called. The server holds a `replayContinueCallback` registered by the CLI.
- **Replay checkout isolation**: Each `/api/replay/checkout/:hash` cleans `.pneuma/replay-checkout/` before extracting, so `/content/*` serves checkpoint-accurate file state. Continue Work extracts final checkpoint to workspace root.
- **Replay auto-navigate timing**: File navigation in replay must run AFTER checkpoint loads (not during `displayMessage`), because content sets aren't computed until `setFiles` completes.
- **Proxy hot reload**: `proxy.json` changes are picked up by chokidar. The proxy middleware reads config from memory on each request, so no server restart is needed.
- **Proxy methods**: Default allowed method is GET only. POST/PUT/PATCH require explicit `"methods"` in config.
- **Proxy content-encoding**: Bun's `fetch()` auto-decompresses gzip/br responses. The proxy strips `content-encoding` from upstream response headers to prevent browsers from double-decompressing. If you add new response header filtering, keep `content-encoding` in the strip list.
- **GridBoard JSX tag limitation**: The tile compiler (Babel + eval) cannot resolve locally-defined components as JSX tags. `<MyComponent />` throws "not defined" even if defined in the same file. Use plain function calls `{renderMyComponent(...)}` instead. This is a runtime scope limitation, not a hoisting issue.
- **`editing` state**: `editing` is a top-level session boolean (`true` = creating, `false` = consuming). Persisted in `.pneuma/session.json` and `~/.pneuma/sessions.json`. Modes opt in via `editing: { supported: true }` in manifest; unsupported modes are always `editing: true`.
- **Editing agent lifecycle**: When `editing: false`, no agent process runs. Switching to `editing: true` triggers a full agent launch (skill install + spawn). Switching back kills the agent. The server process stays alive throughout.
- **`editing` vs `readonly`**: `readonly` disables ALL interactions (replay). `editing: false` only disables Pneuma editing UI (drag/resize/select/gallery), while content-internal interactions remain fully functional (tile clicks, links, etc.).
- **Native bridge availability**: `/api/native/*` endpoints only work inside the Electron desktop app. Web environments return `{ available: false }`. The bridge routes through the browser WS connection — if no browser tab is connected, native calls timeout after 10s.
