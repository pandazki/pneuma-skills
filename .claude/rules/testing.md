---
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing Rules (bun:test)

## Baseline

- Runner is **`bun test`** (Bun native). Healthy output: `NNNN pass / NN skip / 0 fail`.
- **跑哪一套,按你改了什么**(2026-08-20 实测,同一台装了三个 CLI 的机器):

  | 你改了 | 跑 | 实测 |
  |---|---|---|
  | `src/**`、`modes/*/viewer/**` | `bun run test:frontend` | 18s |
  | `server/** bin/** core/** snapshot/** plugins/**` | `bun run test:server` | 16s |
  | 某一个 mode | `bun test modes/<name>` | bansho 5s |
  | `backends/**`、`templates/agent-commands/**` | `bun run test:backends` | **4 分钟**,见下 |
  | 提交前 / 说不准 | `bun run test` | 34s |
  | bump / release | `bun run test:all` | 4.5 分钟 |

  `bun run test` 是**除 backends 之外的全部**(3596 tests / 222 files)。**注意:裸 `bun test` 仍然是全量**——只有 `bun run test` 走 package.json 里那条带路径过滤的脚本。
- **全量之所以慢,几乎全部在 `backends/`**:126 个测试要 **247 秒**,其余七个目录加起来 34 秒。原因是 lifecycle harness **真的去 spawn `claude` / `codex` / `kimi acp` 并等真实模型回话**——所以它慢、要网络、还会 flake(见下面 `kimi-cli > resume` 那条)。**CI 不受影响**:CI 机器上没装这些二进制,那 126 条整体 skip。这也是为什么这套慢+脆的东西不该待在日常默认里。
- Scope with a path (`bun test server/`) while iterating.
- Tests are **colocated** in `__tests__/` dirs next to the code they pin (`core/__tests__/`, `server/__tests__/`, `backends/*/__tests__/`, `modes/*/__tests__/`, …). New behavior ships with tests pinning it; contract changes require `core/__tests__/` updates.
- **Backend lifecycle suites** count `(skip) ... binary not available` toward `skip`, not `fail` — those are fine on machines without the CLI installed. Any `fail` is a stop.
- Prefer real code over mocks where cheap — Bun spins up real servers/files fast. Don't write tests that only exercise the mock.

## Gotchas

- **Hardcoded manifest versions**:`server/__tests__/` 与 backend lifecycle harness 有测试用字符串相等 pin `webcraftManifest.version` 之类。bump 任何 mode 版本前先 grep 旧字符串(见 `/bump` step 4b),否则本地静默、CI 在 release gate 上炸。
- **Bun `os.homedir()` 启动时缓存**:测试里改 `process.env.HOME` 不影响 `homedir()`。需要 tmp home 的被测模块要读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`(`core/agent-command-installer.ts` 是先例)。
- **Shadow-git 测试**:checkpoint 操作必须串行(Promise chain),测试里也不要并行触发,防 `index.lock`。

- **单独跑 `bun test backends/kimi-cli/` 是一个无效探针**(2026-08-19 实测):它会报 `2 fail / 2 errors`,内容是 `ReferenceError: Cannot access 'kimiCliModule' before initialization`(`backends/index.ts:33` 的循环 import)——那是**只在单独跑这个目录时才出现的加载顺序产物**,不是第二个缺陷。要给某个 backend 的 lifecycle 定位,跑 `bun test backends/`(整个目录)或全量,别缩到单个 backend 目录。
- **`backend lifecycle: kimi-cli > resume` 是一条活模型断言,本机会 flake**:harness 让真实 `kimi acp` 复述一个词(`paprika`),模型答别的就红。约 50% 复现,只在装了 `kimi` 二进制的机器上跑(CI 上是 skip)。判断它是否与你有关的方法只有一个:`git diff <base> --stat -- backends/` —— 那里没动过,它就不是你的。
