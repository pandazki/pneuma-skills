# Pneuma Skills

> **Single source of truth for agent instructions.** Claude Code reads this via the one-line `@AGENTS.md` import in `CLAUDE.md`; Codex and Kimi read this file directly. Never duplicate content into `CLAUDE.md` — it must stay a single import line.
>
> Per-domain constraints and gotchas live in `.claude/rules/` — **before editing files in a domain, read the matching rule file** (Claude Code auto-loads them by path; other agents must read them explicitly). Index in [Development Toolchain](#development-toolchain-claude).

## Project Overview

Pneuma Skills is co-creation infrastructure for humans and code agents. Agents edit files directly (Read/Edit/Write); files remain the canonical collaboration surface. Viewers are live **players** for agent output, rendering work in domain terms (a deck, a board, a project) so humans can watch, intervene in the UI, or hand structured guidance back. Four pillars: a **visual environment** (live players with optional participation), **skills** (domain knowledge + seed templates + session persistence), **continuous learning** (evolution agent for cross-session preference extraction), and **distribution** (mode marketplace, publishing, sharing). Multiple agent backends (Claude Code, Codex, Kimi CLI) selected at startup.

**Formula:** `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`

**Version:** 3.26.0
**Runtime:** Bun >= 1.3.5 (required, not Node.js)
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `kami`, `clipcraft`, `cosmos`, `wordtaste`, `mode-maker`, `evolve`, `project-evolve`, `project-onboard`, `project-tidy`

> Modes can set `hidden: true` to disappear from user-pickable lists (launcher grids, ProjectPanel mode-tile picker). Their sessions are also stamped `internal: true` by `scanProjectSessions` and filtered out of user-facing session lists (project panel, project cards, quick-resume). Internal modes (`evolve`, `project-evolve`, `project-onboard`, `project-tidy`) are hidden — triggered by specific UI affordances or programmatically, never by a "what mode to start?" choice.

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
| Agent | Claude Code CLI stdio stream-json; Codex CLI `app-server` stdio JSON-RPC; Moonshot Kimi Code CLI ACP stdio JSON-RPC (`kimi acp`) — all via `node:child_process` |

## CLI Commands

```bash
# Development
bun run dev              # Launcher UI (no mode arg)
bun run dev doc          # Doc Mode (cwd as workspace)
bun run dev doc --workspace ~/notes --port 17996 --backend claude-code --no-open --debug
bun run build            # Vite production build
bun run typecheck        # tsc --noEmit
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
- Dev: 浏览器走 Vite,WebSocket 直连 backend,绕开 Vite WS proxy
- Launcher 派生子进程时端口自动递增;详细拓扑见 `docs/reference/network-topology.md`

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
│   └── kimi-cli/{manifest.ts,README.md,…}       # ACP JSON-RPC over stdio (kimi acp)
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
├── .claude/                   # Dev toolchain: rules/, agents/, workflows/, commands/, skills/create-mode/
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

每一个契约都有:定义文件(design)→ 实例化点 → 消费端。这张表是 design → implementation 的目录;语义与 action space 完整展开在 `docs/reference/viewer-agent-protocol.md`,磁盘状态全景见 `docs/reference/controlled-state-surface.md`。

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
| **`BorrowDispatchPayload` + `BorrowResult` + `BorrowLink`** (round-trip cross-mode handoff — see ADR-015) | `core/types/borrow.ts` (`isBorrowResult` guard + `normalizeBorrowScope` + `MAX_CONCURRENT_BORROWS_PER_SESSION`) | dispatch built by `bin/borrow-cli.ts` (`pneuma borrow`) → `server/borrow-routes.ts` `/api/borrows/dispatch` writes `<Bdir>/.pneuma/borrow-brief.json` + records `BorrowLink` in the per-session `Map<borrow_id, BorrowLink>`; result written by `pneuma borrow-return` → `/api/borrows/return` to `<Bdir>/borrow-result.json` | `server/skill-installer.ts` (brief → B's `pneuma:handoff` block); `bin/env-tag.ts` (`reason="borrow"` start signal); `server/ws-bridge.ts` (queued `<pneuma:borrow-returned>` return tag, idle-flush); `pneuma-project` skill (semantic layer, both sides). *Instantiation/consumption land in tasks B2–B5; the contract type + ADR ship first.* |

### Plugin System

为 deploy workflow、metadata 注入、未来扩展提供的开放架构。

- **核心:** `PluginRegistry`(discovery + lifecycle)、`HookBus`(waterfall events)、`SettingsManager`(config 持久化)
- **来源:** builtin(`plugins/`)、external(`~/.pneuma/plugins/`,`pneuma plugin add`)
- **四类扩展点(全部 opt-in):**
  - **Hooks**:`deploy:before/after`、`session:start/end`、`export:before/after` —— waterfall payload 突变
  - **Slots**:`deploy:pre-publish`、`deploy:provider` —— UI 注入
  - **Routes**:Hono sub-app 挂到 `/api/plugins/{name}/*`
  - **Settings**:schema-driven,自动渲染,持久化到 `~/.pneuma/settings.json`
- **Soft error**:plugin 任何环节失败都被捕获 + 日志,主流程不挂

### Communication

- **浏览器 ↔ Server**:`/ws/browser/:sessionId`(JSON)
- **Server ↔ Backend**:所有后端跑 stdio(Claude 是 stdio NDJSON,Codex 是 stdio JSON-RPC,Kimi 是 ACP stdio JSON-RPC);浏览器 ↔ backend 桥接走 `BridgeBackend` 实现
- **文件变化**:chokidar → WS push 到浏览器,事件携 `origin: "self" | "external"`(服务端 `pendingSelfWrites` 在源头标记)
- **Session init**:携 `backend_type` / `agent_capabilities` / `agent_version`,前端据此 feature-gate
- **`tool_use` 带 `fileRef`**:服务端 `stampFileRefs`(`server/file-ref.ts`)通过 `BackendModule.toolFileRef` 归一化为 `{ path, kind }`;Chat 渲染 `FilePreview` + `ToolFileActions`(open/editor/reveal via `/api/system/*`),零 tool-name 知识
- **跨模式 chat-tag 信号**:`<pneuma:request-handoff>` / `<pneuma:handoff-cancelled>`(goto 交接)与 `<pneuma:request-borrow>` / `<pneuma:borrow-returned>`(往返借用,见 Borrow)都走同一条 chat-tag 注入管道;`borrow-returned` 是**排队**通知(rides `pendingNotifications`,A idle 时 flush,绝不打断 A 某一轮中间)

`/ws/cli/:sessionId` 是历史 Claude WS transport,保留供 legacy 调用——现役所有 backend 都跑 stdio。

## Mode Lifecycle

1. **Resolve** — 把 specifier(builtin / local / github / url)映射到含 `manifest.ts` 的磁盘路径(`core/mode-resolver.ts`)
2. **Load manifest** — `loadModeManifest()` → ModeManifest
3. **Session** — load 或 create `<sessionDir>/session.json`;quick session `sessionDir = workspace`,project session `sessionDir = <project>/.pneuma/sessions/<id>/`
4. **Skill install** — 把 `modes/<mode>/skill/` 复制到 backend-appropriate 目录,应用 `{{key}}` / `{{viewerCapabilities}}` 模板,拼装 marker blocks 写到指令文件
5. **Server start** — Hono HTTP + WebSocket + backend transport bridge
6. **Backend selection** — startup-only、workspace-locked
7. **Agent launch** — stdio per backend
8. **Frontend** — `mode-loader.ts` 动态 import;外部 mode 走 `registerExternalMode()` → `Bun.build()` → import map
9. **Preview loop** — Agent 编辑 → chokidar → WS → 浏览器 → viewer 渲染;用户选择 → `<viewer-context>` → agent

无 mode 参数 → Launcher(marketplace UI、Recent Sessions,子进程通过 `/api/launch` 派生)。

## Mode System

### Mode Sources(`core/mode-resolver.ts` 解析)

| 类型 | Specifier | 落盘路径 |
|------|-----------|---------|
| **builtin** | `webcraft`、`doc`、`slide` … | `modes/<name>/` |
| **local** | `/abs/path`、`./rel` | as-is |
| **github 单 mode** | `github:user/repo`,根目录有 `manifest.ts` | `~/.pneuma/modes/<user>-<repo>/` |
| **github library** | `github:user/repo`,根目录有 `pneuma.library.json` 或 N 个子目录每个含 `manifest.ts` | `~/.pneuma/libraries/<user>-<repo>/` |
| **url** | `https://….tar.gz` | `~/.pneuma/modes/<name>/`(或 libraries 若包是 library) |

一个 mode 包必含 `manifest.ts` 导出 `ModeManifest`。Library 检测发生在 **clone/extract 后**——不像 library 的 repo 走单 mode 路径,二者字节一致。

### Mode Libraries

多 mode GitHub repo。`pneuma mode add` 把整个 repo clone 到 `~/.pneuma/libraries/<id>/`;每个 mode 独立 activate、独立版本追踪,在 Mode Gallery 与 Quick Start 分别露出。

- `<id>` 默认为 `<user>-<repo>`
- `~/.pneuma/libraries/<id>/.library.json` 是消费侧 sidecar,保存版本、activation、installedVersion
- `<repo-root>/pneuma.library.json` 是可选作者侧 index;缺失时 resolver 自动扫描子目录

入口 API(`core/library-registry.ts`):`linkLibrary` / `syncLibrary`(reconcile 而非自动接受更新)/ `setModeActivated` / `acceptModeUpdate` / `unlinkLibrary` / `getLibraryModePath`。作者侧(`core/library-publish.ts`):`initLocalLibrary` / `publishModeToLibrary` / `pushLibrary`;`--github` on `library init` 委托 `core/github-cli.ts::createRepo`。

**Mode Gallery 呈现:** Libraries 排在 Local 与 Published 之间,每个 library 一条 identity 行(display name、source chip、last-synced)+ inline Sync / Publish / Unlink,然后展开 activated modes + 折叠 "N inactive modes"。Library-activated modes 在 Quick Start 通过 `/api/registry` `local[]` 出现,标记 `librarySource: { id, name, displayName? }`。

### Pneuma version 兼容(3.9.0)

外部 mode 作者在 `manifest.ts` 声明 `pneumaVersion`(semver range,例 `"^3.8.0"`)。Launcher 通过 `core/version-compat.ts::checkCompat` 预算每个 local 条目的兼容情况:

- **major-drift** → Gallery card 暗化 + 红 "Incompatible" chip + 二次确认;QuickStartTile 同样降级
- **minor-drift** → 琥珀色 chip(非阻塞)
- **match** / **unknown**(未声明)→ 原样渲染;机制 opt-in

`/api/registry` 上每个条目带 `compat: { level, declared, runtime, reason? }`;builtins 永不带 compat。解析优先级:per-mode `pneumaVersion` > sidecar cache > library-level fallback。

### Favorites(3.7.0)

`~/.pneuma/favorites.json`——所有 picker 把 favorites 排到最前。`src/hooks/useFavorites.ts` 提供 `useFavorites()`、`sortFavoritesFirst(...)`。原子写,optimistic toggle 带 write-sequence guard。

### Local Modes

`~/.pneuma/modes/` 下的外部 mode 通过 `pneuma mode add <url>` 安装;Launcher 扫描并展示在 "Local Modes" 下。`core/utils/manifest-parser.ts::parseManifestTs()` 用正则抽 metadata,不需 TS 求值。

## Sessions, Projects, State

完整的"Pneuma 在磁盘上管了什么"图谱见 [`docs/reference/controlled-state-surface.md`](docs/reference/controlled-state-surface.md)。下面只列契约层关键点。

### Session Registry

`~/.pneuma/sessions.json`(single source of truth;不自动扫盘)。Schema 3.0:`{ projects: ProjectRegistryEntry[], sessions: SessionRegistryEntry[] }`。每条 session 有 `kind: "quick" | "project"`。Legacy 2.x 数组格式读时自动升级。每次 launch / project create upsert;sessions 与 projects 各 cap 200(`upsertSession` / `upsertProject` 默认 `cap = 200`,prepend 后 slice)。Project 若掉出 registry,恢复路径有两条:(a) Create Project on same path → Open-or-Create 探测 `<root>/.pneuma/project.json`;(b) `pneuma project add <path>`。3.4.0 起去除了 `~/pneuma-projects/` 自动扫描——**registry 显式优于隐式恢复**。

### Running-Session Registry(3.5.1)

`~/.pneuma/running/`——pid-file,一进程一份(`bin/running-registry.ts`)。每个进程启动时写入、退出时清掉;读者裁掉死 PID / gone workspace。系统级"哪些 session 还活着"的真相,与 launcher 的 `childProcesses` map(只知道它自己派生的)正交——`/api/running` 读这个,所以 project 切换内部 mode 后 Continue surface 仍能反映当前 mode。

### User Preferences

Agent 维护的持久偏好。两个 scope 同一 schema:

- **个人**:`~/.pneuma/preferences/`(跨项目)
- **项目**:`<projectRoot>/.pneuma/preferences/`(仅项目内 session)
- **文件**:`profile.md`(跨 mode)+ `mode-{name}.md`(per-mode)
- **Marker**:`<!-- pneuma-critical:start/end -->`(hard constraint)+ `<!-- changelog:start/end -->`(更新日志)
- **注入**:个人 critical → `<!-- pneuma:preferences:start/end -->`;项目 critical → `<!-- pneuma:project:start/end -->`
- **Skill**:`pneuma-preferences`(所有 mode 全局);`pneuma-project`(额外用于项目 session);源在 `modes/_shared/skills/`

### Per-Session State

| File | Purpose |
|------|---------|
| `session.json` | sessionId、agentSessionId、mode、backendType、createdAt;可选 `displayName`/`description`/`refinedAt` |
| `history.json` | 消息历史(5 秒自动保存) |
| `config.json` | Init 参数 |
| `skill-version.json` | `{ mode, version }`——已装 skill 版本(用于更新检测) |
| `skill-dismissed.json` | `{ version }`——用户 dismiss 的更新 |
| `shadow.git/` | bare git,跟踪 workspace 每轮变化 |
| `checkpoints.jsonl` | 每行 `{ turn, ts, hash }` |
| `evolution/` | Evolution 提案、备份、CLAUDE.md 快照 |
| `deploy.json` | Deploy 绑定,按 contentSet 索引 |

### Session-meta refine(3.6.0)

每个 session 在 Recent Sessions 有一行;默认是 `"<Mode> session"` + 首条用户消息预览。`pneuma session refine --json '{...}'` 让 agent 在内容沉淀后重写 displayName + description;`pneuma-session` skill 教它 topic 维度而非 work-done 维度的措辞、并用 Task subagent 做异步非阻塞 refine。Route `POST /api/session/refine` 原子重写 session.json、同步 registry、广播 `session_meta_updated`。

### Skill Installation & Update Detection

Skills 复制到 backend-appropriate 目录。每个 backend 的 `manifest.ts` 直接暴露 `skillsDir` 与 `instructionsFile` 字段(属于 `BackendModule` 顶层);server 端通过 `backends/index.ts::getInstallConventions(backendType)` 取到该 backend 的 `BackendModule` 实例,再读这两个字段:

- Claude:`.claude/skills/<installName>/` + `CLAUDE.md`
- Codex:`.agents/skills/<installName>/` + `AGENTS.md`
- Kimi:`.kimi-code/skills/<installName>/` + `AGENTS.md`(Kimi Code 读 `AGENTS.md`,不读 `CLAUDE.md`;旧 `.kimi/skills/` 新 binary 不读)

**Session-scoped slash commands**:`BackendModule` 多了一个可选的 `commandsDir`。Claude Code 把 `<cwd>/.claude/commands/*.md` 当原生 `slash_commands` 在 `system.init` stream-json 事件里上报,因此 installer 会把 `templates/session-commands/borrow.md` 复制到 `<installTarget>/.claude/commands/borrow.md`——它在 in-session chat 输入框里以 `/borrow` 出现(quick + project session 都装)。Codex 把它的 *skills*(非 project command 文件)映射成 slash_commands、Kimi(ACP `available_commands_update` 上报的是它自己的命令与 skills,不读 project command 文件),所以两者 `commandsDir` 留空、installer 这一步直接跳过。**Gate 在 `commandsDir` 字段而非 backend 条件判断**——没有 `if (backendType === ...)`。

模板变量 `{{key}}` / `{{viewerCapabilities}}` 替换后,指令文件由一组**命名 marker block** 拼装(`<!-- pneuma:start/end -->` 主体 + `<!-- pneuma:viewer-api:* -->` + `<!-- pneuma:preferences:* -->` + `<!-- pneuma:project:* -->`(项目 only)+ `<!-- pneuma:project-atlas:* -->`(项目 only,pointer 而非 inline)+ `<!-- pneuma:handoff:* -->`(项目 only)+ `<!-- pneuma:evolved:* -->`(Evolution 写入)+ `<!-- pneuma:resumed:* -->`(replay 续档))。Mode 版本写到 `skill-version.json`,resume 时与 manifest 比对,不同且未 dismiss 即 inline 提示 "Skill update: X → Y"。

## Project Lifecycle (3.0)

Project 是用户目录,由 `<root>/.pneuma/project.json` 标记。多个 session 在不同 mode 下共享 `<root>/.pneuma/preferences/`,通过 Smart Handoff 协作。

### Detection

`core/project-loader.detectWorkspaceKind(workspace)` 看 `<workspace>/.pneuma/project.json` 是否存在;否则当 quick session。`--project <path>` 强制 project mode 并指定/创建 session id。

### Fresh-project onboarding(`project-onboard`)

用户打开 project URL(`?project=<root>`)若 sessions 为空且无 `onboardedAt`,`EmptyShell` 自动拉起隐藏的 `project-onboard`。Agent 挖掘目录(README、package manifest、视觉资产)后写一份 `proposal.json` 到 `<sessionDir>/onboard/`,Discovery Report viewer 渲染 hero + anchors + open questions + 两个 task card。`POST /api/projects/onboard/apply` 落盘 `project.json`(含 `onboardedAt`)、`project-atlas.md`、`cover.{png,jpg,jpeg,webp,svg}`。点击 task card 同步 mint target session、stage `inbound-handoff.json`、spawn target mode。Auto-trigger 一项目一次;`ProjectPanel` 的 **Re-discover** 可重跑。

### Environment Variables

每个 session 注入:`PNEUMA_SESSION_DIR`(agent CWD;`.claude/skills/`、`CLAUDE.md`、state 文件都在这)、`PNEUMA_HOME_ROOT`(project session 为 project root,quick 为 workspace)、`PNEUMA_SESSION_ID`。项目 session 额外注入 `PNEUMA_PROJECT_ROOT`。

### Cross-Mode Handoff Protocol

源 agent 调 `pneuma handoff --json '{...}'`(CLI 经 `PNEUMA_SERVER_URL` POST 到 `/api/handoffs/emit`);server 把 proposal 存进内存 `Map<handoff_id, HandoffProposal>`(30-min TTL),通过 WS 广播 `handoff_proposed` 到源浏览器。HandoffCard 渲染 intent / summary / files / decisions / open questions。

- **Confirm**:server 原子写 `<targetSessionDir>/.pneuma/inbound-handoff.json`、best-effort kill 源 backend、记录 `switched_out` / `switched_in` 事件、spawn target。Target 的 skill installer 把 inbound JSON 装到 `pneuma:handoff` block;target agent 第一轮读完并 `rm`。
- **Cancel**:server 派一条 `<pneuma:handoff-cancelled reason="..." />` synthetic user message 回源 agent。

完整设计见 [`docs/archive/proposals/2026-04-28-handoff-tool-call.md`](docs/archive/proposals/2026-04-28-handoff-tool-call.md);项目层全貌见 [`docs/archive/proposals/2026-04-27-pneuma-projects-design.md`](docs/archive/proposals/2026-04-27-pneuma-projects-design.md)。

### Borrow (round-trip cross-mode handoff)

Handoff 是 **goto**(kill A、spawn B、控制权不回来);**borrow** 是 **subroutine call**——从活着的 session A 里借用 mode B 的能力做一件有界的事,**A 不死、不离前台**,B 在后台子 session 做完写出交付物 + 变更说明,控制权**返回** A。契约层(`core/types/borrow.ts`)定义三个形状:`BorrowDispatchPayload`(A→server 的 brief:`mode`+`brief` 必填,加 `inputs`/`expects`/`scope`/`in_place_targets`/`summary`/`language`/`return_via`)、`BorrowResult`(B 写进 `<Bdir>/borrow-result.json`、A 读:`produced[]`+`change_notes`+`status`+`applied_in_place?`+`open_questions?`)、`BorrowLink`(server 内存 `Map<borrow_id, BorrowLink>` 链接记录,磁盘是真相)。四个被批准的决策(ADR-015):(D1) borrow 是与 handoff 并列的独立原语而非它的 flag;(D2) 返回腿是磁盘文件 + 排队 chat tag、非同步响应(崩溃可幸存);(D3) 默认 `scope:"return"`(host 应用 diff、保住专长分工)、opt-in `in-place` 逃生口;(D4) B 默认继承 A 的 backend(单 backend 锁不破)。并发默认(`MAX_CONCURRENT_BORROWS_PER_SESSION = 1`):每 session 一个活跃 borrow,多余的排队。Server/CLI/env-tag/skill 集成属后续任务(B2–B5);契约类型 + ADR 先行。

## Agent Command Distribution (3.10.0)

`handoff-pneuma` 是 Pneuma 安装到其他 code agent(Claude Code、Codex)里的 user-level 入口——让 agent 在 CC/Codex 内就能把工作交给 Pneuma,用户全程不打开 launcher。Claude Code 里是 `/handoff-pneuma` slash command;Codex 里是 `$handoff-pneuma` skill(显式 `/skills` 菜单或 `$handoff-pneuma`,也可按 description 隐式触发)。

**安装位置:** Claude Code `~/.claude/commands/handoff-pneuma.md`(slash command,源模板 `templates/agent-commands/handoff-pneuma.md`);Codex `~/.agents/skills/handoff-pneuma/SKILL.md`(skill,源模板 `templates/agent-commands/handoff-pneuma.skill.md`)。`BackendDescriptor.kind: "command" | "skill"` 区分两者;`loadBundledTemplate(backend)` 按 backend 取模板。Per-install state 在 `~/.pneuma/agent-commands.json`。Marker / legacy-prompt 细节见 `.claude/rules/backends.md`。

**两条路径:**
1. **CLI 路径** —— `command -v pneuma` 成功 → `pneuma handoff-from-external --intent ... --mode ...`。CLI 验 mode、按需写 `<cwd>/.pneuma/project.json`、mint session id、stage inbound handoff、挑空闲端口、`spawn pneuma <mode> --no-prompt --project <cwd> --session-id <id> --port <p>` detached、打印 URL。
2. **URL 协议路径** —— CLI 缺失但 macOS 桌面应用在 → agent 发 `open "pneuma://handoff?intent=...&mode=...&cwd=..."`。Electron 在 `desktop/src/main/index.ts::handlePneumaUrl` 处理 `handoff` case:POST 到 `<launcherUrl>/api/handoffs/external`,再开新 mode window。

两条路径最终都汇到 launcher 的同一个 Bun route,包装 `runHandoffFromExternal`(`bin/handoff-from-external-cli.ts`)—— stage + spawn 的 single source of truth。

**Inbound payload** schema 与 Smart Handoff 同(`InboundHandoffPayload`)。External handoff 设 `source_session_id = "external:<sourceAgent>"`、`source_mode = "external"`。Skill installer 把它注入 `pneuma:handoff` block;target agent 第一轮 read + rm。

**生命周期 UI:** Launcher boot 时 `bootstrapAgentCommandAutoUpdate` 静默 re-stamp 已装的过时文件(除非用户关 autoUpdate)。First-launch banner `<AgentCommandBanner />` 在 `promptDismissed=false && installed=empty` 时显示。设置面板 `<AgentCommandSettings />` 管理 install/update/uninstall + CLI symlink。

### Background Mode (3.12.0)

桌面专属。`pneuma://handoff` 默认在**隐藏 Electron 窗口**里运行 session,完成后自动揭示(首个 `running → idle` 触发 `revealModeWindow`,系统 Notification 辅助)。从 CC / Codex 来的 handoff 因此变成 fire-and-forget。watchdog / 容错 / 逃生口(`&background=0`)细节见 `.claude/rules/desktop.md`。服务端无任何变化——只是桌面端表现层差异。

## Launcher

无 mode 参数时启动(`bun run dev` / `pneuma`)。Marketplace UI:Recent Sessions、Recent Projects、Built-in Modes、Local Modes、Published Modes、Backend Picker。入口在 `server/index.ts` launcher block 与 `src/components/Launcher.tsx`。

## Server Routes

主路由在 `server/index.ts`;export 在 `server/routes/export.ts`;mode-specific 在 `server/{evolution,mode-maker}-routes.ts`;launcher-scope 路由在 `server/{library,agent-command}-routes.ts`。

WebSocket:`/ws/browser/:sessionId`(JSON)、`/ws/cli/:sessionId`(NDJSON,legacy 兼容)、`/ws/terminal/:terminalId`(binary)。三个 backend 都跑 stdio,不直接走 WS。

Key endpoints:

- `GET /api/file?path=<abs>` — workspace-contained file reads(chat 图片预览)
- `GET /api/running` — 系统级所有 running sessions(每条带 current mode + optional `thumbnailUrl`)
- `POST /api/session/thumbnail` — base64 PNG → `<stateDir>/thumbnail.png`
- `GET/POST /api/favorites` — pinned-modes
- `GET /api/github/status` — `{ installed, authenticated, username?, version?, hint? }` from `gh` probe
- `/api/libraries/*`(launcher-only)—— CRUD library + 广播 `libraries_updated`,使 library-activated mode 在 Quick Start 即时生效
- `/api/agent-commands/*` + `/api/handoffs/external` + `/api/cli/*`(launcher-only)—— 见 Agent Command Distribution
- `GET /api/seeds/list` + `POST /api/seeds/apply` + `GET /api/mode/seed-gallery/*` —— per-session gallery endpoints (seed catalog, copy one or many entries from `init.seedFiles`, serve thumbnail assets). `apply` body accepts `sourceKey: string | string[]` so a single card can copy a multi-file bundle. Copy logic in `server/seed-installer.ts::copySeedEntry`.
- `POST /api/contentsets/delete` —— removes a top-level content-set subdir under the workspace with traversal + `_`-prefix guards.
- 原生桌面 API(`/api/native/*`)只在 Electron 可用:Server → WS `native_request` → Browser → Electron IPC → result → WS `native_result`。Web 返回 `{ available: false }`。

## Coding Conventions

- **TypeScript strict**, ESNext modules, bundler resolution
- **Bun APIs** over Node.js (Bun.spawn, Bun.file, etc.)
- **Contract-first**: contract changes → update `core/types/` + `core/__tests__/` + `docs/reference/` + the contracts table above, in the same change. Recurring concepts get lifted to the protocol layer (thin waist) instead of being solved ad-hoc per feature.
- **No hardcoded mode knowledge** in server/CLI — driven by ModeManifest
- **Backend selected at startup only** — no runtime backend switching in session UI
- **Zustand** sliced store (`src/store/`), mode viewers in `modes/<mode>/viewer/`
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`)
- **English only** in source code — comments, JSDoc, identifiers, commit messages, docs in `core/`, `server/`, `src/`, `backends/`, `bin/`. Chinese allowed only in mode seed templates (`zh-light/`, `zh-dark/`), showcase content, `docs/` archive
- **Visual verification for frontend changes**: After modifying viewer components, CSS, or any UI-facing code, use `chrome-devtools-mcp` to screenshot the running dev server and verify before reporting completion. Do not judge visual correctness by reading code alone
- **Conventional commits**: `feat(area): …` / `fix(area): …` / `test(area): …` / `chore: …` — descriptive, explain the why. Never create or push git tags (CI owns releases).

## Development Toolchain (`.claude/`)

The dev toolchain is part of the repo. Claude Code loads rules automatically by path and exposes agents/commands/workflows natively; **Codex / Kimi agents must follow the pointers manually** (read the rule file before editing in its domain).

### Rules — read before editing(per-domain constraints & gotchas)

| You are editing… | Read first |
|------------------|-----------|
| `src/**`, `modes/*/viewer/**` | `.claude/rules/frontend.md` |
| `server/**`, `bin/**`, `core/**`, `snapshot/**`, `plugins/**` | `.claude/rules/server.md` |
| `modes/**`(manifest / skill / seeds) | `.claude/rules/modes.md` |
| `backends/**`, `templates/agent-commands/**` | `.claude/rules/backends.md` |
| `**/__tests__/**`, `*.test.ts(x)` | `.claude/rules/testing.md` |
| `desktop/**` | `.claude/rules/desktop.md` |

Rules carry the project's accumulated gotchas. When you burn time on a non-obvious trap, append it to the matching rule file (not to this document).

### Subagent roster(`.claude/agents/`)

| Agent | Model | Role |
|-------|-------|------|
| `pneuma-explore` | light | Read-only scout; reports in layer / contract / mode / backend vocabulary |
| `pneuma-architect` | fable | Contract-first design authority; writes design `.md` artifacts only, never code |
| `pneuma-impl` / `pneuma-impl-fable` | opus / fable | Single-task implementation: TDD, typecheck + test gates with raw output, visual verification for UI, deviation escalation instead of improvising |
| `pneuma-amender` / `pneuma-amender-fable` | opus / fable | Applies review findings with a per-finding disposition ledger (FIXED / ESCALATED / …) |

Route to `-fable` variants for long-horizon / structurally complex / high-stakes tasks; default variants for routine work.

### Orchestration(`.claude/workflows/`)

`dev-master-orchestrator.js` drives multi-task development: per task **Impl → (Review ∥ Verify) → converge → Amend** loop, tasks grouped into parallel/serial waves, model routing via `effort` / per-task `engine` flags, review dimensions parameterized by `taskKind`(`contract` / `feature` / `viewer` / `test-suite`). See `.claude/workflows/README.md`.

### Commands & skills

- `/bump` — full version bump & release flow (see Release Process below)
- `/showcase` — generate mode showcase materials (showcase.json + hero/highlight images)
- `/create-adr` — author a new ADR under `docs/adr/` following its conventions
- `create-mode` skill(`.claude/skills/create-mode/`)— end-to-end new-mode authoring: discovery interview → design brief → skeleton

## Release Process

CI (`release.yml`) handles tagging, GitHub Release, and npm publish on push to `main`. **Do NOT manually create or push git tags.**

### Version Bump Checklist (same commit)
1. `package.json` — `"version"`
2. `desktop/package.json` — `"version"`, **must equal** `package.json` 的值。`electron-updater` 用它比较运行中的桌面应用与最新 release;3.10.3 起两者绑定,**只 bump 一份就是 bug**。
3. `AGENTS.md` — `**Version:**` 行(本文件。`CLAUDE.md` 只是一行 `@AGENTS.md` import,不含版本号——**不要**往 `CLAUDE.md` 写任何内容)
4. `CHANGELOG.md` — new section

然后 `git push origin main`(不带 `--tags`)。CI 建 tag、发 release、publish。完整流程走 `/bump` command。
