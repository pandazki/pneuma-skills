---
paths:
  - "backends/**"
  - "templates/agent-commands/**"
---

# Backend Rules (claude-code / codex / kimi-cli)

## Baseline

- **`backends/index.ts` is a pure registry** over per-backend manifests. No `if (type === ...)` conditionals outside this file — backend knowledge lives behind `BackendModule`.
- **Read the backend's own README first**: `backends/claude-code/README.md`, `backends/codex/README.md`, `backends/kimi-cli/README.md` — protocol details, lifecycle quirks, and version-compat branches live there, not in AGENTS.md.
- **All backends run stdio** (Claude: stream-json NDJSON; Codex: `app-server` JSON-RPC; Kimi: ACP JSON-RPC via `kimi acp`). `/ws/cli/:sessionId` is legacy-only.
- **Lifecycle tests reuse the shared harness**: `backends/__tests__/lifecycle-harness.ts` runs the same 6 scenarios against every backend. New backend behavior belongs in the harness when it's cross-backend, in the backend's own `__tests__/` when not.
- **Install conventions** are data on the manifest (`skillsDir` + `instructionsFile` on `BackendModule`): Claude `.claude/skills/` + `CLAUDE.md`; Codex `.agents/skills/` + `AGENTS.md`; Kimi `.kimi-code/skills/` + `AGENTS.md`. Server code gets them via `getInstallConventions(backendType)` — never hardcode paths.

## Gotchas

- **Claude 的模型开关必须走 `control_request`,顶层帧会被静默吞掉**:stream-json 的输入读取器**接受** `{"type":"set_model","model":"haiku"}` 这一行、不报错、也不回任何 response——然后**丢弃**它,下一轮照旧跑在原模型上。生效的唯一形状是 `{"type":"control_request","request_id":…,"request":{"subtype":"set_model","model":…}}`(CC 2.1.220 实测:顶层帧 → `modelUsage: claude-opus-5`;control 帧 → `modelUsage: claude-haiku-4-5-20251001`)。这条 bug 隐形了很久,因为 bridge 做了乐观 UI 更新——picker 换了标签、`session.state.model` 也变了,只有真实计费模型没变。`set_permission_mode` / `interrupt` / `stop_task` / `end_session` 同属那个 subtype 白名单,新增任何一条都用 `sendControlRequest`,别自造顶层帧。
- **模型列表只在 `initialize` control response 里,`system.init` 没有**:`system.init` 只报当前那一个 `model`,不带候选列表(实测 key 列表里既无 `models` 也无 `availableModels`)。可选列表来自 `control_request {subtype:"initialize"}` 的成功响应 `response.models[]`——即 Agent SDK `query.supportedModels()` 读的那个东西,每项形如 `{value, resolvedModel, displayName, supportsEffort, supportedEffortLevels, supportsAdaptiveThinking, supportsFastMode, supportsAutoMode}`。`value` 常是别名(`opus` / `default` / `opus[1m]`),`resolvedModel` 才是具体模型,二者可多对一(`default` 与 `opus[1m]` 都解析到 `claude-opus-5[1m]`),所以高亮"当前项"必须选**单一**赢家、不能对每行跑谓词。`WsBridge.requestSupportedModels` 在 `attachCLITransport` 里 fire-and-forget 发这个请求;它与正常 turn 并存无副作用(hooks 照常触发、`system.init` 正常)。老 CLI 答不出 `models` 时回落到 `BackendModule.defaultModels`——**那个静态列表一律写别名,不写钉死的 model id**,钉死的每次发新模型就烂一次(它曾在 Opus 5 与 Fable 都上线后还挂着 Opus 4.7 / Sonnet 4.6)。

- **Codex skill-roots alias expansion misfires**:Codex(0.137)把 skill 列表呈现成 alias 压缩的 roots 表,路径展开由模型自己做,roots 一多就展开错。因此 `generatePneumaSection` 在 `pneuma:start` 块里写死 cwd 相对 skill 路径(mode skill 指针 + `skillPathRule`)。重构指令拼装时**不要删这两行**。
- **Agent-command marker placement**:`<!-- pneuma:agent-command version="..." backend="..." -->` marker 放在 YAML frontmatter **下方**,不是 line 1——Claude Code 与 Codex 都要求 frontmatter 从 line 1 起。Installer 全文扫 marker,不只 line 1。无 marker 的文件视为用户手写,`--force` 之前不覆盖。
- **Codex 不用 custom prompt**:`~/.codex/prompts/*.md` 已被 OpenAI 弃用且有发现回归;handoff-pneuma 走 `.agents/skills`。install 时若旧 prompt 文件还在且带我们的 marker 会顺手删掉(`descriptor.legacyFile`)——只删我们自己写的。
- **指令文件不分叉**:Codex 与 Kimi 各读 `AGENTS.md`,Claude 读 `CLAUDE.md`(repo 根的 CLAUDE.md 只含 `@AGENTS.md` import)。运行时对所有 backend 是同一份语义。
- **Kimi = Kimi Code,不是旧 kimi-cli**:`kimi` 二进制被 Moonshot 整体换成了 Kimi Code(版本号从 1.41.0 **倒退**到 0.26.0——semver 比较是反的,判定新旧只能 probe `acp` 子命令)。skill 发现目录是 `.kimi-code/skills/`(旧 `.kimi/skills/` 新 binary **不读**);`--print`/`--input-format`/`--work-dir`/`-r` 全部消失。协议细节(tool-call 参数流式 partial-JSON 陷阱、`title` 只在 `tool_call` 起始帧是真工具名、`session/resume` 不回放历史而 `session/load` 会、permission round-trip 不答会死锁)见 `backends/kimi-cli/README.md`。
- **Kimi 的 `usage_update` 是"上下文占用",不是 token I/O 拆分,而且晚于 turn 结束到达**(0.38.0 实测):payload 只有 `{used, size}`——`used` 是这个 session 当前占了多大上下文(k3 的 `size` 是 1048576,**空 session 一开就 ~36k**,因为系统提示词本身那么大),**没有** input/output/cache 任何拆分,ACP 里根本不存在这些字段。所以它的正确归宿是 `context_used_percent`(ChatPanel 的 "ctx N%"),`input_tokens` 只能填这个累计值并在 README 里说清它是什么,其余三个字段留 0——**编一个数比留 0 更糟**。另一半陷阱是**时序**:这一帧在该 turn 的 `session/prompt` response **之后**、另一个 stdout chunk 里到(实测同一毫秒,但 promise 已 resolve、微任务已跑完),于是 result envelope 天然滞后一轮:第 1 轮报 0,第 N 轮报第 N-1 轮的快照。想"修"它就得推迟 turn 结束——**别做**,拿实时 idle 换一个装饰性数字不划算。同理:`current_mode_update` 才是 mode 的唯一来源,`config_option_update` 里那份 `mode` 是第二来源,**一个事实两个来源迟早打架**,不要读。
- **ACP `session/prompt` 不能设 RPC 超时**:它到 turn 结束才 resolve,中途还会阻塞在人类批准 permission 上;超时会在长 turn 中途误报。liveness 由 transport-close(进程死亡 reject 所有 pending call)兜底,`AcpTransport.call(..., null)` 即无超时路径。
- **`workflowsDir` 装出去的 workflow,注册表在 agent 启动时扫一次,不热更新**(实测 2026-08-12):`Workflow({name})` 确实会解析 `<cwd>/.claude/workflows/*.js`——但**会话中途新写进去的文件,当前 agent 一直看不到**(往本仓库 `.claude/workflows/` 写一个探针脚本后立刻按名调用:`not found`,而同目录下启动时就存在的 `dev-master-orchestrator` 在可用列表里)。今天这不成问题:`installSkill` 在 `bin/pneuma.ts` 的 704/715/2190/2585/2801 全部跑在 `backend.launch()`(748/2620/2823)**之前**,所以新 session 的 agent 一定看得到刚装的脚本。**会咬人的是 in-session 安装**——skill update、seed apply、任何不重启 agent 就重写 `.claude/workflows/` 的路径,写进去的 workflow 当轮不可调用,而且**失败形状是 "not found",看起来像装错了路径,不像缓存**。所以:(a) 脚本自身要同时文档化 `scriptPath` 调法(`${PNEUMA_SESSION_DIR}/.claude/workflows/<name>.js`),那条与注册表无关、随时可用;(b) 新增 workflow 的 skill 版本更新要走 resume(会重启 agent),别指望热生效。
