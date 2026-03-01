# Pneuma Skills

## Project Overview

Pneuma Skills is an extensible delivery platform for filesystem-based Agent capabilities. Agents edit files on disk, Pneuma watches for changes and streams a live WYSIWYG preview alongside a full chat interface.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 1.6.1
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Available Modes:** `doc` (markdown editing), `slide` (presentation editing), `draw` (Excalidraw whiteboard)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun >= 1.3.5 |
| Server | Hono 4.7 |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 + Zustand 5 |
| Markdown | react-markdown + remark-gfm + rehype-raw |
| Terminal | xterm.js 6 + Bun native PTY |
| File Watching | chokidar 4 |
| Panels | react-resizable-panels 4.6 |
| Drag & Drop | @dnd-kit |
| Code Editor | @uiw/react-codemirror |
| Drawing | @excalidraw/excalidraw 0.18 |
| Agent | Claude Code CLI via `--sdk-url` WebSocket protocol |

## Development Commands

```bash
bun install              # Install dependencies
bun run dev doc          # Start in Doc Mode (current directory as workspace)
bun run dev slide        # Start in Slide Mode
bun run dev draw         # Start in Draw Mode (Excalidraw whiteboard)
bun run dev doc --workspace ~/my-notes --port 17996 --no-open
bun run build            # Vite production build to dist/
bun test                 # Run all tests (bun:test)
```

## Ports

- **17996** — Vite dev server (frontend HMR + proxy to backend)
- **17007** — Hono backend server (API + WebSocket + content serving)
- In dev mode, browser connects to 17996 (Vite), API requests proxy to 17007
- In dev mode, WebSocket connects directly to 17007 (Vite WS proxy doesn't work with Bun)

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry — orchestrates mode + agent + server
├── core/
│   ├── types/                 # Contract definitions (Layer 4 + 3 + 2)
│   │   ├── mode-manifest.ts   #   ModeManifest, SkillConfig, ViewerConfig, InitConfig
│   │   ├── viewer-contract.ts #   ViewerContract, ViewerPreviewProps
│   │   ├── agent-backend.ts   #   AgentBackend, AgentCapabilities, AgentProtocolAdapter
│   │   └── mode-definition.ts #   ModeDefinition (manifest + viewer binding)
│   ├── mode-loader.ts         # Dynamic mode discovery & loading (builtin + external)
│   ├── mode-resolver.ts       # Mode source resolution (builtin/local/github)
│   └── __tests__/             # 81 tests (bun:test)
├── modes/
│   ├── doc/                   # Doc Mode — markdown editing
│   │   ├── manifest.ts        #   ModeManifest v1.0.0
│   │   ├── pneuma-mode.ts     #   ModeDefinition (manifest + DocPreview)
│   │   ├── components/DocPreview.tsx  # Markdown preview with select/edit modes
│   │   └── skill/SKILL.md     #   Skill prompt for Claude Code
│   ├── slide/                 # Slide Mode — presentation editing
│   │   ├── manifest.ts        #   ModeManifest v1.2.0 (with init params)
│   │   ├── pneuma-mode.ts     #   ModeDefinition (manifest + SlidePreview)
│   │   ├── components/SlidePreview.tsx  # Slide carousel with iframe preview
│   │   └── skill/             #   Skill package (SKILL.md + design docs + scripts)
│   └── draw/                  # Draw Mode — Excalidraw whiteboard
│       ├── manifest.ts        #   ModeManifest
│       ├── pneuma-mode.ts     #   ModeDefinition (manifest + DrawPreview)
│       ├── components/DrawPreview.tsx  # Excalidraw editor
│       └── skill/SKILL.md     #   Skill prompt for Claude Code
├── backends/
│   └── claude-code/
│       ├── index.ts           # ClaudeCodeBackend implements AgentBackend
│       └── cli-launcher.ts    # Bun.spawn with --sdk-url protocol
├── server/
│   ├── index.ts               # Hono HTTP server + WS routing + content/git/terminal APIs
│   ├── ws-bridge.ts           # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON)
│   ├── ws-bridge-types.ts     # Message type definitions
│   ├── ws-bridge-controls.ts  # Permission request routing
│   ├── ws-bridge-replay.ts    # Session history replay
│   ├── ws-bridge-browser.ts   # Browser message handling
│   ├── session-types.ts       # Session message type definitions
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven patterns)
│   ├── skill-installer.ts     # Copies skill prompts + template engine
│   ├── terminal-manager.ts    # PTY terminal sessions
│   └── path-resolver.ts       # Binary path resolution
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout with dynamic viewer from store
│   ├── store.ts               # Zustand state (session, messages, viewer, files, git, tasks)
│   ├── ws.ts                  # Browser WebSocket client
│   ├── types.ts               # Frontend type definitions
│   └── components/
│       ├── ChatPanel.tsx      # Chat message feed with streaming
│       ├── ChatInput.tsx      # Message composer with image upload
│       ├── MessageBubble.tsx  # Rich messages (markdown, tools, thinking)
│       ├── StreamingText.tsx  # Streaming text renderer
│       ├── ToolBlock.tsx      # Expandable tool call cards
│       ├── PermissionBanner.tsx # Tool permission approval UI
│       ├── ContextPanel.tsx   # Session stats, tasks, MCP servers
│       ├── TerminalPanel.tsx  # Integrated xterm.js terminal
│       ├── DiffPanel.tsx      # Git diff viewer
│       ├── DiffViewer.tsx     # Inline diff display
│       ├── EditorPanel.tsx    # CodeMirror code editor
│       ├── ProcessPanel.tsx   # Background process tracking
│       ├── TopBar.tsx         # Tabs + connection status + session cost
│       ├── ModelSwitcher.tsx  # Model selection UI
│       ├── SlashMenu.tsx      # Slash command menu
│       └── ActivityIndicator.tsx  # Phase indicator (thinking/tool/responding)
├── snapshot/                  # Snapshot push/pull via Cloudflare R2
│   ├── index.ts               # CLI commands for snapshot management
│   ├── push.ts                # Pack and upload workspace
│   ├── pull.ts                # Download and extract workspace
│   ├── archive.ts             # Tar archive utilities
│   ├── r2.ts                  # R2 storage client
│   └── types.ts               # Snapshot type definitions
└── docs/
    ├── architecture-review-v1.md    # Architecture review & v1.0 blueprint
    ├── design/                      # Design documents
    └── adr/                         # Architecture Decision Records (1-11)
```

## Architecture — Four Layers

```
Layer 4: Mode Protocol     — ModeManifest describes "what capability, config, UI"
Layer 3: Content Viewer    — ViewerContract defines "how to render, select, update"
Layer 2: Agent Bridge      — AgentBackend defines "how to launch, communicate, lifecycle"
Layer 1: Runtime Shell     — WS Bridge, HTTP, File Watcher, Session, Frontend
```

### Three Core Contracts

| Contract | File | Purpose |
|----------|------|---------|
| **ModeManifest** | `core/types/mode-manifest.ts` | Declares skill, viewer config, agent preferences, init params |
| **ViewerContract** | `core/types/viewer-contract.ts` | Preview component, context extraction, update strategy |
| **AgentBackend** | `core/types/agent-backend.ts` | Launch, resume, kill, capability declaration |

### Communication

- Dual WebSocket: Browser (`/ws/browser/:sessionId`, JSON) ↔ Server ↔ CLI (`/ws/cli/:sessionId`, NDJSON)
- File changes detected by chokidar → pushed to browser via WebSocket
- CLI spawned with: `claude --sdk-url ws://... --print --output-format stream-json --input-format stream-json --verbose -p ""`

### Session Persistence

Stored in `<workspace>/.pneuma/`:
- `session.json` — sessionId, agentSessionId, mode, createdAt
- `history.json` — message history (auto-saved every 5s)
- `config.json` — init params (slide mode: slideWidth, slideHeight, API keys)

### Skill Installation

On startup, skills are copied from `modes/<mode>/skill/` to `<workspace>/.claude/skills/<installName>/`. Template params (`{{key}}`, `{{#key}}...{{/key}}`) are applied. A section is injected into workspace's CLAUDE.md between `<!-- pneuma:start -->` / `<!-- pneuma:end -->` markers.

## Coding Conventions

- **TypeScript strict mode**, ESNext modules, bundler resolution
- **Bun APIs preferred** over Node.js equivalents (Bun.spawn, Bun.file, etc.)
- **Contract-first**: changes to Mode/Viewer/Agent contracts require updating types in `core/types/` and corresponding tests in `core/__tests__/`
- **No hardcoded mode knowledge** in server or CLI — everything driven by ModeManifest
- Frontend state via **Zustand** (single store in `src/store.ts`)
- Mode-specific React components live in `modes/<mode>/components/`

## Version Bump Checklist

When bumping the version, **all** of the following must be updated in the same commit:

1. `package.json` — `"version"` field
2. `CLAUDE.md` — `**Version:**` line near the top
3. `CHANGELOG.md` — add new version section with date and changes

Follow [semver](https://semver.org/):
- **patch** (1.3.x): bug fixes, minor UI tweaks
- **minor** (1.x.0): new features, non-breaking behavioral changes
- **major** (x.0.0): breaking changes to contracts or CLI interface

## Known Gotchas

- **chokidar glob + cwd broken** (v4): Watch directory path directly, filter by extension in callback. Do not use `watch("**/*.md", { cwd })`.
- **react-resizable-panels v4.6 API**: Use `Group` (not `PanelGroup`), `Separator` (not `PanelResizeHandle`), `orientation` (not `direction`).
- **Vite WS proxy + Bun.serve = ECONNRESET**: Browser WebSocket connects directly to backend port via `import.meta.env.DEV`, bypassing Vite proxy.
- **Stale `dist/` breaks dev mode**: If `dist/index.html` exists, `bun run dev` serves production build instead of Vite. Run `bun run build` or delete `dist/` if frontend changes are invisible.
- **Empty assistant messages**: Claude sends assistant messages with only `tool_use` blocks. `MessageBubble` returns null when `content` is empty.
- **`modelUsage` in CLI result is cumulative**: Use delta approach (current - previous) for per-turn approximation.
- **CLAUDECODE env var**: Must be unset when spawning Claude Code CLI subprocess.
- **NDJSON**: Each message must be terminated with `\n` when sending to CLI.
