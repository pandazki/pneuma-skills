<p align="center">
  <img src="docs/images/pneuma-logo-helix_2.png" alt="Pneuma" width="120" />
</p>

<h1 align="center">Pneuma Skills</h1>
<p align="center"><strong>Co-creation Infrastructure for Humans × Code Agents</strong></p>
<p align="center">Visual environment, skills, continuous learning, and distribution — <br>everything humans and agents need to build content together.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pneuma-skills"><img src="https://img.shields.io/npm/v/pneuma-skills.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/pneuma-skills"><img src="https://img.shields.io/npm/dm/pneuma-skills.svg" alt="npm downloads" /></a>
  <a href="https://github.com/pandazki/pneuma-skills/releases"><img src="https://img.shields.io/github/v/release/pandazki/pneuma-skills?label=desktop" alt="Desktop release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</p>

<p align="center">
  <img src="docs/images/slide-mode-screenshot.png" alt="Pneuma Slide Mode" width="800" />
</p>

<pre align="center">bunx pneuma-skills slide --workspace ./my-first-pneuma-slide</pre>

---

> **"pneuma"** — Greek *pneuma*, meaning soul, breath, life force.

When humans and code agents co-create content, they need more than a chat window — they need shared infrastructure. Pneuma provides four pillars for **isomorphic collaboration**, built atop mainstream code agents (currently [Claude Code](https://docs.anthropic.com/en/docs/claude-code)):

| Pillar | What it does |
|--------|-------------|
| **Visual Environment** | Agent edits files on disk; you see, select, and guide the rendered result in a live, bidirectional workspace |
| **Skills** | Domain-specific knowledge and seed templates injected per mode. Sessions persist across runs — the agent picks up where it left off |
| **Continuous Learning** | Evolution Agent mines conversation history to extract preferences, then augments skills with learned knowledge |
| **Distribution** | Build custom modes with AI via Mode Maker, publish to the marketplace, share with `pneuma mode add` |

## Built-in Modes

| Mode | What it does |
|------|-------------|
| **webcraft** | Live web development with [Impeccable](https://impeccable.style) AI design intelligence — 17 design commands, responsive preview, export |
| **slide** | HTML presentations — content sets, drag-reorder, presenter mode, PDF/image export |
| **doc** | Markdown documents with live preview — the simplest mode, a minimal example of the mode system |
| **draw** | Diagrams and visual thinking on an [Excalidraw](https://excalidraw.com) canvas |
| **illustrate** | AI illustration studio — generate and curate visual assets on a row-based canvas with content sets |
| **mode-maker** | Create custom modes with AI — fork, play-test, publish |
| **evolve** | Evolution Agent — analyze history, propose skill improvements, apply/rollback |

## Getting Started

### Desktop App (recommended)

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon + Intel) | [`.dmg`](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Windows x64 | [`.exe` installer](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Windows ARM64 | [`.exe` installer](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Linux x64 | [`.AppImage`](https://github.com/pandazki/pneuma-skills/releases/latest) / [`.deb`](https://github.com/pandazki/pneuma-skills/releases/latest) |

The desktop app bundles Bun — no runtime install needed. Just install [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) and you're ready to go.

### CLI

```bash
# Prerequisites: Bun >= 1.3.5, Claude Code CLI

# Open the Launcher (marketplace UI)
bunx pneuma-skills

# Start a mode with a fresh workspace
bunx pneuma-skills slide --workspace ./my-first-pneuma-slide

# Or use the current directory
bunx pneuma-skills doc
```

<details>
<summary><strong>Install from source</strong></summary>

```bash
git clone https://github.com/pandazki/pneuma-skills.git
cd pneuma-skills
bun install
bun run dev doc --workspace ~/my-notes
```

</details>

## CLI Usage

```
pneuma-skills [mode] [options]

Modes:
  (no argument)                Open the Launcher (marketplace UI)
  webcraft                     Web design with Impeccable.style
  slide                        HTML presentations
  doc                          Markdown with live preview
  draw                         Excalidraw canvas
  illustrate                   AI illustration studio
  mode-maker                   Create custom modes with AI
  evolve                       Launch the Evolution Agent
  /path/to/mode                Load from a local directory
  github:user/repo             Load from GitHub
  https://...tar.gz            Load from URL

Options:
  --workspace <path>   Target workspace directory (default: cwd)
  --port <number>      Server port (default: 17996)
  --no-open            Don't auto-open the browser
  --skip-skill         Skip skill installation
  --debug              Enable debug mode
  --dev                Force dev mode (Vite)

Subcommands:
  evolve <mode>        Analyze history and propose skill improvements
  mode add <url>       Install a remote mode
  mode list            List published modes
  mode publish         Publish current workspace as a mode
  snapshot push/pull   Upload/download workspace snapshot
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Desktop / Launcher                                     │
│  Browse → Discover → Launch → Resume                    │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Mode Protocol                                 │
│  ModeManifest — skill + viewer config + agent prefs     │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Content Viewer                                │
│  ViewerContract — render, select, agent-callable actions│
├─────────────────────────────────────────────────────────┤
│  Layer 2: Agent Bridge                                  │
│  AgentBackend — launch, communicate, lifecycle          │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Shell                                 │
│  HTTP, WebSocket, PTY, File Watch, Frontend             │
└─────────────────────────────────────────────────────────┘
```

Three core contracts in `core/types/`:

| Contract | Responsibility | Extend to... |
|----------|---------------|-------------|
| **ModeManifest** | Skill, viewer config, agent preferences, init seeds | New modes (mindmap, canvas, etc.) |
| **ViewerContract** | Preview component, context extraction, action protocol | Custom renderers, viewport tracking |
| **AgentBackend** | Launch, resume, kill, capability declaration | Other agents (Codex, Aider) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) >= 1.3.5 |
| Server | [Hono](https://hono.dev) |
| Frontend | React 19 + [Vite](https://vite.dev) 6 + [Tailwind CSS](https://tailwindcss.com) 4 |
| Desktop | [Electron](https://www.electronjs.org) 35 + electron-builder + electron-updater |
| Terminal | [xterm.js](https://xtermjs.org) + Bun native PTY |
| Drawing | [Excalidraw](https://excalidraw.com) |
| Canvas | [React Flow](https://reactflow.dev) (Illustrate mode) |
| Agent | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via `--sdk-url` |

## Acknowledgements

This project's WebSocket bridge, NDJSON protocol handling, and chat UI rendering are heavily ~~inspired by~~ copied from [Companion](https://github.com/The-Vibe-Company/companion) by The Vibe Company. To be honest, the entire technical approach was basically Claude Code reading Companion's source code and reproducing it here. We stand on the shoulders of giants — or more accurately, we asked an AI to stand on their shoulders for us.

Thank you Companion for figuring out the undocumented `--sdk-url` protocol so we didn't have to.

## License

[MIT](LICENSE)
