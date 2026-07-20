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

- **Codex skill-roots alias expansion misfires**:Codex(0.137)把 skill 列表呈现成 alias 压缩的 roots 表,路径展开由模型自己做,roots 一多就展开错。因此 `generatePneumaSection` 在 `pneuma:start` 块里写死 cwd 相对 skill 路径(mode skill 指针 + `skillPathRule`)。重构指令拼装时**不要删这两行**。
- **Agent-command marker placement**:`<!-- pneuma:agent-command version="..." backend="..." -->` marker 放在 YAML frontmatter **下方**,不是 line 1——Claude Code 与 Codex 都要求 frontmatter 从 line 1 起。Installer 全文扫 marker,不只 line 1。无 marker 的文件视为用户手写,`--force` 之前不覆盖。
- **Codex 不用 custom prompt**:`~/.codex/prompts/*.md` 已被 OpenAI 弃用且有发现回归;handoff-pneuma 走 `.agents/skills`。install 时若旧 prompt 文件还在且带我们的 marker 会顺手删掉(`descriptor.legacyFile`)——只删我们自己写的。
- **指令文件不分叉**:Codex 与 Kimi 各读 `AGENTS.md`,Claude 读 `CLAUDE.md`(repo 根的 CLAUDE.md 只含 `@AGENTS.md` import)。运行时对所有 backend 是同一份语义。
- **Kimi = Kimi Code,不是旧 kimi-cli**:`kimi` 二进制被 Moonshot 整体换成了 Kimi Code(版本号从 1.41.0 **倒退**到 0.26.0——semver 比较是反的,判定新旧只能 probe `acp` 子命令)。skill 发现目录是 `.kimi-code/skills/`(旧 `.kimi/skills/` 新 binary **不读**);`--print`/`--input-format`/`--work-dir`/`-r` 全部消失。协议细节(tool-call 参数流式 partial-JSON 陷阱、`title` 只在 `tool_call` 起始帧是真工具名、`session/resume` 不回放历史而 `session/load` 会、permission round-trip 不答会死锁)见 `backends/kimi-cli/README.md`。
- **ACP `session/prompt` 不能设 RPC 超时**:它到 turn 结束才 resolve,中途还会阻塞在人类批准 permission 上;超时会在长 turn 中途误报。liveness 由 transport-close(进程死亡 reject 所有 pending call)兜底,`AcpTransport.call(..., null)` 即无超时路径。
