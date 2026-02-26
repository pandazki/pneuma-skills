# Pneuma Skills

**Let Code Agents do WYSIWYG editing on HTML-based content.**

> **"pneuma"** — Greek *pneuma*, meaning soul, breath, life force.

Pneuma Skills is a framework that connects a Code Agent (like Claude Code) to a browser-based editor, giving users a real-time WYSIWYG experience for AI-assisted content editing. The agent edits files on disk; Pneuma watches for changes and streams a live preview to the browser alongside a chat interface.

```
Pneuma Skills = Content Mode x Code Agent Backend x Editor Shell
```

## Demo

Currently ships with **Doc Mode** — a markdown editing environment where Claude Code edits `.md` files and you see the rendered result in real-time.

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
├─────────────────────────────┴──────────────────────────┤
│  ● Connected  session:abc123  $0.02  3 turns           │
└────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` command available in PATH)

## Quick Start

```bash
# Clone and install
git clone https://github.com/pandazki/pneuma-skills.git
cd pneuma-skills
bun install

# Start Doc Mode on a workspace directory
bun bin/pneuma.ts doc --workspace ~/my-notes

# Or use the current directory
bun bin/pneuma.ts doc
```

This will:

1. Install a skill prompt into `<workspace>/.claude/skills/`
2. Start the Pneuma backend server (default port 3210)
3. Spawn a Claude Code CLI session connected via WebSocket
4. Start the Vite dev server (port 5173)
5. Open your browser with the editor UI

## CLI Usage

```
pneuma <mode> [options]

Modes:
  doc    Markdown document editing mode

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  --port <number>      Backend server port (default: 3210)
  --no-open            Don't auto-open the browser
```

## Architecture

```
Browser (React)                 Pneuma Server (Bun + Hono)              Claude Code CLI
┌──────────────┐    JSON/WS     ┌─────────────────────┐    NDJSON/WS    ┌──────────────┐
│ Chat Panel   │◄──────────────►│                     │◄───────────────►│              │
│ Live Preview │                │   WebSocket Bridge  │                 │  claude      │
│ Permissions  │                │   File Watcher      │                 │  --sdk-url   │
│ Status Bar   │                │   Content Server    │                 │              │
└──────────────┘                └─────────────────────┘                 └──────────────┘
                                         │
                                    watches disk
                                         │
                                   ┌─────────────┐
                                   │  Workspace   │
                                   │  *.md files  │
                                   └─────────────┘
```

The server maintains dual WebSocket channels:
- **Browser channel** (`/ws/browser/:sessionId`) — JSON messages for the React UI
- **CLI channel** (`/ws/cli/:sessionId`) — NDJSON messages for Claude Code's `--sdk-url` protocol

When Claude Code edits files, chokidar detects the changes and pushes updated content to the browser for live preview.

## Project Structure

```
pneuma-skills/
├── bin/pneuma.ts              # CLI entry point
├── server/
│   ├── index.ts               # Hono HTTP server + content API
│   ├── ws-bridge.ts           # Dual WebSocket bridge (browser <-> CLI)
│   ├── cli-launcher.ts        # Claude Code process spawner
│   ├── file-watcher.ts        # chokidar-based file watcher
│   └── skill-installer.ts     # Copies skill prompts to workspace
├── src/
│   ├── App.tsx                # Root layout (resizable panels)
│   ├── main.tsx               # React entry
│   ├── store.ts               # Zustand state management
│   ├── ws.ts                  # Browser WebSocket client
│   ├── types.ts               # Shared TypeScript types
│   └── components/
│       ├── ChatPanel.tsx      # Chat message feed
│       ├── ChatInput.tsx      # Message input box
│       ├── MarkdownPreview.tsx # Live markdown renderer
│       ├── MessageBubble.tsx  # Rich message rendering (text, tools, thinking)
│       ├── ToolBlock.tsx      # Expandable tool call cards
│       ├── StreamingText.tsx  # Streaming response display
│       ├── ActivityIndicator.tsx # Thinking/tool progress indicator
│       ├── PermissionBanner.tsx  # Tool permission approval UI
│       └── StatusBar.tsx      # Connection status + session info
├── skill/
│   └── doc/SKILL.md           # Doc Mode skill prompt for Claude Code
├── docs/adr/                  # Architecture Decision Records
└── draft.md                   # Full requirements document (Chinese)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Server | [Hono](https://hono.dev) |
| Frontend | React 19 + [Vite](https://vite.dev) 6 |
| Styling | [Tailwind CSS](https://tailwindcss.com) 4 + Typography plugin |
| State | [Zustand](https://zustand.docs.pmnd.rs) 5 |
| Markdown | [react-markdown](https://github.com/remarkjs/react-markdown) + remark-gfm |
| File Watching | [chokidar](https://github.com/paulmillr/chokidar) 4 |
| Agent | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via `--sdk-url` |

## How It Works

1. **Skill Installation** — Pneuma copies a mode-specific skill prompt (e.g. `skill/doc/SKILL.md`) into the workspace's `.claude/skills/` directory. Claude Code natively discovers and loads skills from this location.

2. **Agent Spawning** — The CLI launcher spawns `claude --sdk-url ws://localhost:3210/ws/cli/<sessionId>` which connects Claude Code's streaming output to the Pneuma server.

3. **Message Bridge** — The WebSocket bridge translates between the browser's JSON protocol and Claude Code's NDJSON protocol, handling message routing, permission flows, and event replay.

4. **Live Preview** — When Claude Code writes or edits files, chokidar detects changes and pushes updated content to all connected browsers via WebSocket.

5. **Rich Chat UI** — The browser renders Claude Code's full output: streaming text with markdown, expandable tool call cards, collapsible thinking blocks, and an activity indicator.

## Content Mode System

Pneuma is designed to be extensible with different content modes. Each mode defines:

- **Renderer** — How to render the content in the browser
- **Skill** — Domain-specific prompt for the Code Agent
- **File Convention** — How content is organized on disk
- **Navigator** — Structural navigation (outline, page list, etc.)

Currently implemented: **Doc Mode** (markdown). Future modes could include slides, mindmaps, canvas, and more.

## Roadmap

- [x] Doc Mode MVP — Markdown WYSIWYG editing
- [ ] Slide Mode — Presentation editing with page navigation
- [ ] Element selection — Click to select and instruct edits on specific elements
- [ ] Session persistence — Resume previous editing sessions
- [ ] Multiple agent backends — Codex CLI, custom agents
- [ ] Production build — Single binary distribution

## License

[MIT](LICENSE)
