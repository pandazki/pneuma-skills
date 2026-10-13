---
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing Rules (bun:test)

## Baseline

- Runner is **`bun test`** (Bun native). Healthy output: `NNNN pass / NN skip / 0 fail`.
- Choose the command by scope. Ordinary runs leave expensive media and live
  tiers disabled unless explicitly opted in:

  | Changed area / task | Command |
  |---|---|
  | `src/**`, mode viewers | `bun run test:frontend` |
  | `server/**`, `bin/**`, `core/**`, `snapshot/**`, `plugins/**` | `bun run test:server` |
  | One mode | `bun test modes/<name>` |
  | One mode's real media pipeline | `PNEUMA_TEST_MEDIA=<name> bun test modes/<name> --timeout 60000` |
  | Backend / agent-command behavior | `bun run test:backends` |
  | Routine repository checks | `bun run test` |
  | Bump / release | `bun run test:release` |
  | All real-media checks without live backend opt-in | `bun run test:media --timeout 60000` |
  | Explicit full validation | `bun run test:all --timeout 60000` |
  | Experimental parallel run; not a release gate | `bun run test:shard` |

- **Release selection is deterministic.** `test:release` always runs common
  checks and mode declaration checks plus affected mode directories, using all changes since the nearest
  reachable stable release tag older than the target version, including local
  staged, unstaged and untracked work. It prints the changed files, baseline,
  selected modes and enabled tiers. `--dry-run` explains the plan; `--base <ref>`
  supplies a verified baseline; `--full` forces all tiers. Unknown impact or a
  missing baseline falls back to full coverage. The exact scope and metadata
  rules live in [release-process.md](../../.agents/skills/bump/references/release-process.md#deterministic-release-test-selection).
- **Media tier (`PNEUMA_TEST_MEDIA`).** Expensive ffmpeg/video integration is
  opt-in: `1` enables every media mode; a comma-separated list enables named
  modes. Routine tests retain cheap assertions, small adapter checks and mocked
  orchestration. Release selection enables the affected mode's media for runtime,
  viewer/domain, processing-script, fixture and runtime/test changes; a viewer
  export can be consumed by a media pipeline. Guidance-only paths and parsed
  manifest version/changelog-only edits stay cheap; seed Markdown is runtime
  input. Shared application source changes retain every suite and live backends,
  while media stays limited to changed modes; those pipelines execute mode-owned
  scripts. Shared image-family changes do not select unrelated video suites.
  Dependencies, test-environment changes, unknown impact and `--full` still enable
  all media. Changing the release selector runs all ordinary/backend checks;
  Git-fixture and runner-exit tests verify its selection policy.
  `test:media` opts into media only; `test:all` opts into media and live tiers.
- **Live tier (`PNEUMA_TEST_LIVE=1`).** Host CLI/authentication checks and backend
  lifecycle tests depend on installed binaries, local credentials and sometimes
  the network. `test:backends` and `test:all` opt in. The release selector opts
  in for backend, common runtime, template, dependency, test-configuration or
  unknown changes and `--full`. Affected mode runtime also enables its real-tool
  checks (such as Blender and Chrome), while backend lifecycle files remain
  excluded by path. Expensive media pipelines use the separate
  media tier. Bare `bun test`
  is not full validation; its opt-in tiers remain skipped.
- **Author tier gates in `core/__tests__/test-tier.ts` terms.** Gate every
  expensive describe/test and module-level binary probe, and announce skipped
  tiers. `describe.skipIf` still executes its callback: put expensive setup in
  gated hooks, never at collection time. Tests against local stubs remain cheap
  tests; do not hide them just because production uses an external binary.
- **Measure the current suite.** The 2026-10-12 local full run took 22m48s:
  Sprite alone took 14m37s and backends 3m23s. Earlier 4.5-minute release numbers
  predated the media suites and are not a planning baseline. These timings are
  observations on one machine, not deadlines or performance guarantees.
- **"睡到超时"的测试,超时值要小**:一条**只想证明 deadline 会响**的用例,成本就等于那个 deadline,而它对着的 `elapsed < X` 上界又是固定的——deadline 越短,余量越大。所以短 deadline 同时更快**且更不易 flake**,不是拿速度换稳。反过来,**同一次运行里既有 hang 又有 live 的用例没有便宜可占**:live 那半必须赶在同一个 deadline 之前答出来,两个要求互相拉扯(`cross-family-probe.test.ts` 的 `HANG_ONLY` / `HANG_PLUS_LIVE` / `LIVE_ONLY_TIMEOUT` 三档就是这么分的)。纯 live 的用例把 deadline 调大——它永远等不到,大是白送的余量。
- **并行分片(`bun run test:shard`)是实验项,不能当默认**:计数与串行一致,但并行负载下 `cross-family-probe` 写进临时目录的 `bash` stub 会超过 3 秒才被 exec 起来,liveness 探针于是把装好的 CLI 报成 dead;其余 exec 密集的 wordtaste 文件只是变慢。把那条 deadline 调大是买静音不是修——先量清楚 exec 延迟去了哪(计时前空跑一次 stub 预热即可证伪首次 exec 的安全策略评估),再谈默认。
- Scope with a path (`bun test server/`) while iterating.
- Tests are **colocated** in `__tests__/` dirs next to the code they pin (`core/__tests__/`, `server/__tests__/`, `backends/*/__tests__/`, `modes/*/__tests__/`, …). New behavior ships with tests pinning it; contract changes require `core/__tests__/` updates.
- **Backend lifecycle suites** count `(skip) ... binary not available` toward `skip`, not `fail` — those are fine on machines without the CLI installed. Any `fail` is a stop.
- Prefer real code over mocks where cheap — Bun spins up real servers/files fast. Don't write tests that only exercise the mock.

## Gotchas

- **happy-dom 20.11.1 MutationObserver notifications can disappear after GC** (2026-10-12). Its internal report callback is held only through a `WeakRef`; a timer boundary plus `Bun.gc(true)` reproduces the lost notification. For the iframe readiness test, subscribe to the real observer and release `aria-busy` in the same job, retaining the waiting and post-mutation assertions. Do not lengthen the timeout or change browser capture behavior to compensate for this test-environment defect.

- **Release timeout parity** (3.56.0 validation, 2026-10-08): `test:release` uses a 60-second per-test deadline locally and in CI; explicit full/media runs pass `--timeout 60000`. Sprite's frame-width registration test completed all 12 assertions in 5.3 seconds locally, exceeding Bun's default five-second deadline. Preserve its assertions and the release deadline; do not treat that default timeout as evidence of a product failure.
- **Shared lifecycle prompts must use backend-neutral tasks.** The file-writing scenario asks for one newline-terminated line and verifies its exact content. Naming Claude's `Write` tool excludes other tool vocabularies; requiring no final newline also led Codex to retry an unsupported GNU patch marker until the scenario timed out. Keep the same task and filesystem assertion across backends.
- **Hardcoded manifest versions**:`server/__tests__/` 与 backend lifecycle harness 有测试用字符串相等 pin `webcraftManifest.version` 之类。bump 任何 mode 版本前先 grep 旧字符串(见 `/bump` step 4b),否则本地静默、CI 在 release gate 上炸。
- **Bun `os.homedir()` 启动时缓存**:测试里改 `process.env.HOME` 不影响 `homedir()`。需要 tmp home 的被测模块要读 `process.env.HOME ?? process.env.USERPROFILE ?? homedir()`(`core/agent-command-installer.ts` 是先例)。
- **Shadow-git 测试**:checkpoint 操作必须串行(Promise chain),测试里也不要并行触发,防 `index.lock`。
- **ffmpeg `drawbox` 的 `x`/`y` 表达式只在 config 阶段求值一次(ffmpeg 8.0,2026-09-14 实测)**:`drawbox=y=17+2*sin(2*PI*t)` 画出来的"呼吸"片子逐帧完全相同(20 帧 max |Δ| = 0),ffmpeg 退出码 0、没有任何警告。sprite 的 `buildClip` fixture 因此静了整整一个 release,`from-video` 的断言一条都没察觉。要让元素随 `t` 动,用 `overlay`(默认 `eval=frame`)叠上去:`color=…[bg];color=…[box];[bg][box]overlay=x=22:y=<expr>`,表达式里的逗号要转义(`gte(t\,0.5)`)。判据:**任何靠"每帧都不一样"立论的 fixture,建完要量一次逐帧差分**,别信滤镜文档里的 `t`。

- **`describe.skipIf(cond)` still runs the describe body** (3.55.0 release gate, 2026-09-27). Only the tests inside are skipped. Setup at the describe's top level that needs a binary, such as an ffmpeg `writePng` guarded by `HAS_FFMPEG`, throws "Unhandled error between tests" on CI, which has no ffmpeg, even though the suite passes locally. Put such setup in `beforeAll`, and check by running the file with the binary removed from `PATH`.
- **Bun 1.4.0 `toMatchObject` with asymmetric matchers mutates the received object** (reproduced 2026-09-27). After `expect(o).toMatchObject({ list: expect.any(Array) })` passes, `o.list` is the matcher, so `Array.isArray(o.list)` is false. Don't reuse an object after such an assertion; assert plain values (`expect(Array.isArray(o.list)).toBe(true)`) or clone first.
- **单独跑 `bun test backends/kimi-cli/` 是一个无效探针**(2026-08-19 实测):它会报 `2 fail / 2 errors`,内容是 `ReferenceError: Cannot access 'kimiCliModule' before initialization`(`backends/index.ts:33` 的循环 import)——那是**只在单独跑这个目录时才出现的加载顺序产物**,不是第二个缺陷。要给某个 backend 的 lifecycle 定位,跑 `bun test backends/`(整个目录)或全量,别缩到单个 backend 目录。
- **Resume assertions cover the completed turn.** `backends/__tests__/lifecycle-harness.ts` now waits for `result` and asserts over `assistantTextOfTurn` for both Claude and bridge-backed resumes. The historical Kimi failure (2026-08-25, kimi 0.38.0) came from inspecting the first assistant envelope, which could contain thinking without the answer; that harness bug is fixed. Preserve the completed-turn assertion. Investigate new failures against current output and code; an unchanged `backends/` diff alone does not prove a failure is unrelated. Transport-closed messages can come from teardown, so check their order against the failed assertion before treating them as the cause.
- **`bin/` 的 CLI 测试断言的是英文文案,而 `bin/i18n.ts` 在 import 时就从 `~/.pneuma/settings.json` 的 `locale` 定语言**(2026-09-05 实测):launcher 里把 UI 切成中文后,`handoff-cli.test.ts` 与 `pneuma-cli-helpers.test.ts` 会红 6 条(`接力已提交…` / `工作区已绑定到后端…`),CI 上没有这个文件所以绿。改 `LANG` 无效——用户偏好优先于环境变量。断言英文文案的测试文件要自己 `import { i18next } from "../i18n.js"`,在 `beforeAll` 里 `changeLanguage("en")`、`afterAll` 还原;这两个文件已经这么做了,新加断言文案的文件照抄。
- **`backend lifecycle: codex > *` 五条全红、日志只有 `[codex-adapter] Error notification: Unknown error`,先看 `~/.codex/config.toml` 的 `model`**(2026-09-05 实测):本机把它钉在一个比已装 codex-cli 更新的模型上时,app-server 每一轮回 400 `The '<model>' model requires a newer version of Codex`,harness 等不到 assistant message 就超时;`codex exec` 单独跑照样正常,所以别拿它当探针。adapter 只读 `params.message` / `params.msg.message`,而这个错误藏在 `params.error.message` 里,于是 UI 和日志都只剩 "Unknown error"——要看原文,在 `case "error"` 里临时 `JSON.stringify(params)`。CI 机器没有 codex,这五条在那里是 skip。
