# Pneuma Skills

**An extensible delivery platform for filesystem-based Agent capabilities.**

> **"pneuma"** — Greek *pneuma*, meaning soul, breath, life force.

Pneuma fills the last mile between Code Agents and users: agents edit files on disk, Pneuma watches for changes and streams a live WYSIWYG preview alongside a full chat interface. Everything is driven by three pluggable contracts — bring your own Mode, Viewer, or Agent backend.

```
ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell
```

## Demo

Ships with **Doc Mode** (markdown editing), **Slide Mode** (presentation editing), and **Draw Mode** (Excalidraw whiteboard). Here's Doc Mode — Claude Code edits `.md` files and you see the rendered result in real-time:

```
┌─────────────────────────────┬──────────────────────────┐
│                             │  Chat with Claude Code   │
│   Live Markdown Preview     │                          │
│                             │  > Add a features section│
│   # My Document             │                          │
│   ## Features               │  [Thinking... 3s]        │
│   - Real-time preview       │                          │
│   - GFM support             │  ✎ Edit README.md        │
│   - Image rendering         │  ✎ Write hero.png        │
│                             │                          │
├─────────────────────────────┼──────────────────────────┤
│  view / edit / select       │  Chat │ Context │ Term   │
├─────────────────────────────┴──────────────────────────┤
│  ● Connected  session:abc123  $0.02  3 turns           │
└────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.5 (required for PTY terminal support)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` command available in PATH)

## Quick Start

```bash
# Run directly (no install needed)
bunx pneuma-skills doc --workspace ~/my-notes

# Or use the current directory
bunx pneuma-skills doc
```

Or install from source:

```bash
git clone https://github.com/pandazki/pneuma-skills.git
cd pneuma-skills
bun install
bun run dev doc --workspace ~/my-notes
```

This will:

1. Load the Doc Mode manifest and install its skill prompt into `<workspace>/.claude/skills/`
2. Start the Pneuma server on `http://localhost:17996`
3. Spawn a Claude Code CLI session connected via WebSocket
4. Open your browser with the editor UI

## CLI Usage

```
pneuma-skills <mode> [options]

Modes:
  doc                          Markdown document editing mode
  slide                        Presentation editing mode (HTML slides with iframe preview)
  draw                         Excalidraw whiteboard drawing mode
  /path/to/mode                Load mode from a local directory
  github:user/repo             Load mode from a GitHub repository
  github:user/repo#branch      Load mode from a specific branch/tag

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  --port <number>      Server port (default: 17996)
  --no-open            Don't auto-open the browser
```

### Remote / External Modes

Pneuma supports loading modes from outside the built-in `modes/` directory:

```bash
# Load from a local directory (must contain manifest.ts and pneuma-mode.ts)
bunx pneuma-skills /path/to/my-custom-mode --workspace ~/project

# Load from a GitHub repository
bunx pneuma-skills github:pandazki/pneuma-mode-canvas --workspace ~/project

# Load from a specific branch or tag
bunx pneuma-skills github:pandazki/pneuma-mode-canvas#develop --workspace ~/project
```

GitHub repositories are cloned to `~/.pneuma/modes/` and cached locally. Subsequent runs will fetch the latest changes.

A mode package must contain:
- `manifest.ts` — default export of `ModeManifest`
- `pneuma-mode.ts` — default export of `ModeDefinition`
- `viewer/` — React preview components
- `skill/` — Skill files (optional)

## Architecture

Pneuma is organized in four layers, each with a clear contract boundary:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Mode Protocol                                 │
│  ModeManifest — "what capability, what config, what UI" │
│  modes/doc/pneuma-mode.ts                               │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Content Viewer                                │
│  ViewerContract — "how to render, select, update"       │
│  modes/doc/viewer/DocPreview.tsx                         │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Agent Bridge                                  │
│  AgentBackend — "how to launch, communicate, lifecycle" │
│  backends/claude-code/                                  │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Shell                                 │
│  WS Bridge, HTTP, File Watcher, Session, Frontend       │
│  server/ + src/                                         │
└─────────────────────────────────────────────────────────┘
```

The server maintains dual WebSocket channels:
- **Browser channel** (`/ws/browser/:sessionId`) — JSON messages for the React UI
- **CLI channel** (`/ws/cli/:sessionId`) — NDJSON messages for Claude Code's `--sdk-url` protocol

When Claude Code edits files, chokidar detects the changes and pushes updated content to the browser for live preview.

## Three Core Contracts

| Contract | Responsibility | Extend to... |
|----------|---------------|-------------|
| **ModeManifest** | Declares skill, viewer config, agent preferences, init seeds | Add new modes (mindmap, canvas, etc.) |
| **ViewerContract** | Preview component, context extraction, update strategy | Custom renderers (iframe, D3, Monaco) |
| **AgentBackend** | Launch, resume, kill, capability declaration | Other agents (Codex, Aider) |

Contracts are defined in `core/types/` with 81 tests in `core/__tests__/`.

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry — orchestrates mode + agent + server
├── core/
│   ├── types/                 # Contract definitions
│   │   ├── mode-manifest.ts   #   ModeManifest, SkillConfig, ViewerConfig
│   │   ├── viewer-contract.ts #   ViewerContract, ViewerPreviewProps
│   │   ├── agent-backend.ts   #   AgentBackend, AgentCapabilities
│   │   ├── mode-definition.ts #   ModeDefinition (manifest + viewer)
│   │   └── index.ts           #   Re-exports
│   ├── mode-loader.ts         # Dynamic mode discovery and loading (builtin + external)
│   ├── mode-resolver.ts       # Mode source resolution (builtin/local/github)
│   └── __tests__/             # 81 tests
├── modes/
│   ├── doc/
│   │   ├── pneuma-mode.ts     # Doc Mode definition (manifest + viewer)
│   │   ├── skill/SKILL.md     # Skill prompt for Claude Code
│   │   └── viewer/
│   │       └── DocPreview.tsx  # Markdown preview with select/edit modes
│   ├── slide/
│   │   ├── pneuma-mode.ts     # Slide Mode definition (manifest + viewer)
│   │   ├── skill/             # Skill package (SKILL.md + design docs + scripts)
│   │   └── viewer/
│   │       └── SlidePreview.tsx # Slide carousel with iframe preview
│   └── draw/
│       ├── pneuma-mode.ts     # Draw Mode definition (manifest + viewer)
│       ├── skill/SKILL.md     # Skill prompt for Claude Code
│       └── viewer/
│           └── DrawPreview.tsx # Excalidraw editor
├── backends/
│   └── claude-code/
│       ├── index.ts           # ClaudeCodeBackend implements AgentBackend
│       └── cli-launcher.ts    # Process spawner (Bun.spawn + --sdk-url)
├── server/
│   ├── index.ts               # Hono HTTP server + content API
│   ├── ws-bridge.ts           # Dual WebSocket bridge (browser ↔ CLI)
│   ├── ws-bridge-*.ts         # Controls, replay, browser handlers, types
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven patterns)
│   ├── skill-installer.ts     # Copies skill prompts (manifest-driven)
│   └── terminal-manager.ts    # PTY terminal sessions
├── src/
│   ├── App.tsx                # Root layout (dynamic viewer from store)
│   ├── store.ts               # Zustand state (session, messages, viewer)
│   ├── ws.ts                  # Browser WebSocket client
│   └── components/
│       ├── ChatPanel.tsx      # Chat message feed
│       ├── ChatInput.tsx      # Message composer with image upload
│       ├── MessageBubble.tsx  # Rich messages (markdown, tools, thinking, context card)
│       ├── ContextPanel.tsx   # Session stats, tasks, MCP servers, tools
│       ├── TerminalPanel.tsx  # Integrated xterm.js terminal
│       ├── ToolBlock.tsx      # Expandable tool call cards
│       ├── PermissionBanner.tsx # Tool permission approval UI
│       └── TopBar.tsx         # Tabs (Chat/Context/Terminal) + status
├── snapshot/                  # Snapshot push/pull via Cloudflare R2
│   ├── push.ts                # Pack and upload workspace
│   ├── pull.ts                # Download and extract workspace
│   └── r2.ts                  # R2 storage client
└── docs/
    ├── adr/                         # Architecture Decision Records (1-11)
    ├── design/                      # Active design documents
    └── archive/                     # Completed design docs & references
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) >= 1.3.5 |
| Server | [Hono](https://hono.dev) |
| Frontend | React 19 + [Vite](https://vite.dev) 6 |
| Styling | [Tailwind CSS](https://tailwindcss.com) 4 |
| State | [Zustand](https://zustand.docs.pmnd.rs) 5 |
| Markdown | [react-markdown](https://github.com/remarkjs/react-markdown) + remark-gfm |
| Terminal | [xterm.js](https://xtermjs.org) + Bun native PTY |
| File Watching | [chokidar](https://github.com/paulmillr/chokidar) 4 |
| Drawing | [Excalidraw](https://excalidraw.com) 0.18 |
| Agent | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via `--sdk-url` |

## Features

- **Live WYSIWYG preview** — Agent edits files, you see rendered results instantly
- **Element selection** — Click any block to select it, then instruct changes on that specific element
- **Inline editing** — Edit content directly in the preview (edit mode)
- **Rich chat UI** — Streaming text, expandable tool calls, collapsible thinking, context visualization
- **Integrated terminal** — Full PTY terminal with xterm.js
- **Session management** — Persist and resume sessions across restarts
- **Permission control** — Review and approve/deny tool use requests
- **Task tracking** — Visualize Claude's TodoWrite/TaskCreate progress
- **Background processes** — Monitor long-running background commands
- **Context visualization** — Rich `/context` card with category breakdown and stacked bar
- **Image upload** — Drag & drop or paste images into chat

## Roadmap

- [x] Doc Mode — Markdown WYSIWYG editing
- [x] Slide Mode — Presentation editing with iframe preview, drag-reorder, AI image generation
- [x] Draw Mode — Excalidraw whiteboard with `.excalidraw` file editing
- [x] Element selection & inline editing
- [x] Session persistence & resume
- [x] Terminal, tasks, context panel
- [x] v1.0 contract architecture (ModeManifest, ViewerContract, AgentBackend)
- [x] Remote mode loading — `pneuma github:user/repo` or local path (v1.x)
- [ ] Additional agent backends — Codex CLI, custom agents (v1.x)

## Acknowledgements

This project's WebSocket bridge, NDJSON protocol handling, and chat UI rendering are heavily ~~inspired by~~ copied from [Companion](https://github.com/The-Vibe-Company/companion) by The Vibe Company. To be honest, the entire technical approach was basically Claude Code reading Companion's source code and reproducing it here. We stand on the shoulders of giants — or more accurately, we asked an AI to stand on their shoulders for us.

Thank you Companion for figuring out the undocumented `--sdk-url` protocol so we didn't have to.

## License

[MIT](LICENSE)
