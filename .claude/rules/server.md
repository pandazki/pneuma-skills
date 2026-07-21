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
- **Shadow-git 自引用爆炸(O(N²) 磁盘吞噬)**:shadow repo 的 work-tree 是 `workspace`,排除规则写在 `info/exclude`。**Project session 里 `workspace === stateDir === sessionDir`**(`path-resolver-pneuma.ts` + `bin/pneuma.ts` 的 `workspace = sessionDir`),于是 `shadow.git/` 本体、`history.json`、`.claude/` 等全在 work-tree 根。旧规则只有 `.pneuma` 一条(为 quick session 写的,那时状态在 `.pneuma/` 子目录),在 project 拓扑下**一条都不匹配**——每轮 `git add -A` 把 shadow.git 自己越来越大的 object store 再 commit 一遍,叠加 auto-gc 的 ~GB 级 repack,体积按 O(N²) 爆炸(实测一个 37-turn 的 session 到 27 GB,99.96% 是 `shadow.git/objects/pack/*.pack` 的自我快照)。修复三件套:(1) `buildExcludeRules` 按拓扑派生——`resolve(stateDir) === resolve(workspace)` 时追加 root-anchored(`/session.json`、`/.claude/`、`/CLAUDE.md`…)的 plumbing 排除,base 始终含 `shadow.git`/`checkpoints.jsonl`/`.venv` 等;(2) `initShadowGit` 幂等分支(resume)**也要重写 `info/exclude` + `git rm -r --cached --ignore-unmatch`**,否则旧 session 永远拿不到新规则;(3) `captureCheckpointInner` 加 `MAX_CHECKPOINT_FILE_BYTES` 单文件上限。**测试必须用 `workspace === stateDir` 复现真实 project 拓扑**——老测试传 `workspace=projectRoot、stateDir=更深子目录`,`.pneuma` 规则恰好生效,所以从没抓到。已爆的 repo 只能 re-init 回收(`git gc` 无效,自引用 blob 从 HEAD 可达);删 `shadow.git` + `checkpoints.jsonl`,下次启动重建,work-tree 内容不动。
- **Proxy**:(1) `proxy.json` 通过 chokidar 热加载。(2) 默认只放行 GET——POST/PUT/PATCH 要求显式 `"methods"`。(3) Bun `fetch()` 自动解压 gzip/br;proxy 必须剥 `content-encoding` 防双重解压。
- **Editor-open 策略**(`server/editor-bridge.ts`):文件走 CLI-first,**目录(项目根)走 `open -a`**。四条铁律:
  0. 目录目标必须 `open -a <App> <dir>`,不走 CLI——bundled `cursor <folder>` 经已运行实例 IPC 打开会崩最新版 Cursor 的 AgentPanel。`openInEditor` 里 `statSync(absPath).isDirectory()` 分派。
  1. 必须 sanitize env(`cleanEditorEnv`):剥 `VSCODE_IPC_HOOK_CLI` / `VSCODE_GIT_*` / `GIT_ASKPASS` / `ELECTRON_RUN_AS_NODE` 一族,否则 bundled 启动器切 remote-IPC 模式崩 Cursor。
  2. 开文件时传 enclosing folder 作前导位置参数以聚焦已有窗口(`buildOpenArgs` + `findProjectRoot`)。**不要用 `-r/--reuse-window`**。
  3. 行号方言:VS Code 系 `--goto <file>:<line>`,Zed/Sublime `<file>:<line>` 后缀(按 `KnownEditor.family` 分派)。`open -a` fallback 只能裸路径。
- **Native bridge timeout**:`/api/native/*` 经浏览器 WS 路由——若无浏览器 tab 连接,native call 10s 超时。Web 返回 `{ available: false }`。
- **Shell PATH capture 有两个跨 shell 陷阱**(`server/path-resolver.ts` + `desktop/src/main/bun-process.ts` 各一份,`rootDir: "src"` 挡住了复用,**改一个必须改另一个**):(1) **marker 不能贴着变量名**——`"___PATH_START___$PATH___PATH_END___"` 里下划线是合法标识符字符,bash / zsh / fish **一致地**把它读成名为 `PATH___PATH_END___` 的变量(恒空),正则永远匹配不上,函数每次静默 fallback。marker 必须独占一行。(2) **必须用 `printenv PATH`,不能用 `echo $PATH`**——fish 把 PATH 存成 list,`echo $PATH` 用**空格**而非冒号连接。另外 `-i` 会加载交互式 rc,fastfetch 之类的 greeter 会往同一个 stdout 写 ANSI 图形,所以捕获结果必须剥 ANSI **并校验**(至少含一个真实存在的绝对路径目录),否则会把开屏 logo 当 PATH 用。这套 bug 长期隐形:终端启动时 `process.env.PATH` 本就正确,`buildFallbackPath()` 又覆盖了常见目录;只有「GUI 启动(Electron 的 PATH 是最小集)」+「二进制在硬编码 fallback 列表之外」同时成立才发作(实例:Kimi Code 改装到 `~/.kimi-code/bin`,而旧版在 `~/.local/bin`,于是表现为「升级后 CLI 突然找不到」)。**新 agent CLI 若装在非常规目录,除了修 capture 还要往 `buildFallbackPath()` 补一条**;`getEnrichedPath()` 现在无条件把 fallback 追加到最低优先级作兜底。
- **Backend lifecycle 测试是 live-LLM 集成测试,会 flaky**:`backends/*/__tests__/lifecycle.test.ts` 跑真实 CLI + 真实模型,单次失败(超时、`apply_patch verification failed` 之类)**不足以判定回归**。判定前至少重跑一次,或与干净树对比两次以上——单样本对比会得出相反结论。
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
