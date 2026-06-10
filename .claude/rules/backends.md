---
paths:
  - "backends/**"
  - "templates/agent-commands/**"
---

# Backend Rules (claude-code / codex / kimi-cli)

## Baseline

- **`backends/index.ts` is a pure registry** over per-backend manifests. No `if (type === ...)` conditionals outside this file — backend knowledge lives behind `BackendModule`.
- **Read the backend's own README first**: `backends/claude-code/README.md`, `backends/codex/README.md`, `backends/kimi-cli/README.md` — protocol details, lifecycle quirks, and version-compat branches live there, not in AGENTS.md.
- **All backends run stdio** (Claude/Kimi: stream-json NDJSON; Codex: `app-server` JSON-RPC). `/ws/cli/:sessionId` is legacy-only.
- **Lifecycle tests reuse the shared harness**: `backends/__tests__/lifecycle-harness.ts` runs the same 6 scenarios against every backend. New backend behavior belongs in the harness when it's cross-backend, in the backend's own `__tests__/` when not.
- **Install conventions** are data on the manifest (`skillsDir` + `instructionsFile` on `BackendModule`): Claude `.claude/skills/` + `CLAUDE.md`; Codex `.agents/skills/` + `AGENTS.md`; Kimi `.kimi/skills/` + `AGENTS.md`. Server code gets them via `getInstallConventions(backendType)` — never hardcode paths.

## Gotchas

- **Codex skill-roots alias expansion misfires**:Codex(0.137)把 skill 列表呈现成 alias 压缩的 roots 表,路径展开由模型自己做,roots 一多就展开错。因此 `generatePneumaSection` 在 `pneuma:start` 块里写死 cwd 相对 skill 路径(mode skill 指针 + `skillPathRule`)。重构指令拼装时**不要删这两行**。
- **Agent-command marker placement**:`<!-- pneuma:agent-command version="..." backend="..." -->` marker 放在 YAML frontmatter **下方**,不是 line 1——Claude Code 与 Codex 都要求 frontmatter 从 line 1 起。Installer 全文扫 marker,不只 line 1。无 marker 的文件视为用户手写,`--force` 之前不覆盖。
- **Codex 不用 custom prompt**:`~/.codex/prompts/*.md` 已被 OpenAI 弃用且有发现回归;handoff-pneuma 走 `.agents/skills`。install 时若旧 prompt 文件还在且带我们的 marker 会顺手删掉(`descriptor.legacyFile`)——只删我们自己写的。
- **指令文件不分叉**:Codex 与 Kimi 各读 `AGENTS.md`,Claude 读 `CLAUDE.md`(repo 根的 CLAUDE.md 只含 `@AGENTS.md` import)。运行时对所有 backend 是同一份语义。
