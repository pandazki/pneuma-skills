---
paths:
  - "modes/**"
---

# Mode Authoring Rules

## Baseline

- **Creating a new mode?** Use the `create-mode` skill (`.claude/skills/create-mode/`) — discovery interview → design brief → skeleton. Do not hand-roll the structure.
- **`manifest.ts` must have no React imports** — it is read by both the Bun backend and the frontend. React bindings live in `pneuma-mode.ts` (`ModeDefinition = { manifest, viewer }`); that split exists on purpose.
- **Hidden modes**: `hidden: true` removes a mode from user-pickable lists (launcher grids, ProjectPanel tiles). Internal modes (`evolve`, `project-evolve`, `project-onboard`, `project-tidy`) are hidden — triggered by UI affordances or programmatically only.
- **Shared assets**: global skills in `modes/_shared/skills/` (e.g. `pneuma-preferences`); shared scripts in `modes/_shared/scripts/` opted in via `SkillConfig.sharedScripts`, copied per-mode at install. Share *script sources* across modes, not SKILL.md guidance — each mode owns its own skill text.
- **Language exception**: Chinese is allowed in mode seed templates (`zh-light/`, `zh-dark/`) and showcase content. Everything else stays English.

## Gotchas

- **翻 `session.json` 的 `editing: false → true` 会唤醒那个 workspace 上一个 agent，而它会开始改文件。** 想在一个 `--viewing` session 里调 viewer action 时很容易踩：`dispatchViewerAction` 需要一个真的 attached backend，于是有人去翻这个标志位。后果实测过（2026-08-11）：`claude --resume` 被拉起、浏览器一连上、viewer 就把积压的通知（那次是 `refUnresolved`）转给它，**它当真去编辑了内容文件**——而那些文件在仓库外，没有 git 兜底。要驱动 viewer action，**开你自己的 session**，不要复活别人的；真要翻这个标志位，先确认那个 workspace 没有可复活的 agent，用完立刻翻回去。
  **补充(2026-08-12，同一坑在 `editing: true` 的全新 session 上复现)**:「开你自己的 session」不是免疫。一个为了验证板面而新建的编辑 session，agent 在浏览器一连上就收到积压通知(`[ws-bridge] Viewer notification forwarded to CLI: boardCollision`),**没有任何人给它下指令**,它自己就去改了内容文件——追加了一个 `@erase` 并复制了两段内容。**通知转发是 idle-flush，不区分"这个 agent 是被人拉来干活的"还是"它只是恰好活着"**。所以拿一个编辑 session 当观察工具时,要么把内容文件 `chmod 444` 圈起来(实测有效),要么用 `--viewing` 且不去碰那个标志位。任何"我只是看看"的 session,只要它有 agent 且浏览器连上,它就可能动手。
- **Seed gallery auto-derive is directory-only**:mode 没声明 `init.seeds[]` 时,`resolveSeedCatalog` 只把 directory-shaped 的 `seedFiles`(src/dst 以 `/` 结尾,或 dst 是 `./`/`""`)做成 gallery card;单文件条目被视为 framework setup 直接丢弃。真想要单文件模板的 mode **必须**显式声明 `init.seeds[]`。前端 `App.tsx` 的 `hasSeedsDeclared` 镜像了这条规则,两处要同步改。
- **Mode skill version bump 必须带 `changelog`**:`manifest.ts` 的 `version` 动了,就要在 `changelog` map 加同 key 的条目(launcher 的 skill-update 提示从这里取 bullets)。同时 grep 旧版本字符串——`server/__tests__/` 与 backend lifecycle harness 里有测试硬编码 manifest version。
- **Viewer 改动遵守 frontend rules**(`.claude/rules/frontend.md`):视觉验证、design tokens、snapdom/缩略图约束都适用于 `modes/*/viewer/`。
- **SKILL.md 模板变量**:`{{key}}` / `{{viewerCapabilities}}` 由 skill-installer 替换;不要在 skill 文本里发明新的模板语法。
- **`generate_image.mjs --style sketch` 会改写你的 prompt**:它不是一个开关,而是在 model dispatch 之前把 `, no shading, white background` 追加到 prompt 尾巴上(`modes/_shared/scripts/generate_image.mjs`)。任何靠"生成图自身明暗"做合成的 mode(bansho 的板书插图靠 luminance 当遮罩)拿到的就是一整块实心白 —— 图看着"生成成功",落到板上是个方块。**自己在 prompt 里写死风格的 mode,一律不要传 `--style`**(默认 `photo` 不动 prompt)。顺带:prompt 是**位置参数**,没有 `--prompt` 这个 flag,写了直接当第二个 positional 吞掉。
- **在 worktree 里验证 fal 相关脚本时,key 找不到不等于没有 key**:`generate_image.mjs` / `generate-tts.mjs` 的 `findEnvFile()` 先看 skill root,再**从 cwd 往上**逐级找 `.env`。仓库的 key 在主 checkout(`/Users/pandazki/Codes/pneuma-skills/.env`)里,而 worktree 挂在**另一棵目录树**下(`~/orca/workspaces/...`),往上走永远走不到它——脚本于是老老实实报 `ERROR: No API key found`,看起来像"用户没给 key"。验证前先 `set -a; . <主 checkout>/.env; set +a`。生产环境不受影响:session 的 key 由 `envMapping` 写进 session `.env`,而 agent 的 cwd 就是 `PNEUMA_SESSION_DIR`。
- **Seed/showcase 物料**:showcase 内容在 `modes/<name>/showcase/showcase.json` + `hero.png` + 3-4 `highlight-*.png`,由 `/showcase` command 生成,不要手画占位图。
