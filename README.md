<h1 align="center">Pneuma Skills</h1>
<p align="center"><strong>Co-creation Infrastructure for Humans × Code Agents</strong></p>
<p align="center">Visual environment, skills, continuous learning, and distribution — <br>everything humans and agents need to build content together.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pneuma-skills"><img src="https://img.shields.io/npm/v/pneuma-skills.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/pneuma-skills"><img src="https://img.shields.io/npm/dm/pneuma-skills.svg" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</p>

<p align="center">
  <img src="docs/images/slide-mode-screenshot.png" alt="Pneuma Slide Mode" width="800" />
</p>

<pre align="center">bunx pneuma-skills slide --workspace ./my-first-pneuma-slide</pre>

---

> **"pneuma"** — Greek *pneuma*, meaning soul, breath, life force.

When humans and code agents co-create content, they need more than a chat window — they need shared infrastructure. Pneuma provides four pillars for this **isomorphic collaboration**, built atop mainstream code agents (currently [Claude Code](https://docs.anthropic.com/en/docs/claude-code)):

**Visual Environment** — The agent edits files on disk; you see, select, and guide the rendered result in a live, bidirectional workspace. Both human and agent operate on the same content representation in real-time.

**Skills** — Domain-specific knowledge and seed templates injected into the agent per mode. A presentation skill teaches layout, rhythm, and export; a document skill teaches prose and structure. Skills version and evolve with each release, and sessions persist across runs — the agent picks up where it left off.

**Continuous Learning** — Skills aren't static presets. The Evolution Agent mines cross-session conversation history to extract user preferences and style patterns, then augments the preset skill with learned knowledge. Run `pneuma evolve <mode>` to analyze your history, review AI-generated proposals with evidence citations, and apply them to personalize your experience.

**Distribution** — A complete ecosystem for sharing capabilities. Build a custom mode with AI assistance via Mode Maker, publish to the marketplace, and let anyone `pneuma mode add` it instantly.

## Built-in Modes

| Mode | What it does |
|------|-------------|
| **doc** | Markdown editing with live rendered preview |
| **slide** | HTML presentations — content sets, drag-reorder, presenter mode, PDF/image export |
| **draw** | Excalidraw whiteboard with `.excalidraw` file editing |
| **mode-maker** | Create custom modes with AI — fork, play-test, publish |
| **evolve** | Evolution Agent — analyze history, propose skill improvements, apply/rollback |

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.5 (required for PTY terminal support)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` command available in PATH)

## Quick Start

```bash
# Install Bun if you haven't: curl -fsSL https://bun.sh/install | bash

# Open the Launcher (marketplace UI — browse, discover, resume sessions)
bunx pneuma-skills

# Start with a fresh workspace (recommended)
bunx pneuma-skills slide --workspace ./my-first-pneuma-slide

# Or use the current directory (files will be created here)
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
pneuma-skills [mode] [options]

Modes:
  (no argument)                Open the Launcher (marketplace UI)
  doc                          Markdown document editing mode
  slide                        Presentation editing mode (HTML slides with iframe preview)
  draw                         Excalidraw whiteboard drawing mode
  mode-maker                   Create and develop custom modes with AI
  evolve                       Launch the Evolution Agent for skill learning
  /path/to/mode                Load mode from a local directory
  github:user/repo             Load mode from a GitHub repository
  github:user/repo#branch      Load mode from a specific branch/tag
  https://...tar.gz            Load mode from a URL

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  --port <number>      Server port (default: 17996)
  --no-open            Don't auto-open the browser
  --no-prompt          Non-interactive mode (used by launcher)
  --skip-skill         Skip skill installation (session resume without update)
  --debug              Enable debug mode (inspect enriched CLI payloads)
  --dev                Force dev mode (Vite)

Subcommands:
  evolve <mode>        Analyze history and propose skill improvements
  mode add <url>       Install a remote mode to ~/.pneuma/modes/
  mode list            List published modes on the R2 registry
  mode publish         Publish the current workspace as a mode
  snapshot push        Upload workspace snapshot to R2
  snapshot pull        Download workspace snapshot from R2
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

# Install a published mode from URL
pneuma mode add https://example.com/my-mode.tar.gz
```

GitHub repositories are cloned to `~/.pneuma/modes/` and cached locally. Subsequent runs will fetch the latest changes. Published modes can be browsed in the Launcher or installed via `pneuma mode add`.

A mode package must contain:
- `manifest.ts` — default export of `ModeManifest`
- `pneuma-mode.ts` — default export of `ModeDefinition`
- `viewer/` — React preview components
- `skill/` — Skill files (optional)

## Architecture

Pneuma is organized in four layers, each with a clear contract boundary:

```
┌─────────────────────────────────────────────────────────┐
│  Launcher (marketplace UI)                              │
│  Browse → Discover → Launch → Resume                    │
├─────────────────────────────────────────────────────────┤
│  Mode Resolution                                        │
│  builtin | local | github | url → manifest.ts on disk   │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Mode Protocol                                 │
│  ModeManifest — "what capability, what config, what UI" │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Content Viewer                                │
│  ViewerContract — "how to render, select, align"        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Agent Bridge                                  │
│  AgentBackend — "how to launch, communicate, lifecycle" │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Shell                                 │
│  HTTP, WebSocket, PTY, File Watch, Frontend             │
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
| **ViewerContract** | Preview component, context extraction, file workspace model, agent-callable actions | Custom renderers, viewport tracking, action protocols |
| **AgentBackend** | Launch, resume, kill, capability declaration | Other agents (Codex, Aider) |

Contracts are defined in `core/types/` with 316 tests across 20 test files.

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry — orchestrates mode + agent + server
├── core/
│   ├── types/                 # Contract definitions
│   │   ├── mode-manifest.ts   #   ModeManifest, SkillConfig, ViewerConfig, ViewerApi
│   │   ├── viewer-contract.ts #   ViewerContract, FileWorkspaceModel, ViewerAction*
│   │   ├── agent-backend.ts   #   AgentBackend, AgentCapabilities
│   │   ├── mode-definition.ts #   ModeDefinition (manifest + viewer)
│   │   └── index.ts           #   Re-exports
│   ├── mode-loader.ts         # Dynamic mode discovery and loading (builtin + external)
│   ├── mode-resolver.ts       # Mode source resolution (builtin/local/github/url)
│   └── __tests__/             # Contract tests
├── modes/
│   ├── doc/                   # Doc Mode — markdown editing
│   ├── slide/                 # Slide Mode — presentation editing
│   ├── draw/                  # Draw Mode — Excalidraw whiteboard
│   ├── mode-maker/            # Mode Maker — create custom modes with AI
│   └── evolve/                # Evolve Mode — evolution agent dashboard
│       ├── manifest.ts        # Mode manifest (fork, play, publish workflow)
│       ├── seed/              # Template files for new modes
│       ├── skill/             # Skill prompt for mode development
│       └── viewer/            # Mode development preview UI
├── backends/
│   └── claude-code/
│       ├── index.ts           # ClaudeCodeBackend implements AgentBackend
│       └── cli-launcher.ts    # Process spawner (Bun.spawn + --sdk-url)
├── server/
│   ├── index.ts               # Hono HTTP server + WS routing + content/viewer APIs
│   ├── ws-bridge.ts           # Dual WebSocket bridge (browser JSON ↔ CLI NDJSON)
│   ├── ws-bridge-viewer.ts    # Viewer action request/response routing
│   ├── ws-bridge-*.ts         # Controls, replay, browser handlers, types
│   ├── file-watcher.ts        # chokidar watcher (manifest-driven patterns)
│   ├── skill-installer.ts     # Copies skill prompts + template engine
│   ├── terminal-manager.ts    # PTY terminal sessions
│   ├── path-resolver.ts       # Binary PATH resolution (cross-platform)
│   ├── system-bridge.ts       # OS-level operations (open, reveal, openUrl)
│   ├── mode-maker-routes.ts   # Mode Maker API routes (fork, play, publish, reset)
│   ├── evolution-agent.ts     # Evolution Agent launcher (spawns CC with analysis tools)
│   ├── evolution-proposal.ts  # Proposal CRUD + apply/rollback + CLAUDE.md sync
│   └── evolution-routes.ts    # Evolution API routes (/api/evolve/*)
├── src/
│   ├── App.tsx                # Root layout (dynamic viewer from store)
│   ├── store.ts               # Zustand state (session, messages, viewer)
│   ├── ws.ts                  # Browser WebSocket client
│   └── components/
│       ├── Launcher.tsx       # Mode marketplace + recent sessions + local modes
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
│   ├── r2.ts                  # R2 storage client
│   └── mode-publish.ts        # Mode package publishing to R2 registry
└── docs/
    ├── adr/                   # Architecture Decision Records
    ├── images/                # Screenshots and visual assets
    └── archive/               # Completed design docs & references
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

- **Launcher marketplace UI** — Browse builtin, published, and local modes; one-click launch or resume
- **Live visual workspace** — Agent edits files, you see rendered results instantly in a bidirectional canvas
- **Mode Maker** — Create and develop custom modes with AI assistance (fork, play-test, publish)
- **Content sets** — Slide Mode supports multiple slide sets per workspace with seed templates
- **Next-gen visual design** — Ethereal Tech aesthetic with glassmorphism, neon orange accents, cinematic dark UI
- **Export & capture** — Slide export to HTML/images via `@zumer/snapdom`
- **Launcher process management** — Monitor and kill child processes spawned from the launcher
- **Element selection** — Click any block to select it, then instruct changes on that specific element
- **Inline editing** — Edit content directly in the preview (edit mode)
- **Rich chat UI** — Streaming text, expandable tool calls, collapsible thinking, context visualization
- **Integrated terminal** — Full PTY terminal with xterm.js
- **Session history** — Persist sessions, resume with one-click, skill update detection on resume
- **Local mode management** — Install modes via `pneuma mode add`, delete from launcher UI
- **Mode publishing** — Publish custom modes to R2 registry via `pneuma mode publish`
- **Permission control** — Review and approve/deny tool use requests
- **Task tracking** — Visualize Claude's TodoWrite/TaskCreate progress
- **Background processes** — Monitor long-running background commands
- **Context visualization** — Rich `/context` card with category breakdown and stacked bar
- **Image upload** — Drag & drop or paste images into chat
- **Viewer context enrichment** — `<viewer-context>` XML blocks align agent perception with user viewport
- **Viewer action protocol** — Agent can invoke viewer capabilities (navigate, toggle UI, capture)
- **Evolution Agent** — `pneuma evolve <mode>` analyzes conversation history, proposes skill improvements with evidence
- **Proposal lifecycle** — Review, apply, rollback, discard, or fork proposals into custom modes
- **Windows compatibility** — Cross-platform PATH resolution, terminal, browser opening, process management
- **Debug mode** — `--debug` flag shows enriched CLI payloads for each message

## Roadmap

- [x] Doc Mode — Markdown editing with live visual preview
- [x] Slide Mode — Presentation editing with iframe preview, drag-reorder, AI image generation
- [x] Draw Mode — Excalidraw whiteboard with `.excalidraw` file editing
- [x] Element selection & inline editing
- [x] Session persistence & resume
- [x] Terminal, tasks, context panel
- [x] v1.0 contract architecture (ModeManifest, ViewerContract, AgentBackend)
- [x] ViewerContract v2 — Agent-Human alignment protocol (workspace model, action protocol, context enrichment)
- [x] Remote mode loading — `pneuma github:user/repo` or local path
- [x] Launcher marketplace UI — Browse, discover, launch, resume sessions
- [x] Mode Maker — Create custom modes with AI (fork, play-test, publish)
- [x] Mode publishing — `pneuma mode publish` to R2 registry
- [x] Windows compatibility — Cross-platform PATH, terminal, browser, process management
- [x] Content sets — Multiple slide sets per workspace with seed templates
- [x] Launcher process management — Monitor and kill child processes
- [x] Next-gen visual redesign — Ethereal Tech aesthetic (glassmorphism, cinematic dark UI)
- [x] Export & image capture — Slide export via `@zumer/snapdom`
- [x] Evolution Agent — AI-native continuous skill learning (`pneuma evolve <mode>`)
- [x] Skill effectiveness optimization — standardized claudeMdSection + YAML frontmatter for native skill discovery
- [ ] Additional agent backends — Codex CLI, custom agents
- [ ] In-session adaptation — agent refines its approach in real-time based on feedback within a session

## Acknowledgements

This project's WebSocket bridge, NDJSON protocol handling, and chat UI rendering are heavily ~~inspired by~~ copied from [Companion](https://github.com/The-Vibe-Company/companion) by The Vibe Company. To be honest, the entire technical approach was basically Claude Code reading Companion's source code and reproducing it here. We stand on the shoulders of giants — or more accurately, we asked an AI to stand on their shoulders for us.

Thank you Companion for figuring out the undocumented `--sdk-url` protocol so we didn't have to.

## License

[MIT](LICENSE)
