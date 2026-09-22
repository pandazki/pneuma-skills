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
  | 提交前 / 说不准 | `bun run test` | 66s(**不含 live tier**,见下) |
  | bump / release | `bun run test:all` | 4.5 分钟(带 `PNEUMA_TEST_LIVE=1`) |
  | (实验)并行分片跑日常那一套 | `bun run test:shard` | 33–38s,**但目前会 flake**,见下 |

  `bun run test` 是**除 backends 与 live tier 之外的全部**(4101 tests / 243 files,其中 5 条 skip)。**注意:裸 `bun test` 不再等于全量**——它确实跑到所有文件(路径过滤只在 `bun run test` 那条脚本里),但没有 `PNEUMA_TEST_LIVE=1` 时 live-tier 的 describe 整块 skip。**只有 `bun run test:all` 是全量**(4242 tests / 255 files),CI 的 release gate 也显式带上了这个变量。
- **全量之所以慢,几乎全部在 `backends/`**:126 个测试要 **247 秒**,其余七个目录加起来 34 秒。原因是 lifecycle harness **真的去 spawn `claude` / `codex` / `kimi acp` 并等真实模型回话**——所以它慢、要网络、还会 flake(见下面 `kimi-cli > resume` 那条)。**CI 不受影响**:CI 机器上没装这些二进制,那 126 条整体 skip。这也是为什么这套慢+脆的东西不该待在日常默认里。
- **Live tier(`PNEUMA_TEST_LIVE=1`)**:凡是**真的去 exec 一个外部二进制**的测试都归这一层——它们付进程、网络、和本机 auth 状态的钱(`gh auth status` 读一次 macOS keychain 实测 1.5–5.3s),而且断言取决于这台机器上恰好装了什么。日常 `bun run test` **跳过**它们;`bun run test:all` / `bun run test:backends` / CI 的 release gate 都带上这个变量,所以全量仍然一条不落。契约与用法写在 `core/__tests__/test-tier.ts`:**每一个 `describe` 都要 gate**(漏一个,那个"二进制不存在时应该……"的块会在装了该二进制的机器上直接红),**module-level 的探针也要 gate**(top-level `await` 在 collection 阶段就跑,早于任何 `skipIf`),并且调用 `announceLiveTierSkip()`——bun 默认 reporter 只打一个 `N skip` 数字、**不打名字**,标题里的理由只到得了 JUnit,那行 announce 才是终端里"为什么跳"的唯一出处。现役成员:`core/__tests__/github-cli.test.ts`(真 `gh`);`backends/**` 是同一层,只是它靠路径过滤而不是这个 flag 被排除在日常之外。
- **"睡到超时"的测试,超时值要小**:一条**只想证明 deadline 会响**的用例,成本就等于那个 deadline,而它对着的 `elapsed < X` 上界又是固定的——deadline 越短,余量越大。所以短 deadline 同时更快**且更不易 flake**,不是拿速度换稳。反过来,**同一次运行里既有 hang 又有 live 的用例没有便宜可占**:live 那半必须赶在同一个 deadline 之前答出来,两个要求互相拉扯(`cross-family-probe.test.ts` 的 `HANG_ONLY` / `HANG_PLUS_LIVE` / `LIVE_ONLY_TIMEOUT` 三档就是这么分的)。纯 live 的用例把 deadline 调大——它永远等不到,大是白送的余量。
- **并行分片(`bun run test:shard`)是实验项,不能当默认**:计数与串行一致,但并行负载下 `cross-family-probe` 写进临时目录的 `bash` stub 会超过 3 秒才被 exec 起来,liveness 探针于是把装好的 CLI 报成 dead;其余 exec 密集的 wordtaste 文件只是变慢。把那条 deadline 调大是买静音不是修——先量清楚 exec 延迟去了哪(计时前空跑一次 stub 预热即可证伪首次 exec 的安全策略评估),再谈默认。
- Scope with a path (`bun test server/`) while iterating.
- Tests are **colocated** in `__tests__/` dirs next to the code they pin (`core/__tests__/`, `server/__tests__/`, `backends/*/__tests__/`, `modes/*/__tests__/`, …). New behavior ships with tests pinning it; contract changes require `core/__tests__/` updates.
- **Backend lifecycle suites** count `(skip) ... binary not available` toward `skip`, not `fail` — those are fine on machines without the CLI installed. Any `fail` is a stop.
- Prefer real code over mocks where cheap — Bun spins up real servers/files fast. Don't write tests that only exercise the mock.

## Gotchas

- **Shared lifecycle prompts must use backend-neutral tasks.** The file-writing scenario asks for one newline-terminated line and verifies its exact content. Naming Claude's `Write` tool excludes other tool vocabularies; requiring no final newline also led Codex to retry an unsupported GNU patch marker until the scenario timed out. Keep the same task and filesystem assertion across backends.
- **Hardcoded manifest versions**:`server/__tests__/` 与 backend lifecycle harness 有测试用字符串相等 pin `webcraftManifest.version` 之类。bump 任何 mode 版本前先 grep 旧字符串(见 `/bump` step 4b),否则本地静默、CI 在 release gate 上炸。
- **Bun `os.homedir()` 启动时缓存**:测试里改 `process.env.HOME` 不影响 `homedir()`。需要 tmp home 的被测模块要读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`(`core/agent-command-installer.ts` 是先例)。
- **Shadow-git 测试**:checkpoint 操作必须串行(Promise chain),测试里也不要并行触发,防 `index.lock`。
- **ffmpeg `drawbox` 的 `x`/`y` 表达式只在 config 阶段求值一次(ffmpeg 8.0,2026-09-14 实测)**:`drawbox=y=17+2*sin(2*PI*t)` 画出来的"呼吸"片子逐帧完全相同(20 帧 max |Δ| = 0),ffmpeg 退出码 0、没有任何警告。sprite 的 `buildClip` fixture 因此静了整整一个 release,`from-video` 的断言一条都没察觉。要让元素随 `t` 动,用 `overlay`(默认 `eval=frame`)叠上去:`color=…[bg];color=…[box];[bg][box]overlay=x=22:y=<expr>`,表达式里的逗号要转义(`gte(t\,0.5)`)。判据:**任何靠"每帧都不一样"立论的 fixture,建完要量一次逐帧差分**,别信滤镜文档里的 `t`。

- **单独跑 `bun test backends/kimi-cli/` 是一个无效探针**(2026-08-19 实测):它会报 `2 fail / 2 errors`,内容是 `ReferenceError: Cannot access 'kimiCliModule' before initialization`(`backends/index.ts:33` 的循环 import)——那是**只在单独跑这个目录时才出现的加载顺序产物**,不是第二个缺陷。要给某个 backend 的 lifecycle 定位,跑 `bun test backends/`(整个目录)或全量,别缩到单个 backend 目录。
- **Resume assertions cover the completed turn.** `backends/__tests__/lifecycle-harness.ts` now waits for `result` and asserts over `assistantTextOfTurn` for both Claude and bridge-backed resumes. The historical Kimi failure (2026-08-25, kimi 0.38.0) came from inspecting the first assistant envelope, which could contain thinking without the answer; that harness bug is fixed. Preserve the completed-turn assertion. Investigate new failures against current output and code; an unchanged `backends/` diff alone does not prove a failure is unrelated. Transport-closed messages can come from teardown, so check their order against the failed assertion before treating them as the cause.
- **`bin/` 的 CLI 测试断言的是英文文案,而 `bin/i18n.ts` 在 import 时就从 `~/.pneuma/settings.json` 的 `locale` 定语言**(2026-09-05 实测):launcher 里把 UI 切成中文后,`handoff-cli.test.ts` 与 `pneuma-cli-helpers.test.ts` 会红 6 条(`接力已提交…` / `工作区已绑定到后端…`),CI 上没有这个文件所以绿。改 `LANG` 无效——用户偏好优先于环境变量。断言英文文案的测试文件要自己 `import { i18next } from "../i18n.js"`,在 `beforeAll` 里 `changeLanguage("en")`、`afterAll` 还原;这两个文件已经这么做了,新加断言文案的文件照抄。
- **`backend lifecycle: codex > *` 五条全红、日志只有 `[codex-adapter] Error notification: Unknown error`,先看 `~/.codex/config.toml` 的 `model`**(2026-09-05 实测):本机把它钉在一个比已装 codex-cli 更新的模型上时,app-server 每一轮回 400 `The '<model>' model requires a newer version of Codex`,harness 等不到 assistant message 就超时;`codex exec` 单独跑照样正常,所以别拿它当探针。adapter 只读 `params.message` / `params.msg.message`,而这个错误藏在 `params.error.message` 里,于是 UI 和日志都只剩 "Unknown error"——要看原文,在 `case "error"` 里临时 `JSON.stringify(params)`。CI 机器没有 codex,这五条在那里是 skip。
