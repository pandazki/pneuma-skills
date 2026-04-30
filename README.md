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
  <a href="README.zh.md">中文</a> · <a href="#built-in-modes">Modes</a> · <a href="#getting-started">Getting started</a> · <a href="#projects-30">Projects</a>
</p>

<p align="center">
  <img src="docs/images/slide-mode-screenshot.png" alt="Pneuma Slide Mode" width="800" />
</p>

<pre align="center">bunx pneuma-skills slide --workspace ./my-first-pneuma-slide</pre>

---

> **"pneuma"** — Greek *pneuma*, meaning soul, breath, life force.

When humans and code agents co-create content, they need more than a chat window — they need shared infrastructure. Pneuma's bet is simple: **coding agents already do the work; what's missing is a way for people to watch them and participate at the right moments**. Agents live in files on disk — that's their native habitat and we don't try to abstract it away. Instead, we give each task a live player that renders the work in domain terms (a deck of slides, a board of tiles, a project) and let humans drop in direct edits or structured suggestions without breaking the agent's flow. Four pillars for **isomorphic collaboration**, built atop mainstream code agents. Today the production path is [Claude Code](https://docs.anthropic.com/en/docs/claude-code); the runtime now exposes a startup-selectable backend layer so additional agents can be integrated without rewriting the UI shell.

| Pillar | What it does |
|--------|-------------|
| **Visual Environment** | Agent works directly in files on disk — its native surface. Viewers are live players for agent output rendered in domain terms, with optional human participation directly in the UI. |
| **Skills** | Domain-specific knowledge and seed templates injected per mode. Sessions persist across runs — the agent picks up where it left off |
| **User Preferences** | The agent builds and maintains a persistent portrait of your aesthetics, collaboration style, and per-mode habits — preferences survive across sessions, workspaces, and modes |
| **Continuous Learning** | Evolution Agent mines conversation history to extract preferences, then augments skills with learned knowledge |
| **Distribution** | Build custom modes with AI via Mode Maker, publish to the marketplace, share with `pneuma mode add` |

## Built-in Modes

| Mode | What it does | Version |
|------|-------------|---------|
| **webcraft** | Live web development with [Impeccable](https://impeccable.style) AI design intelligence — 22 design commands, brand vs product register, responsive preview, export | **2.37.0** |
| **clipcraft** | AI-orchestrated video production on [@pneuma-craft](https://github.com/pandazki/pneuma-craft) — assets, composition with tracks/clips, provenance DAG, scenes; canvas preview + 3D timeline + dive panels; image / video / TTS / BGM generation scripts | **2.38.0** |
| **kami** | Paper-canvas typesetting — locked paper size (A4/A5/A3/Letter/Legal × portrait/landscape), Scroll / Focus / Book views, fit-discipline feedback loop, PDF / PNG / HTML export. Design language adapted from [tw93/kami](https://github.com/tw93/kami) | 2.31.0 |
| **slide** | HTML presentations — content sets, drag-reorder, presenter mode, PDF/image export. Skill design guidelines informed by [frontend-slides](https://github.com/zarazhangrui/frontend-slides) | 2.18.0 |
| **doc** | Markdown documents with live preview — the simplest mode, a minimal example of the mode system | 2.29.0 |
| **draw** | Diagrams and visual thinking on an [Excalidraw](https://excalidraw.com) canvas | 2.29.0 |
| **diagram** | Professional [draw.io](https://www.drawio.com) diagrams — flowcharts, architecture, UML, ER, with streaming render and sketch style | **2.27.0** |
| **illustrate** | AI illustration studio — generate and curate visual assets on a row-based canvas with content sets | 2.29.0 |
| **remotion** | Code-driven video composition on [Remotion](https://www.remotion.dev) — live preview, frame-perfect animation, MP4/WebM export via WebCodecs | 2.29.0 |
| **gridboard** | Interactive dashboards — draggable tile grid on a fixed canvas, JIT-compiled React tiles via `defineTile()`, agent-driven redesign on resize | 2.29.0 |
| **mode-maker** | Create custom modes with AI — fork, play-test, publish | 2.35.0 |
| **evolve** | Evolution Agent — analyze history, propose skill improvements, apply/rollback | 2.25.0 |

## First Run — Pneuma Walks You Through It

Create a project and Pneuma greets you on the way in. A hidden `project-onboard` mode auto-runs the first time you open a fresh project: it reads your README, package manifest, and visual assets, then drafts a Discovery Report — what your project is, what's already there, and two concrete next moves you can pick with one click.

<p align="center">
  <img src="modes/project-onboard/viewer/illustrations/04-auto-discovery.png" alt="Pneuma reading a fresh project, anchor cards filling in" width="720" />
</p>

While the onboarding agent works (~30–60s), the loading slot becomes a 10-frame carousel introducing what Pneuma actually is — agents working in real files, twelve modes sharing one shell, sessions that share a project's brain. By the time the report lands, you already have the map.

For projects that are nearly empty (just a `test.txt` or a stub README), the agent draws a small **welcome egg** — a paper lantern in the dusk, a notebook with constellations being sketched — and writes a short greeting that matches your tone. Projects with content but no logo get an auto-generated cover so the launcher tile stops showing the dotted-letter placeholder. Both gestures only fire when an image-gen API key is configured; otherwise the report still renders, just without the gift.

Prefer to set things up by hand? The Create Project dialog's chevron menu offers **Create without discovery** — you can still trigger discovery later via ProjectPanel's **Re-discover** affordance.

## Getting Started

### Desktop App (recommended)

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg`](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Windows x64 | [`.exe` installer](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Windows ARM64 | [`.exe` installer](https://github.com/pandazki/pneuma-skills/releases/latest) |
| Linux x64 | [`.AppImage`](https://github.com/pandazki/pneuma-skills/releases/latest) / [`.deb`](https://github.com/pandazki/pneuma-skills/releases/latest) |

The desktop app bundles Bun — no runtime install needed. Install [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) and you're ready to go. The launcher shows available backends — currently Claude Code and Codex are implemented.

### CLI

```bash
# Prerequisites: Bun >= 1.3.5, Claude Code CLI and/or Codex CLI

# Open the Launcher (marketplace UI)
bunx pneuma-skills

# Start a mode with a fresh workspace
bunx pneuma-skills slide --workspace ./my-first-pneuma-slide

# Explicit backend selection at startup
bunx pneuma-skills doc --backend claude-code

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
  clipcraft                    AI-orchestrated video production
  kami                         Paper-canvas typesetting
  slide                        HTML presentations
  doc                          Markdown with live preview
  draw                         Excalidraw canvas
  diagram                      draw.io diagrams
  illustrate                   AI illustration studio
  remotion                     Code-driven video composition
  gridboard                    Interactive tile dashboards
  mode-maker                   Create custom modes with AI
  evolve                       Launch the Evolution Agent
  /path/to/mode                Load from a local directory
  github:user/repo             Load from GitHub
  https://...tar.gz            Load from URL

Options:
  --workspace <path>   Target workspace directory (default: cwd)
  --port <number>      Server port (default: 17996)
  --backend <type>     Agent backend to launch (claude-code | codex)
  --project <path>     Run as a session inside the project at <path>
  --session-id <id>    Resume a project session by id (with --project)
  --session-name <s>   Custom session display name
  --viewing            Start in viewing mode (no agent, no skill install)
  --no-open            Don't auto-open the browser
  --skip-skill         Skip skill installation (silent resume)
  --debug              Enable debug mode
  --dev                Force dev mode (Vite)

Subcommands:
  mode add <url>           Install a remote mode to ~/.pneuma/modes/
  mode list                List published modes on R2
  mode publish             Publish current workspace as a mode
  evolve <mode>            Analyze history, propose skill improvements
  plugin add <source>      Install a plugin from path/github/URL
  plugin list              List builtin + external plugins
  plugin remove <name>     Remove an external plugin
  history export [--out]   Export this session as a shareable .tar.gz
  history share [--title]  Export + upload to R2, return a link
  history open <path|url>  Download / prepare a replay package
  sessions rebuild         Restore "Continue" entries from disk
  snapshot push / pull     Upload / download workspace snapshot
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
│  Layer 2: Agent Runtime                                 │
│  Backend registry + protocol bridge + normalized state  │
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
| **AgentBackend** | Launch, resume, kill, capability declaration | Other agents (Aider, etc.) |

The backend contract is intentionally split in two layers:

- Process lifecycle: `AgentBackend` owns launch, resume, exit, and capability declaration.
- Session/UI contract: the browser consumes normalized session state (`backend_type`, `agent_capabilities`, `agent_version`) rather than backend-specific wire details.

That means backend-specific protocols stay in `backends/<name>/`, while the UI and most server code depend on a stable session model.

## User Preferences

Pneuma agents remember who you are. Every mode ships with a built-in preference skill that lets the agent build and maintain a persistent portrait of your tastes and habits:

```
~/.pneuma/preferences/
├── profile.md        ← cross-mode: aesthetics, language, collaboration style
├── mode-slide.md     ← slide-specific: layout density, color tendencies, font choices
├── mode-webcraft.md  ← webcraft-specific: design patterns, component preferences
└── ...
```

**How it works:**

- The agent reads your preferences before making design or style decisions — silently, without asking
- When it notices a stable pattern or you state a preference, it updates the files — silently, without announcing
- Hard constraints (e.g. "never use dark backgrounds") are marked as **critical** and auto-injected into every session startup
- A changelog at the end of each file lets the agent do incremental refreshes instead of re-analyzing everything

**Three layers of understanding:**

1. **Observable** — language, aesthetics, collaboration style (a few sessions)
2. **Deep profile** — value anchors, latent patterns, contradictions (many sessions, evidence-required)
3. **Per-mode** — concrete habits in each mode, with explicit user-stated vs. agent-observed distinction

The preference files are living documents — full rewrites, not append-only logs. Contradictions are preserved, not resolved. Everything is deletable. The agent builds understanding over time, not a label database.

**Quick start tip:** If you already have a history of working with Claude Code, try asking the agent in any mode: *"Do a full preference refresh from my session history."* The agent will scan your past Pneuma sessions, extract your patterns and preferences, and build your profile in one pass — you might be surprised by what it picks up. This works with both Claude Code and Codex backends.

## Projects (3.0)

Pneuma supports an optional Project layer above sessions — a way to anchor *one ongoing thing* across many sessions in many modes, with shared preferences and a shared project atlas.

<p align="center">
  <img src="modes/project-onboard/viewer/illustrations/06-project-layer.png" alt="A project hub orbited by sessions across modes, all connected to a shared brain" width="720" />
</p>

A project is any user directory marked by `<root>/.pneuma/project.json`. Inside one you can:

- **Run multiple sessions in different modes** (doc + webcraft + kami + …) — all targeting the same project root, all sharing the same atlas and preferences
- **Smart Handoff between modes** — the source agent emits a structured `<pneuma:request-handoff>` tag, Pneuma surfaces a Handoff Card with intent + suggested files + key decisions, you confirm, and the target session spawns with the brief pre-staged in its CLAUDE.md
- **Project-scoped preferences** at `<root>/.pneuma/preferences/`, orthogonal to your global `~/.pneuma/preferences/` — both inject into every session's startup prompt
- **Auto-onboarding** the first time you enter a fresh project (see [First Run](#first-run--pneuma-walks-you-through-it) above)

Quick (project-less) sessions remain fully supported — projects are opt-in. Create one from the launcher's "+ Create Project" button. The full design lives at [`docs/archive/proposals/2026-04-27-pneuma-projects-design.md`](docs/archive/proposals/2026-04-27-pneuma-projects-design.md) (3.0 project layer) and [`2026-04-28-handoff-tool-call.md`](docs/archive/proposals/2026-04-28-handoff-tool-call.md) (handoff protocol).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) >= 1.3.5 |
| Server | [Hono](https://hono.dev) 4.7 |
| Frontend | React 19 + [Vite](https://vite.dev) 7 + [Tailwind CSS](https://tailwindcss.com) 4 + [Zustand](https://zustand.docs.pmnd.rs) 5 |
| Desktop | [Electron](https://www.electronjs.org) 41 + electron-builder + electron-updater |
| Terminal | [xterm.js](https://xtermjs.org) 6 + Bun native PTY |
| Drawing | [Excalidraw](https://excalidraw.com) 0.18 |
| Diagramming | [draw.io](https://www.drawio.com) viewer-static (CDN) + [rough.js](https://roughjs.com) 4.6 |
| Video | [Remotion](https://www.remotion.dev) 4.0 + @remotion/player + @babel/standalone |
| Canvas | [@xyflow/react](https://reactflow.dev) 12 (Illustrate mode) |
| File Watching | [chokidar](https://github.com/paulmillr/chokidar) 5 |
| Agent | Claude Code CLI via stdio stream-json (`-p --input-format/--output-format stream-json`); Codex CLI via app-server stdio JSON-RPC |

## Backend Model

- Backend is selected once at launch with `--backend` or in the launcher modal.
- The selected backend is persisted in `<workspace>/.pneuma/session.json` and `~/.pneuma/sessions.json`.
- Existing workspaces are backend-locked. Pneuma resumes the same backend for the lifetime of that workspace session instead of switching mid-stream.
- Frontend features now read `agent_capabilities` from session state. Claude-only features such as Schedules and cost tracking are hidden for non-Claude backends.

## License

[MIT](LICENSE)
