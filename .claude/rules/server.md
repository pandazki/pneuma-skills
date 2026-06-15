---
paths:
  - "server/**"
  - "bin/**"
  - "core/**"
  - "snapshot/**"
  - "plugins/**"
---

# Server / CLI / Core Rules (Bun + Hono)

## Baseline

- **Bun APIs** over Node.js (`Bun.spawn`, `Bun.file`, `Bun.serve`, …). Runtime is Bun >= 1.3.5, not Node.
- **Contract-first**: contract changes → update `core/types/` + `core/__tests__/` + `docs/reference/` + the contracts table in `AGENTS.md`, in the same change.
- **No hardcoded mode knowledge** in server/CLI — everything driven by ModeManifest. **No backend conditionals** (`if (type === ...)`) outside `backends/index.ts`.

## Gotchas

- **chokidar glob**:watch 目录路径,回调里 filter。**不要** `watch("**/*.md", { cwd })`。
- **Bun.serve dual-stack**:必须 `hostname: "0.0.0.0"`,否则 macOS IPv6/IPv4 端口碰撞。
- **Stale `dist/`**:若 `dist/index.html` 存在,server 退回 production 模式。要么删 `dist/`,要么传 `--dev`。Launcher 派生子进程自动继承 `--dev`。
- **Vite WS proxy + Bun.serve**:浏览器 WS 直连 backend 端口,绕开 Vite。
- **Shadow-git checkpoint queue**:所有 checkpoint 操作通过 Promise chain 串行化,防 `index.lock` 冲突。**不要并行**。
- **Proxy**:(1) `proxy.json` 通过 chokidar 热加载。(2) 默认只放行 GET——POST/PUT/PATCH 要求显式 `"methods"`。(3) Bun `fetch()` 自动解压 gzip/br;proxy 必须剥 `content-encoding` 防双重解压。
- **Editor-open 策略**(`server/editor-bridge.ts`):文件走 CLI-first,**目录(项目根)走 `open -a`**。四条铁律:
  0. 目录目标必须 `open -a <App> <dir>`,不走 CLI——bundled `cursor <folder>` 经已运行实例 IPC 打开会崩最新版 Cursor 的 AgentPanel。`openInEditor` 里 `statSync(absPath).isDirectory()` 分派。
  1. 必须 sanitize env(`cleanEditorEnv`):剥 `VSCODE_IPC_HOOK_CLI` / `VSCODE_GIT_*` / `GIT_ASKPASS` / `ELECTRON_RUN_AS_NODE` 一族,否则 bundled 启动器切 remote-IPC 模式崩 Cursor。
  2. 开文件时传 enclosing folder 作前导位置参数以聚焦已有窗口(`buildOpenArgs` + `findProjectRoot`)。**不要用 `-r/--reuse-window`**。
  3. 行号方言:VS Code 系 `--goto <file>:<line>`,Zed/Sublime `<file>:<line>` 后缀(按 `KnownEditor.family` 分派)。`open -a` fallback 只能裸路径。
- **Native bridge timeout**:`/api/native/*` 经浏览器 WS 路由——若无浏览器 tab 连接,native call 10s 超时。Web 返回 `{ available: false }`。
- **Windows 兼容**:散在 `path-resolver.ts`(`where` vs `which`)、`terminal-manager.ts`(`COMSPEC`)、`system-bridge.ts`(`cmd /c start`)、`server/index.ts`(`NUL`、`taskkill`)。win32 路径比较不区分大小写。
- **Machine-readable CLI subcommands bypass `p.intro()`**:`agent-command`、`mode list --local`、`handoff-from-external` 在 `bin/pneuma.ts:main()` 里**先于** clack banner dispatch,否则 banner 污染 stdout 让 agent 侧 `JSON.parse` 挂掉。未来任何 stdout 被 agent 消费的子命令都得照办。
- **`pneuma handoff-from-external` detached spawn**:必须给子进程传 `--no-prompt`。`stdio: "ignore"` + `detached: true` 下子进程没有 stdin;任何 `init.params` prompt 都会永久阻塞。
- **Handoff confirm 不能 kill 自己 session**:`killActiveSession(sourceSessionId)` 跑在源 session 自己的 server 里,但源进程是 launcher 派生——源 backend 继续跑。桌面端靠 mode-window 关闭时按端口对照 `/api/running` 批量 teardown 缓解。
- **Project session 状态污染 if `--project` 丢失**:subcommand 不解析 `--project` 会把状态写进 project root 与项目层冲突。所有 subcommand(含 `evolve`)必须尊重 `--project`。
- **Project session id vs backend id**:`session.json` 顶层 `sessionId` 是项目 session id(= 目录名 = URL `--session-id`);backend 协议 id 在 `agentSessionId`。**绝不让 backend id 泄漏到 registry / panel**,否则解析到不存在的目录。
- **Launcher 没 agent session,WS 广播到不了**:`WsBridge.broadcastAll` 按 per-session 浏览器 socket 遍历;launcher main page 在任何 session 存在之前就 mount。Launcher-scope mutation 路由必须在本地 dispatch DOM event(如 `pneuma:libraries-updated`);真实 session 内的 sibling tab 仍走 WS——两条路径汇到同一事件名。
- **Backend persistence**:`backendType` 在 `.pneuma/session.json` 和 `~/.pneuma/sessions.json` 都是 resume identity 的一部分。Backend 在 startup 选定后 session 内不可切换。
- **Refined session meta 双写,resume 必须保留**:`pneuma session refine` 把 `displayName`/`description`/`refinedAt` 同时写进 registry entry(`~/.pneuma/sessions.json`,launcher Recent Sessions 读)**和** canonical `session.json`(ProjectPanel 经 `scanProjectSessions` 读)。任何在 launch/resume 时**从头重建**这两处条目的路径都会把这三件套擦回 mode 默认("WebCraft session" + 首条消息预览)——`recordSession`、`saveSession`、`importSessionsIntoProject` 三处都犯过。Registry 侧用 `pickRefinedMeta`(`refinedAt` 是 "已 refine" 标记),session.json 侧用 `preserveRefinedSessionMeta`,二者均"显式传入值优先、缺省回退旧值"。同一陷阱早有先例:`sessionName` 走 `pickSessionName`。新增任何 session-entry rebuild 路径,先想清楚这四个 user/agent 设定的字段怎么保留。
- **Replay**:(1) `--replay` 推迟 agent 启动到 `/api/replay/continue`。(2) 每次 checkout 前清 `.pneuma/replay-checkout/`。(3) 文件 navigation 必须在 checkpoint 加载**之后**(不能在 `displayMessage` 期间)。
- **Editing/readonly distinction**:`editing` 是 session 布尔(`true`=创作,`false`=消费),`false` 时不跑 agent;`readonly`(replay)禁用一切交互。两者不要混。
- **Bun `os.homedir()` 启动时缓存**:boot 后改 `process.env.HOME` 不会改 `homedir()` 返回值。需要 tmp home 的模块改读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`。
