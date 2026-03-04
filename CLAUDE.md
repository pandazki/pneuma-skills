# Pneuma Skills

## Project Overview

Pneuma Skills is an extensible delivery platform for filesystem-based Agent capabilities. Agents edit files on disk, Pneuma watches for changes and streams a live WYSIWYG preview alongside a full chat interface.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 1.14.2
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `doc`, `slide`, `draw`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun >= 1.3.5 |
| Server | Hono 4.7 |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 + Zustand 5 |
| Terminal | xterm.js 6 + Bun native PTY |
| File Watching | chokidar 4 |
| Drawing | @excalidraw/excalidraw 0.18 |
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
├── modes/{doc,slide,draw}/    # Builtin modes (manifest.ts + viewer/ + skill/)
├── backends/claude-code/      # AgentBackend impl — Bun.spawn with --sdk-url
├── server/
│   ├── index.ts               # Hono server + launcher endpoints + WS routing
│   ├── ws-bridge*.ts          # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON)
│   ├── skill-installer.ts     # Skill copy + template engine + CLAUDE.md injection
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven)
│   └── terminal-manager.ts    # PTY terminal sessions
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
├── snapshot/                  # R2 push/pull for workspace snapshots
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
| **ModeManifest** | `core/types/mode-manifest.ts` | Skill, viewer config, agent preferences, init params |
| **ViewerContract** | `core/types/viewer-contract.ts` | Preview component, context extraction, workspace model |
| **AgentBackend** | `core/types/agent-backend.ts` | Launch, resume, kill, capabilities |

### Communication

- Dual WebSocket: Browser (`/ws/browser/:sessionId`, JSON) ↔ Server ↔ CLI (`/ws/cli/:sessionId`, NDJSON)
- File changes: chokidar → WebSocket push to browser
- CLI: `claude --sdk-url ws://... --print --output-format stream-json --input-format stream-json --verbose -p ""`

## Mode System

### Mode Sources

Modes can come from four sources, resolved by `core/mode-resolver.ts`:

| Type | Specifier | Resolved Path |
|------|-----------|---------------|
| **builtin** | `doc`, `slide`, `draw` | `modes/<name>/` |
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

### Skill Installation & Update Detection

On startup, skills are copied from `modes/<mode>/skill/` to `<workspace>/.claude/skills/<installName>/`. Template params (`{{key}}`, `{{viewerCapabilities}}`) are applied. Two sections are injected into CLAUDE.md:
- `<!-- pneuma:start -->` / `<!-- pneuma:end -->` — Skill prompt
- `<!-- pneuma:viewer-api:start -->` / `<!-- pneuma:viewer-api:end -->` — Viewer API description

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

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: changes to contracts → update `core/types/` + `core/__tests__/`
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Zustand** single store (`src/store.ts`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Warm Craft" theme via `cc-*` CSS custom properties (terracotta primary, warm grays)

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
- **Stale `dist/`**: If `dist/index.html` exists, dev mode serves production build. Delete `dist/` or rebuild.
- **Bun.serve dual-stack**: Must set `hostname: "0.0.0.0"` to avoid IPv6/IPv4 port collision on macOS.
- **CLAUDECODE env var**: Must be unset when spawning Claude Code CLI.
- **NDJSON**: Each message to CLI must end with `\n`.
- **Empty assistant messages**: `MessageBubble` returns null when content is empty (tool_use-only messages).
- **modelUsage cumulative**: Use delta (current - previous) for per-turn cost.

<!-- pneuma:viewer-api:start -->
## Viewer API

### Viewer Context

Each user message may be prefixed with a `<viewer-context>` block.
It describes what the user is currently seeing — the active file, viewport position, and selected elements.
Use this to resolve references like "this page", "here", "this section" in user messages.

### Workspace
- Type: all (multi-file)

<!-- pneuma:viewer-api:end -->
