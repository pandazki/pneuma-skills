---
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing Rules (bun:test)

## Baseline

- Runner is **`bun test`** (Bun native). Scope with a path (`bun test server/`) while iterating; run the full suite before any push. Healthy output: `NNNN pass / NN skip / 0 fail`.
- Tests are **colocated** in `__tests__/` dirs next to the code they pin (`core/__tests__/`, `server/__tests__/`, `backends/*/__tests__/`, `modes/*/__tests__/`, …). New behavior ships with tests pinning it; contract changes require `core/__tests__/` updates.
- **Backend lifecycle suites** count `(skip) ... binary not available` toward `skip`, not `fail` — those are fine on machines without the CLI installed. Any `fail` is a stop.
- Prefer real code over mocks where cheap — Bun spins up real servers/files fast. Don't write tests that only exercise the mock.

## Gotchas

- **Hardcoded manifest versions**:`server/__tests__/` 与 backend lifecycle harness 有测试用字符串相等 pin `webcraftManifest.version` 之类。bump 任何 mode 版本前先 grep 旧字符串(见 `/bump` step 4b),否则本地静默、CI 在 release gate 上炸。
- **Bun `os.homedir()` 启动时缓存**:测试里改 `process.env.HOME` 不影响 `homedir()`。需要 tmp home 的被测模块要读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`(`core/agent-command-installer.ts` 是先例)。
- **Shadow-git 测试**:checkpoint 操作必须串行(Promise chain),测试里也不要并行触发,防 `index.lock`。
