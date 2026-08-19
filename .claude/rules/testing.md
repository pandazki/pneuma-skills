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

- **单独跑 `bun test backends/kimi-cli/` 是一个无效探针**(2026-08-19 实测):它会报 `2 fail / 2 errors`,内容是 `ReferenceError: Cannot access 'kimiCliModule' before initialization`(`backends/index.ts:33` 的循环 import)——那是**只在单独跑这个目录时才出现的加载顺序产物**,不是第二个缺陷。要给某个 backend 的 lifecycle 定位,跑 `bun test backends/`(整个目录)或全量,别缩到单个 backend 目录。
- **`backend lifecycle: kimi-cli > resume` 是一条活模型断言,本机会 flake**:harness 让真实 `kimi acp` 复述一个词(`paprika`),模型答别的就红。约 50% 复现,只在装了 `kimi` 二进制的机器上跑(CI 上是 skip)。判断它是否与你有关的方法只有一个:`git diff <base> --stat -- backends/` —— 那里没动过,它就不是你的。
