# Pneuma Skills

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. Agents edit files directly (Read/Edit/Write); files remain the canonical collaboration surface. Viewers are live **players** for agent output, rendering work in domain terms (a deck, a board, a project) so humans can watch, intervene in the UI, or hand structured guidance back. Four pillars: a **visual environment** (live players with optional participation), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction), and **distribution** (mode marketplace, publishing, sharing). Multiple agent backends (Claude Code, Codex, Kimi CLI) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 3.18.0
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `cosmos`, `mode-maker`, `evolve`, `project-evolve`, `project-onboard`

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
| `--backend <type>` | Startup backend selection (`claude-code` / `codex` / `kimi-cli`; locked for session) |
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
- Dev: 浏览器走 Vite，WebSocket 直连 backend，绕开 Vite WS proxy
- Launcher 派生子进程时端口自动递增；详细拓扑见 `docs/reference/network-topology.md`

## Project Structure

```
pneuma-skills/
├── bin/                       # CLI entry — mode resolution, agent launch, session registry
├── core/
│   ├── types/                 # Contracts (ModeManifest, ViewerContract, AgentBackend, SharedHistory, PluginManifest, LibraryManifest)
│   ├── mode-loader.ts         # Mode discovery & loading
│   ├── mode-resolver.ts       # Source resolution (builtin/local/github/url → disk); single-vs-library detection at install
│   ├── library-registry.ts    # ~/.pneuma/libraries/<id>/ CRUD (consume side)
│   ├── library-publish.ts     # Author side: initLocalLibrary, publishModeToLibrary, pushLibrary
│   ├── plugin-registry.ts     # Plugin discovery, lifecycle, route mounting
│   ├── hook-bus.ts            # Waterfall hook event bus (soft error)
│   └── settings-manager.ts    # Plugin settings persistence
├── plugins/                   # Builtin plugins (vercel/, cf-pages/)
├── modes/{webcraft,doc,slide,draw,diagram,illustrate,remotion,gridboard,kami,clipcraft,mode-maker,evolve,…}/
├── modes/_shared/skills/      # Global skills for all modes (e.g. pneuma-preferences)
├── modes/_shared/scripts/     # Shared scripts opted in via SkillConfig.sharedScripts, copied per-mode at install
├── backends/
│   ├── index.ts               # Pure registry over per-backend manifests
│   ├── __tests__/lifecycle-harness.ts   # Shared 6-scenario harness reused by every backend
│   ├── claude-code/{manifest.ts,README.md,…}    # stdio stream-json
│   ├── codex/{manifest.ts,README.md,…}          # stdio JSON-RPC
│   └── kimi-cli/{manifest.ts,README.md,…}       # stdio stream-json (--print)
├── server/
│   ├── index.ts               # Hono server + launcher endpoints + WS routing
│   ├── routes/                # Export routes, deploy UI
│   ├── library-routes.ts      # /api/libraries/* (launcher-scope)
│   ├── agent-command-routes.ts # /api/agent-commands/* + /api/handoffs/external + /api/cli/* (launcher-scope)
│   ├── ws-bridge*.ts          # WS bridge to browsers (JSON); per-backend BridgeBackends in ws-bridge-{kimi,codex}.ts
│   ├── ws-bridge-backend.ts   # BridgeBackend interface
│   ├── skill-installer.ts     # Skill copy + template engine + instructions injection
│   └── shadow-git.ts          # Shadow git, per-turn checkpoint capture, bundle export
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # Root layout, dynamic viewer loading
│   ├── store/                 # Zustand store (10 protocol-aligned slices)
│   ├── hooks/                 # Reusable hooks (useFavorites, useThumbnailCapture, …)
│   ├── ws.ts                  # WebSocket client
│   └── components/            # Chat, permissions, launcher, replay, context panels
├── desktop/                   # Electron client
├── web/                       # Landing page (CF Pages)
├── snapshot/                  # R2 push/pull
└── docs/                      # Supplementary docs (reference/, adr/, archive/, …) — see docs/README.md
```

## Architecture

```
Layer 4: Mode Protocol     — ModeManifest (skill + viewer + agent config)
Layer 3: Content Viewer    — ViewerContract (render, select, agent-callable actions)
Layer 2: Agent Runtime     — AgentBackend + normalized session state + protocol bridge
Layer 1: Runtime Shell     — WS Bridge, HTTP, File Watcher, Session, Frontend
```

### Core Contracts

每一个契约都有：定义文件（design）→ 实例化点 → 消费端。这张表是 design → implementation 的目录；语义与 action space 完整展开在 `docs/reference/viewer-agent-protocol.md`，磁盘状态全景见 `docs/reference/controlled-state-surface.md`。

| Contract | Defined in | Instantiated | Consumed by |
|----------|------------|--------------|-------------|
| **ModeManifest** + `ViewerApiConfig` / `SkillConfig` / `InitConfig` / `SeedDescriptor` / `ProxyRoute` | `core/types/mode-manifest.ts` | Each mode's `modes/<name>/manifest.ts` (no React imports — read by both backend and frontend) | `core/mode-loader.ts::loadModeManifest()` → `server/skill-installer.ts` (skills + instructions assembly) + `core/source-registry.ts` (sources) + `server/index.ts` (proxy routes) + `server/seed-installer.ts::resolveSeedCatalog` (gallery cards from `init.seeds[]`, auto-derive from directory-shaped `seedFiles` when absent) |
| **ModeDefinition** = `{ manifest, viewer }` | `core/types/mode-definition.ts` | Each mode's `modes/<name>/pneuma-mode.ts` default export — binds manifest + ViewerContract | Frontend `core/mode-loader.ts` dynamic-imports it; the React tree mounts `viewer.PreviewComponent`. Split from `manifest.ts` so the latter can be loaded by the Bun backend (which has no React). |
| **ViewerContract** + `ViewerPreviewProps` | `core/types/viewer-contract.ts` | Each mode's `modes/<name>/viewer/<Name>Preview.tsx` (referenced from `pneuma-mode.ts`) | `core/mode-loader.ts` dynamic import → `src/App.tsx` mounts `PreviewComponent` with props injected from `src/store/` |
| **ModeShowcase** | `core/types/mode-manifest.ts` (declared); actual content in `modes/<name>/showcase/showcase.json` (sibling file, not inline in manifest) | Each mode's `showcase/showcase.json` + `hero.png` + 3-4 `highlight-*.png` | `server/index.ts` serves via `GET /api/modes/:name/showcase/*`; launcher gallery cards consume |
| **ViewerAddress** | `core/types/viewer-contract.ts` | Each mode's SKILL.md defines its vocabulary (`{slide}` / `{page,anchor,selector}` / …) | Viewer selection produces (⑥); `<viewer-locator>` + `capture` + `navigateRequest` consume (⑤) |
| **ViewerActionDescriptor** + `ViewerActionRequest` / `Result` | `core/types/viewer-contract.ts` | Mode `manifest.viewerApi.actions[]` | `server/skill-installer.ts` injects into `<!-- pneuma:viewer-api:* -->`; `server/ws-bridge-viewer.ts` dispatches; `src/store/viewer-slice.ts` 派发 to viewer; `src/hooks/useCaptureAction.ts` is the built-in `capture` implementation |
| **ViewerCommandDescriptor** | `core/types/viewer-contract.ts` | Mode `manifest.viewerApi.commands[]` | Runtime injects into `props.commands`; viewer renders command menu; click → `onNotifyAgent` → `server/ws-bridge.ts` |
| **ViewerSelectionContext** + `extractContext()` | `core/types/viewer-contract.ts` | Each viewer implements `extractContext` | `server/ws-bridge.ts` prefixes every `user_message` with `<viewer-context>` block |
| **ViewerNotification** | `core/types/viewer-contract.ts` | Viewer calls `props.onNotifyAgent()` | `server/ws-bridge.ts` buffers; flushes as system message on agent idle |
| **ViewerLocator** | `core/types/viewer-contract.ts` | Agent emits `<viewer-locator>` chat tag | `src/components/chat/*` renders card; click triggers `navigateRequest` |
| **Source\<T\>** + `SourceEvent<T>` + `SourceProvider` + `SourceContext` + `FileChannel` + `FileChangeEvent` + `SourceDescriptor` | `core/types/source.ts` | `core/source-registry.ts` picks provider by `kind` from `manifest.sources` | Built-in providers in `core/sources/{file-glob,json-file,aggregate-file,memory}.ts` (all extend `core/sources/base.ts` which enforces the four invariants); viewer subscribes via `src/hooks/useSource.ts` |
| **AgentBackend** + `AgentCapabilities` + `AgentSessionInfo` + `AgentLaunchOptions` | `core/types/agent-backend.ts` | Each backend's `manifest.ts::createBackend(port)` | `bin/pneuma.ts` boots one per session; `server/ws-bridge*.ts` drives lifecycle |
| **AgentProtocolAdapter** _(reserved/unused — see `BridgeBackend` row for the real seam)_ | `core/types/agent-backend.ts` | — (no production implementor) | — (no production consumer) |
| **BackendModule** | `core/types/agent-backend.ts` | One per backend: `backends/{claude-code,codex,kimi-cli}/manifest.ts` | `backends/index.ts` is a pure registry — no `if (type === ...)` outside this file |
| **BridgeBackend** | `server/ws-bridge-backend.ts` | `BackendModule.createBridgeBackend()` per non-Claude backend | `server/ws-bridge.ts` central bridge dispatches; Claude legacy NDJSON path returns `null` here |
| **ToolFileRef** | `backends/tool-file-ref.ts` | `BackendModule.toolFileRef(toolName, input)` | `server/file-ref.ts::stampFileRefs` decorates `tool_use` blocks; front-end `FilePreview` + `ToolFileActions` (open / editor / reveal via `/api/system/*`) consume |
| **EvolutionConfig** | `core/types/mode-manifest.ts` | Mode `manifest.evolution` | `server/evolution-routes.ts` + Evolution mode |
| **SharedHistoryPackage** | `core/types/shared-history.ts` | `pneuma history export/share` produces | `pneuma history open` + replay flow consumes |
| **PluginManifest** | `core/types/plugin.ts` | Each plugin's `manifest.ts` (`plugins/<name>/`) | `core/plugin-registry.ts` (discovery + lifecycle), `core/hook-bus.ts` (waterfall events), `core/settings-manager.ts` (settings) |
| **ProjectManifest** | `core/types/project-manifest.ts` | `<projectRoot>/.pneuma/project.json` | `core/project-loader.ts::detectWorkspaceKind()`; `server/handoff-routes.ts`; ProjectPanel / EmptyShell on front-end |

### Plugin System

为 deploy workflow、metadata 注入、未来扩展提供的开放架构。

- **核心：** `PluginRegistry`（discovery + lifecycle）、`HookBus`（waterfall events）、`SettingsManager`（config 持久化）
- **来源：** builtin（`plugins/`）、external（`~/.pneuma/plugins/`，`pneuma plugin add`）
- **四类扩展点（全部 opt-in）：**
  - **Hooks**：`deploy:before/after`、`session:start/end`、`export:before/after` —— waterfall payload 突变
  - **Slots**：`deploy:pre-publish`、`deploy:provider` —— UI 注入
  - **Routes**：Hono sub-app 挂到 `/api/plugins/{name}/*`
  - **Settings**：schema-driven，自动渲染，持久化到 `~/.pneuma/settings.json`
- **Soft error**：plugin 任何环节失败都被捕获 + 日志，主流程不挂

### Communication

- **浏览器 ↔ Server**：`/ws/browser/:sessionId`（JSON）
- **Server ↔ Backend**：所有后端跑 stdio（Claude/Kimi 是 stdio NDJSON，Codex 是 stdio JSON-RPC）；浏览器 ↔ backend 桥接走 `BridgeBackend` 实现
- **文件变化**：chokidar → WS push 到浏览器，事件携 `origin: "self" | "external"`（服务端 `pendingSelfWrites` 在源头标记）
- **Session init**：携 `backend_type` / `agent_capabilities` / `agent_version`，前端据此 feature-gate
- **`tool_use` 带 `fileRef`**：服务端 `stampFileRefs`（`server/file-ref.ts`）通过 `BackendModule.toolFileRef` 归一化为 `{ path, kind }`；Chat 渲染 `FilePreview` + `ToolFileActions`（open/editor/reveal via `/api/system/*`），零 tool-name 知识

`/ws/cli/:sessionId` 是历史 Claude WS transport，保留供 legacy 调用——现役所有 backend 都跑 stdio。

## Mode Lifecycle

1. **Resolve** — 把 specifier（builtin / local / github / url）映射到含 `manifest.ts` 的磁盘路径（`core/mode-resolver.ts`）
2. **Load manifest** — `loadModeManifest()` → ModeManifest
3. **Session** — load 或 create `<sessionDir>/session.json`；quick session `sessionDir = workspace`，project session `sessionDir = <project>/.pneuma/sessions/<id>/`
4. **Skill install** — 把 `modes/<mode>/skill/` 复制到 backend-appropriate 目录，应用 `{{key}}` / `{{viewerCapabilities}}` 模板，拼装 marker blocks 写到指令文件
5. **Server start** — Hono HTTP + WebSocket + backend transport bridge
6. **Backend selection** — startup-only、workspace-locked
7. **Agent launch** — stdio per backend
8. **Frontend** — `mode-loader.ts` 动态 import；外部 mode 走 `registerExternalMode()` → `Bun.build()` → import map
9. **Preview loop** — Agent 编辑 → chokidar → WS → 浏览器 → viewer 渲染；用户选择 → `<viewer-context>` → agent

无 mode 参数 → Launcher（marketplace UI、Recent Sessions，子进程通过 `/api/launch` 派生）。

## Mode System

### Mode Sources（`core/mode-resolver.ts` 解析）

| 类型 | Specifier | 落盘路径 |
|------|-----------|---------|
| **builtin** | `webcraft`、`doc`、`slide` … | `modes/<name>/` |
| **local** | `/abs/path`、`./rel` | as-is |
| **github 单 mode** | `github:user/repo`，根目录有 `manifest.ts` | `~/.pneuma/modes/<user>-<repo>/` |
| **github library** | `github:user/repo`，根目录有 `pneuma.library.json` 或 N 个子目录每个含 `manifest.ts` | `~/.pneuma/libraries/<user>-<repo>/` |
| **url** | `https://….tar.gz` | `~/.pneuma/modes/<name>/`（或 libraries 若包是 library） |

一个 mode 包必含 `manifest.ts` 导出 `ModeManifest`。Library 检测发生在 **clone/extract 后**——不像 library 的 repo 走单 mode 路径，二者字节一致。

### Mode Libraries

多 mode GitHub repo。`pneuma mode add` 把整个 repo clone 到 `~/.pneuma/libraries/<id>/`；每个 mode 独立 activate、独立版本追踪，在 Mode Gallery 与 Quick Start 分别露出。

- `<id>` 默认为 `<user>-<repo>`
- `~/.pneuma/libraries/<id>/.library.json` 是消费侧 sidecar，保存版本、activation、installedVersion
- `<repo-root>/pneuma.library.json` 是可选作者侧 index；缺失时 resolver 自动扫描子目录

入口 API（`core/library-registry.ts`）：`linkLibrary` / `syncLibrary`（reconcile 而非自动接受更新）/ `setModeActivated` / `acceptModeUpdate` / `unlinkLibrary` / `getLibraryModePath`。作者侧（`core/library-publish.ts`）：`initLocalLibrary` / `publishModeToLibrary` / `pushLibrary`；`--github` on `library init` 委托 `core/github-cli.ts::createRepo`。

**Mode Gallery 呈现：** Libraries 排在 Local 与 Published 之间，每个 library 一条 identity 行（display name、source chip、last-synced）+ inline Sync / Publish / Unlink，然后展开 activated modes + 折叠 "N inactive modes"。Library-activated modes 在 Quick Start 通过 `/api/registry` `local[]` 出现，标记 `librarySource: { id, name, displayName? }`。

### Pneuma version 兼容（3.9.0）

外部 mode 作者在 `manifest.ts` 声明 `pneumaVersion`（semver range，例 `"^3.8.0"`）。Launcher 通过 `core/version-compat.ts::checkCompat` 预算每个 local 条目的兼容情况：

- **major-drift** → Gallery card 暗化 + 红 "Incompatible" chip + 二次确认；QuickStartTile 同样降级
- **minor-drift** → 琥珀色 chip（非阻塞）
- **match** / **unknown**（未声明）→ 原样渲染；机制 opt-in

`/api/registry` 上每个条目带 `compat: { level, declared, runtime, reason? }`；builtins 永不带 compat。解析优先级：per-mode `pneumaVersion` > sidecar cache > library-level fallback。

### Favorites（3.7.0）

`~/.pneuma/favorites.json`——所有 picker 把 favorites 排到最前。`src/hooks/useFavorites.ts` 提供 `useFavorites()`、`sortFavoritesFirst(...)`。原子写，optimistic toggle 带 write-sequence guard。

### Local Modes

`~/.pneuma/modes/` 下的外部 mode 通过 `pneuma mode add <url>` 安装；Launcher 扫描并展示在 "Local Modes" 下。`core/utils/manifest-parser.ts::parseManifestTs()` 用正则抽 metadata，不需 TS 求值。

## Sessions, Projects, State

完整的"Pneuma 在磁盘上管了什么"图谱见 [`docs/reference/controlled-state-surface.md`](docs/reference/controlled-state-surface.md)。下面只列契约层关键点。

### Session Registry

`~/.pneuma/sessions.json`（single source of truth；不自动扫盘）。Schema 3.0：`{ projects: ProjectRegistryEntry[], sessions: SessionRegistryEntry[] }`。每条 session 有 `kind: "quick" | "project"`。Legacy 2.x 数组格式读时自动升级。每次 launch / project create upsert；sessions 与 projects 各 cap 200（`upsertSession` / `upsertProject` 默认 `cap = 200`，prepend 后 slice）。Project 若掉出 registry，恢复路径有两条：(a) Create Project on same path → Open-or-Create 探测 `<root>/.pneuma/project.json`；(b) `pneuma project add <path>`。3.4.0 起去除了 `~/pneuma-projects/` 自动扫描——**registry 显式优于隐式恢复**。

### Running-Session Registry（3.5.1）

`~/.pneuma/running/`——pid-file，一进程一份（`bin/running-registry.ts`）。每个进程启动时写入、退出时清掉；读者裁掉死 PID / gone workspace。系统级"哪些 session 还活着"的真相，与 launcher 的 `childProcesses` map（只知道它自己派生的）正交——`/api/running` 读这个，所以 project 切换内部 mode 后 Continue surface 仍能反映当前 mode。

### User Preferences

Agent 维护的持久偏好。两个 scope 同一 schema：

- **个人**：`~/.pneuma/preferences/`（跨项目）
- **项目**：`<projectRoot>/.pneuma/preferences/`（仅项目内 session）
- **文件**：`profile.md`（跨 mode）+ `mode-{name}.md`（per-mode）
- **Marker**：`<!-- pneuma-critical:start/end -->`（hard constraint）+ `<!-- changelog:start/end -->`（更新日志）
- **注入**：个人 critical → `<!-- pneuma:preferences:start/end -->`；项目 critical → `<!-- pneuma:project:start/end -->`
- **Skill**：`pneuma-preferences`（所有 mode 全局）；`pneuma-project`（额外用于项目 session）；源在 `modes/_shared/skills/`

### Per-Session State

| File | Purpose |
|------|---------|
| `session.json` | sessionId、agentSessionId、mode、backendType、createdAt；可选 `displayName`/`description`/`refinedAt` |
| `history.json` | 消息历史（5 秒自动保存） |
| `config.json` | Init 参数 |
| `skill-version.json` | `{ mode, version }`——已装 skill 版本（用于更新检测） |
| `skill-dismissed.json` | `{ version }`——用户 dismiss 的更新 |
| `shadow.git/` | bare git，跟踪 workspace 每轮变化 |
| `checkpoints.jsonl` | 每行 `{ turn, ts, hash }` |
| `evolution/` | Evolution 提案、备份、CLAUDE.md 快照 |
| `deploy.json` | Deploy 绑定，按 contentSet 索引 |

### Session-meta refine（3.6.0）

每个 session 在 Recent Sessions 有一行；默认是 `"<Mode> session"` + 首条用户消息预览。`pneuma session refine --json '{...}'` 让 agent 在内容沉淀后重写 displayName + description；`pneuma-session` skill 教它 topic 维度而非 work-done 维度的措辞、并用 Task subagent 做异步非阻塞 refine。Route `POST /api/session/refine` 原子重写 session.json、同步 registry、广播 `session_meta_updated`。

### Skill Installation & Update Detection

Skills 复制到 backend-appropriate 目录。每个 backend 的 `manifest.ts` 直接暴露 `skillsDir` 与 `instructionsFile` 字段（属于 `BackendModule` 顶层）；server 端通过 `backends/index.ts::getInstallConventions(backendType)` 取到该 backend 的 `BackendModule` 实例，再读这两个字段：

- Claude：`.claude/skills/<installName>/` + `CLAUDE.md`
- Codex：`.agents/skills/<installName>/` + `AGENTS.md`
- Kimi：`.kimi/skills/<installName>/` + `AGENTS.md`（Kimi 也读 `AGENTS.md` + `.kimi/AGENTS.md`，不读 `CLAUDE.md`）

模板变量 `{{key}}` / `{{viewerCapabilities}}` 替换后，指令文件由一组**命名 marker block** 拼装（`<!-- pneuma:start/end -->` 主体 + `<!-- pneuma:viewer-api:* -->` + `<!-- pneuma:preferences:* -->` + `<!-- pneuma:project:* -->`（项目 only）+ `<!-- pneuma:project-atlas:* -->`（项目 only，pointer 而非 inline）+ `<!-- pneuma:handoff:* -->`（项目 only）+ `<!-- pneuma:evolved:* -->`（Evolution 写入）+ `<!-- pneuma:resumed:* -->`（replay 续档））。Mode 版本写到 `skill-version.json`，resume 时与 manifest 比对，不同且未 dismiss 即 inline 提示 "Skill update: X → Y"。

## Project Lifecycle (3.0)

Project 是用户目录，由 `<root>/.pneuma/project.json` 标记。多个 session 在不同 mode 下共享 `<root>/.pneuma/preferences/`，通过 Smart Handoff 协作。

### Detection

`core/project-loader.detectWorkspaceKind(workspace)` 看 `<workspace>/.pneuma/project.json` 是否存在；否则当 quick session。`--project <path>` 强制 project mode 并指定/创建 session id。

### Fresh-project onboarding（`project-onboard`）

用户打开 project URL（`?project=<root>`）若 sessions 为空且无 `onboardedAt`，`EmptyShell` 自动拉起隐藏的 `project-onboard`。Agent 挖掘目录（README、package manifest、视觉资产）后写一份 `proposal.json` 到 `<sessionDir>/onboard/`，Discovery Report viewer 渲染 hero + anchors + open questions + 两个 task card。`POST /api/projects/onboard/apply` 落盘 `project.json`（含 `onboardedAt`）、`project-atlas.md`、`cover.{png,jpg,jpeg,webp,svg}`。点击 task card 同步 mint target session、stage `inbound-handoff.json`、spawn target mode。Auto-trigger 一项目一次；`ProjectPanel` 的 **Re-discover** 可重跑。

### Environment Variables

每个 session 注入：`PNEUMA_SESSION_DIR`（agent CWD；`.claude/skills/`、`CLAUDE.md`、state 文件都在这）、`PNEUMA_HOME_ROOT`（project session 为 project root，quick 为 workspace）、`PNEUMA_SESSION_ID`。项目 session 额外注入 `PNEUMA_PROJECT_ROOT`。

### Cross-Mode Handoff Protocol

源 agent 调 `pneuma handoff --json '{...}'`（CLI 经 `PNEUMA_SERVER_URL` POST 到 `/api/handoffs/emit`）；server 把 proposal 存进内存 `Map<handoff_id, HandoffProposal>`（30-min TTL），通过 WS 广播 `handoff_proposed` 到源浏览器。HandoffCard 渲染 intent / summary / files / decisions / open questions。

- **Confirm**：server 原子写 `<targetSessionDir>/.pneuma/inbound-handoff.json`、best-effort kill 源 backend、记录 `switched_out` / `switched_in` 事件、spawn target。Target 的 skill installer 把 inbound JSON 装到 `pneuma:handoff` block；target agent 第一轮读完并 `rm`。
- **Cancel**：server 派一条 `<pneuma:handoff-cancelled reason="..." />` synthetic user message 回源 agent。

完整设计见 [`docs/archive/proposals/2026-04-28-handoff-tool-call.md`](docs/archive/proposals/2026-04-28-handoff-tool-call.md)；项目层全貌见 [`docs/archive/proposals/2026-04-27-pneuma-projects-design.md`](docs/archive/proposals/2026-04-27-pneuma-projects-design.md)。

## Agent Command Distribution (3.10.0)

`/handoff-pneuma` 是 Pneuma 安装到其他 code agent（Claude Code、Codex）里的 user-level slash command——让 agent 在 CC/Codex 内输入 `/handoff-pneuma "make a finance dashboard"` 就能把工作交给 Pneuma，用户全程不打开 launcher。

**安装位置：** Claude Code `~/.claude/commands/handoff-pneuma.md`；Codex `~/.codex/prompts/handoff-pneuma.md`。源模板 `templates/agent-commands/handoff-pneuma.md`。Marker 注释 `<!-- pneuma:agent-command version="X" backend="..." -->` 在 YAML frontmatter 下方（line 1 必须留给 `---`，否则 frontmatter parser 挂掉）标识我们拥有这文件；无 marker 视为用户手写、`--force` 之前不覆盖。Per-install state 在 `~/.pneuma/agent-commands.json`。

**两条路径：**
1. **CLI 路径** —— `command -v pneuma` 成功 → `pneuma handoff-from-external --intent ... --mode ...`。CLI 验 mode、按需写 `<cwd>/.pneuma/project.json`、mint session id、stage inbound handoff、挑空闲端口、`spawn pneuma <mode> --no-prompt --project <cwd> --session-id <id> --port <p>` detached、打印 URL。
2. **URL 协议路径** —— CLI 缺失但 macOS 桌面应用在 → agent 发 `open "pneuma://handoff?intent=...&mode=...&cwd=..."`。Electron 在 `desktop/src/main/index.ts::handlePneumaUrl` 处理 `handoff` case：POST 到 `<launcherUrl>/api/handoffs/external`，再开新 mode window。

两条路径最终都汇到 launcher 的同一个 Bun route，包装 `runHandoffFromExternal`（`bin/handoff-from-external-cli.ts`）—— stage + spawn 的 single source of truth。

**Inbound payload** schema 与 Smart Handoff 同（`InboundHandoffPayload`）。External handoff 设 `source_session_id = "external:<sourceAgent>"`、`source_mode = "external"`。Skill installer 把它注入 `pneuma:handoff` block；target agent 第一轮 read + rm。

**生命周期 UI：** Launcher boot 时 `bootstrapAgentCommandAutoUpdate` 静默 re-stamp 已装的过时文件（除非用户关 autoUpdate）。First-launch banner `<AgentCommandBanner />` 在 `promptDismissed=false && installed=empty` 时显示。设置面板 `<AgentCommandSettings />` 管理 install/update/uninstall + CLI symlink。

### Background Mode (3.12.0)

桌面专属。`pneuma://handoff` 默认在**隐藏 Electron 窗口** 里运行 session——`BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })`，WS 全程连通、正常渲染，用户看不见任何东西直到完成。从 CC / Codex 来的 handoff 因此变成 fire-and-forget。

**完成自动揭示：** 渲染端 `useBackgroundStatusReporter` 通过 IPC `pneuma:session-status` push `running` / `idle`；`background-sessions.ts` 按 `webContents.id` 关联到 session。首个 `running → idle`（≥1 turn 后）触发 `revealModeWindow`，并发系统 Notification 作辅助提示。

**容错：** 60s watchdog——session 不上报 `running` 则强制 reveal；`did-fail-load` 重试 `loadURL`（session server 启动后绑端口可能晚于 navigate）；renderer crash 也 reveal。坏掉的 background session 永远不会让用户卡死。**逃生口：** `&background=0` 强制前台。

服务端无任何变化——只是桌面端表现层差异。

## Launcher

无 mode 参数时启动（`bun run dev` / `pneuma`）。Marketplace UI：Recent Sessions、Recent Projects、Built-in Modes、Local Modes、Published Modes、Backend Picker。入口在 `server/index.ts` launcher block 与 `src/components/Launcher.tsx`。

## Server Routes

主路由在 `server/index.ts`；export 在 `server/routes/export.ts`；mode-specific 在 `server/{evolution,mode-maker}-routes.ts`；launcher-scope 路由在 `server/{library,agent-command}-routes.ts`。

WebSocket：`/ws/browser/:sessionId`（JSON）、`/ws/cli/:sessionId`（NDJSON，legacy 兼容）、`/ws/terminal/:terminalId`（binary）。三个 backend 都跑 stdio，不直接走 WS。

Key endpoints：

- `GET /api/file?path=<abs>` — workspace-contained file reads（chat 图片预览）
- `GET /api/running` — 系统级所有 running sessions（每条带 current mode + optional `thumbnailUrl`）
- `POST /api/session/thumbnail` — base64 PNG → `<stateDir>/thumbnail.png`
- `GET/POST /api/favorites` — pinned-modes
- `GET /api/github/status` — `{ installed, authenticated, username?, version?, hint? }` from `gh` probe
- `/api/libraries/*`（launcher-only）—— CRUD library + 广播 `libraries_updated`，使 library-activated mode 在 Quick Start 即时生效
- `/api/agent-commands/*` + `/api/handoffs/external` + `/api/cli/*`（launcher-only）—— 见 Agent Command Distribution
- `GET /api/seeds/list` + `POST /api/seeds/apply` + `GET /api/mode/seed-gallery/*` —— per-session gallery endpoints (seed catalog, copy one or many entries from `init.seedFiles`, serve thumbnail assets). `apply` body accepts `sourceKey: string | string[]` so a single card can copy a multi-file bundle. Copy logic in `server/seed-installer.ts::copySeedEntry`.
- `POST /api/contentsets/delete` —— removes a top-level content-set subdir under the workspace with traversal + `_`-prefix guards.
- 原生桌面 API（`/api/native/*`）只在 Electron 可用：Server → WS `native_request` → Browser → Electron IPC → result → WS `native_result`。Web 返回 `{ available: false }`。

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
2. `desktop/package.json` — `"version"`, **must equal** `package.json` 的值。`electron-updater` 用它比较运行中的桌面应用与最新 release；3.10.0 之前 desktop 滞后导致用户从未看到升级提示。3.10.3 起两者绑定，**只 bump 一份就是 bug**。
3. `CLAUDE.md` — `**Version:**` 行
4. `AGENTS.md` —— 必须与 `CLAUDE.md` byte-identical。`cp CLAUDE.md AGENTS.md` 即可。Codex 与 Kimi 各自读自己 filename 的指令文件，但我们不让两份内容分叉——runtime 对所有 backend 是同一份。
5. `CHANGELOG.md` — new section

然后 `git push origin main`（不带 `--tags`）。CI 建 tag、发 release、publish。

## Known Gotchas

- **Seed gallery auto-derive is directory-only**（3.15.0）：when a mode's `init.seeds[]` is absent, `resolveSeedCatalog` surfaces only `seedFiles` entries that are directory-shaped (src/dst ends with `/`, or dst is `./`/`""`). Single-file entries (e.g. invoice-organization's `profile.json`) are treated as framework setup and dropped — they would otherwise show up as meaningless gallery cards. Modes that genuinely want a single-file template MUST declare it explicitly via `init.seeds[]`. The frontend's `hasSeedsDeclared` check in `App.tsx` mirrors this rule; keep the two in sync.
- **Gallery dismissal sources** (3.15.0): the empty-state gallery clears on either (a) `userContentCount > 0` (auto-dismiss when agent / seed-apply produces real content — the filter excludes `.pneuma/.claude/.agents/.kimi/_*` and `CLAUDE.md`/`AGENTS.md`/`.gitignore`), or (b) `galleryDismissedByUser = true` set by the explicit "或直接开始对话 →" button. There is intentionally no click-outside-to-close — TopBar clicks, chat focus, etc. must NOT dismiss.
- **`ViewerPreviewProps.files` is a deprecated compat shim** (3.15.0): the new contract is `sources` + `fileChannel`; `files: ViewerFileContent[]` is still populated by `useViewerProps` so pre-2.29 external modes don't crash on `props.files.find(...)`. Do not use it in new viewers — `useSource(sources.files)` is the supported path. Will be removed in a future major.
- **`pneuma handoff-from-external` detached spawn**：必须给子进程传 `--no-prompt`。`stdio: "ignore"` + `detached: true` 下子进程没有 stdin；任何 `init.params` prompt（例 webcraft 的 fal.ai key）都会永久阻塞。
- **Machine-readable CLI subcommands bypass `p.intro()`**：`agent-command`、`mode list --local`、`handoff-from-external` 在 `bin/pneuma.ts:main()` 里**先于** clack `p.intro(...)` banner dispatch；否则 banner 污染 stdout 让 agent 侧 `JSON.parse` 挂掉。未来任何 stdout 被 agent 消费的子命令都得照办。
- **Agent-command marker placement**：`<!-- pneuma:agent-command version="..." backend="..." -->` marker 放在 YAML frontmatter（`---`）**下方**，不是 line 1。Claude Code 与 Codex 都要求 frontmatter 从 line 1 起；line-1 HTML 注释会让 `description` / `argument-hint` 解析挂掉。Installer 全文扫，不只 line 1。
- **Bun `os.homedir()` 启动时缓存**：boot 后改 `process.env.HOME` 不会改 `homedir()` 返回值。测试需要 tmp home 的模块（`core/agent-command-installer.ts`）改读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`。
- **chokidar glob**：watch 目录路径，回调里 filter。**不要** `watch("**/*.md", { cwd })`。
- **react-resizable-panels v4.6**：`Group` 不是 `PanelGroup`，`Separator` 不是 `PanelResizeHandle`，`orientation` 不是 `direction`。
- **Vite WS proxy + Bun.serve**：浏览器 WS 直连 backend 端口，绕开 Vite。
- **Stale `dist/`**：若 `dist/index.html` 存在，server 退回 production 模式。要么删 `dist/`，要么传 `--dev`。Launcher 派生子进程自动继承 `--dev`。
- **Bun.serve dual-stack**：必须 `hostname: "0.0.0.0"`，否则 macOS IPv6/IPv4 端口碰撞。
- **Backend persistence**：`backendType` 在 `.pneuma/session.json` 和 `~/.pneuma/sessions.json` 都是 resume identity 的一部分。
- **Empty assistant messages**：`MessageBubble` 在 content 为空时返回 null（纯 tool_use 消息）。
- **modelUsage cumulative**：用 delta（current - previous）算 per-turn cost。
- **`backdrop-filter` containing block**：会为 fixed-position 子元素创建 containing block，在 Excalidraw 里造成坐标偏移。避开或显式处理。
- **`@zumer/snapdom`**：调用期间 capture iframe 必须 `display: none`——可见 iframe 会导致 foreignObject 文本 reflow。见 `useSlideThumbnails.ts` 和 `export.ts`。
- **snapdom 必须在目标元素自己的 window 里跑**（3.16.1）：用外层 window 的 snapdom 去栅格化 *同源 iframe 内部* 的元素时，iframe 自己文档里的 CSS 变量、`@font-face`、SVG 画笔服务器（`fill="url(#grad)"`）都解析不到——渐变/`var()` 填充塌回 SVG 默认黑、webfont 回退。修法是把 snapdom 注入 iframe 内运行（`src/utils/iframe-snapdom.ts::snapdomFor()` 封装：往同源 iframe 注 `/vendor/snapdom.js` 再取 `iframe.contentWindow.snapdom`，主文档元素或无法注入时回退外层）。kami `capturePages` 是先例；`export.ts` 的 webcraft Screenshot PNG / slide Image-mode 因是服务端拼的脚本字符串、用等价内联写法。捕获主文档元素的（GridBoard、`useThumbnailCapture`）外层 snapdom 本就正确，不要改。
- **Session thumbnail capture**（`src/hooks/useThumbnailCapture.ts`）：优先级 viewer `captureViewport()` → Electron `pneumaDesktop.capturePage(rect)`（唯一能看到 iframe 内容的路径，例如 webcraft / mode-maker Play）→ snapdom（仅 browser dev；不含 iframe 内容）。等有限 CSS 动画 settle；mount + file change 后用渐进 timer；near-uniform 帧丢弃。空 Electron capture 不用 snapdom 补——后者把 iframe 渲染成白矩形，比 mode-icon fallback 更糟。
- **GridBoard JSX tag limitation**：tile compiler（Babel + eval）不能把本地定义的 component 当 JSX tag 解析。用 `{renderMyComponent(...)}` 函数调用。
- **Shadow-git checkpoint queue**：所有 checkpoint 操作通过 Promise chain 串行化，防 `index.lock` 冲突。**不要并行**。
- **Backend 后端 README**：Claude `backends/claude-code/README.md`、Codex `backends/codex/README.md`、Kimi `backends/kimi-cli/README.md` —— 协议细节、生命周期 quirks、版本兼容分支都在各自 README 里。
- **Replay**：(1) `--replay` 推迟 agent 启动到 `/api/replay/continue`，server 持 `replayContinueCallback`。(2) 每次 checkout 前清 `.pneuma/replay-checkout/`；Continue Work 把终点 checkpoint 解压到 workspace root。(3) 文件 navigation 必须在 checkpoint 加载**之后**（不能在 `displayMessage` 期间），因为 content sets 要等 `setFiles` 完成。
- **Proxy**：(1) `proxy.json` 通过 chokidar 热加载。(2) 默认只放行 GET——POST/PUT/PATCH 要求显式 `"methods"`。(3) Bun `fetch()` 自动解压 gzip/br；proxy 必须剥 `content-encoding` 防双重解压。
- **Editing/readonly distinction**：`editing` 是 session 布尔（`true`=创作，`false`=消费）。Mode 通过 `editing: { supported: true }` opt-in。`false` 时不跑 agent；切到 `true` 触发 skill install + agent spawn；切回又 kill。`readonly`（replay）禁用一切交互；`editing: false` 只隐藏 Pneuma 编辑 UI，内容内部交互仍工作。
- **Windows 兼容**：跨平台支持散在 `path-resolver.ts`（`where` vs `which`，PATH 从 `LOCALAPPDATA`/`APPDATA`）、`terminal-manager.ts`（`COMSPEC`/`cmd.exe`）、`system-bridge.ts`（`cmd /c start`）、`server/index.ts`（`NUL`、`taskkill`）。win32 路径比较不区分大小写。
- **Native bridge timeout**：经浏览器 WS 路由——若无浏览器 tab 连接，native call 10s 超时。
- **Editor-open env 必须 sanitize**（`server/editor-bridge.ts::cleanEditorEnv`）：`open-in-editor` 走 CLI-first（bundled `cursor`/`code` 启动器）。当 Pneuma 从 VS Code / Cursor 集成终端或桌面 Electron 启动时，会继承 `VSCODE_IPC_HOOK_CLI` / `VSCODE_GIT_*` / `GIT_ASKPASS` / `ELECTRON_RUN_AS_NODE` 等注入变量；bundled `cursor` 启动器读到 `VSCODE_IPC_HOOK_CLI` 会切到 remote-IPC 模式，最新版 Cursor 走这条路打开文件直接崩 AgentPanel（`Cannot read properties of undefined (reading 'trim')`）。spawn 启动器前必须剥掉这一族变量，让它走干净的本地 electron 打开路径。
- **Diagram viewer**：见 `modes/diagram/viewer/DiagramPreview.tsx` 头部注释（native events、SVG pointer-events、sketch injection、rough.js 加载顺序）。
- **Handoff confirm 不能 kill 自己 session**：`killActiveSession(sourceSessionId)` 跑在源 session 自己的 server 里，但源进程是 launcher 直接派生而非自己派生——源 backend 继续跑。`switched_out` 仍记，target 正常起。3.5.3 缓解：桌面 mode-window 追踪所有它导航到过的 URL，关闭时按端口对照 `/api/running` 批量 teardown；`/api/processes/children/:pid/kill` 阶梯式 SIGTERM→SIGKILL 防卡死。
- **Project session 状态污染 if `--project` 丢失**：subcommand 不解析 `--project` 会把状态写进 project root 与项目层冲突。所有内置 subcommand（含 `evolve`）都尊重 `--project`；外部 mode 作者必须照办。
- **Empty shell 没有 `modeViewer`**：`?project=<root>`（无 `session`、无 `mode`）→ `EmptyShell` mount `TopBar` 但无 session。`TopBar` 把 tabs row、share dropdown、editing toggle gate 在 `!!modeViewer`；左侧 chip strip 不受影响。任何新 TopBar feature 都要防 `modeViewer` 为 null。`ProjectChip` 从 `EmptyShell` 经 `/api/projects/:id/sessions` 拿到的 `projectContext` 读。
- **TopBar drag region in launcher-reused windows**：`TopBar` 是 `WebkitAppRegion: "drag"`；三个 pill 子容器（左 chip strip、中 tabs、右 share/edit）是 `no-drag`。这是因为 launcher 的 `window.location.href` 流复用 launcher `BrowserWindow` 给 session 用——窗口仍是 `titleBarStyle: "hiddenInset"` + `trafficLightPosition: { y: 18 }`，macOS Sequoia 的系统级 drag inset 扩到 ~y=56 吃掉 TopBar pill 上沿点击。任何新加在 TopBar 根下的可点元素都要带 `no-drag`（或落在已有 `no-drag` 子容器里）。
- **Project session id vs backend id**：`<projectRoot>/.pneuma/sessions/<id>/session.json` 顶层 `sessionId` 是**项目 session id**（= 目录名 = URL `--session-id`）。Backend 协议 id 存在 `agentSessionId`。`scanProjectSessions` 在 `sessionId` 缺失时回退到目录名（防御 pre-fix sessions）。重开 session 用项目 session id；CLI ↔ backend 路由用 `agentSessionId`。**绝不让 backend id 泄漏到 registry / panel** 否则解析到不存在的目录。
- **Launcher 没 agent session，WS 广播到不了**（3.7.0）：`WsBridge.broadcastAll` 按 per-session 浏览器 socket 遍历；launcher main page 在任何 session 存在之前就 mount。Library-routes（及未来任何 launcher-scope mutation）必须在本地 dispatch `pneuma:libraries-updated` DOM event；launcher 的 window-event listener fanout 到 `refreshLibraries()` + `refreshModes()`。真实 session 内的 sibling tab 仍走 WS——两条路径汇到同一事件名。
- **`line-clamp` 需要 `display: -webkit-box`**，Tailwind `block` 在源码顺序中会覆盖（3.7.0）：`block` 配 `line-clamp-N` 会静默失效。`QuickStartTile` 因 Guizang Ppt 的超长描述发现这点。删掉 `block`；line-clamp 自带 display 规则。
- **React key collision for same-named modes**（3.7.0）：一个 builtin（`slide`）evolve 出 `slide-evolved-*` 通常仍 `name: "slide"`。用 `mode.name` 当 React key 会在 `builtins[]` + `local[]` 里冲突，per-tile 状态只渲染到一个 tile。任何 builtin + local 混排的列表把 key 组合成 `${source}::${path || name}`。
