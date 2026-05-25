# 欢迎来到星图 — bootstrap 版本

你现在看到的这张星图是 **Pneuma Skills 投影它自己**。

这不只是个炫技 demo。Pneuma 是让星图本身成为可能的项目——它的协议
表面、它的运行时、它的 viewer-contract、它的后端、它的 mode、它
的参考文档。把它投影成一张星图，你一屏就拿到 gestalt：哪些抽象是
承重的、什么依赖什么、从哪里开始读。

> **关于语言** — 这张星图的散文字段全是中文。Source 之类来自 pneuma-
> skills 自身的英文源码的名字（`ModeManifest`、`Source<T>`、
> `viewer-contract.ts` 等等）保留原文——它们是代码标识符，不是显
> 示文本。当你让 agent 投影 *你自己的* 中文 / 日文 / 法文项目时，
> 它会跟随你的工作语言；稳定标识符 + type system（`node.type`、
> `edge.type`、所有 `id`）始终保持英文 / kebab-case，因为它们是
> 词汇，不是显示文本。详见 `skill/SKILL.md` 的 **Language** 核心规则。

## 这张星图里有什么

- **~56 个节点**，分布在六层：
  - **契约（琥珀）** — `core/types/` 里那一组其他一切都对它们
    编程的类型。`ModeManifest`、`ViewerContract`、`Source<T>`、
    `AgentBackend`、`BackendModule`、…
  - **运行时（紫）** — 服务端机器：mode-loader、source-registry、
    skill-installer、ws-bridge、handoff-routes、…
  - **后端（青）** — Claude Code、Codex、Kimi CLI。
  - **模式（橙）** — 14 个 mode 包，包括 `cosmos` 自己（meta 回路）。
  - **外壳（粉）** — 挂载 viewer 与驱动 chat 的 React 前端。
  - **参考（薄荷）** — `docs/reference/`、`CLAUDE.md`、以及
    `create-mode` skill 里的正典叙述。
- **~66 条边**，动词都很具体——`implements` / `subscribes_to` /
  `documents` / `composes` / `dispatches` / `generated_via` / …
- **一份 7 步导览**，带你从协议表面走到代表这个 mode 自己的
  `cosmos` 节点，再走到生成了它的 skill。
- **6 个视角导览**（Perspectives），每个用一个设计透镜重读这张星
  图：契约-作为-锚点、文件-vs-领域 tension、origin-tagged 回路、
  instructions 文件作为 convergence、后端正交性、cosmos 的自相似。

点 viewer 里的 **导览** command 走一遍主线 tour。点侧栏里某一层
来 focus 它（其它层暗下去）。切 **密度** 在节点卡片上换更多/更少
细节。

## 把它用在你自己的内容上

第一次说"用新输入重新投影"时，这张 seed 就会被替换。一些套路：

- **拖一个源代码文件夹进来**，让 agent 投影它——你会拿到一张图，
  节点是 `file` / `function` / `class` / `module`，边是 `imports` /
  `calls` / `extends`。新代码库时很有用。
- **拖一个短篇或章节**（比如 `story.md`）——你会拿到 `character` /
  `event` / `clue` / `inference` 节点，动词像 `discovers` /
  `supports` / `contradicts`。密集小说或侦探推理时很合适。
- **拖一篇研究论文或技术 brief**——你会拿到 `claim` / `evidence` /
  `method` 节点，边是 `supports` / `refutes` / `cites`。
- **拖一份对话记录**——你会拿到一张决策图，节点是 `participant` /
  `claim` / `decision` / `open-loop`，边是 `replies_to` /
  `agrees_with` / `resolves`。

词汇是开放的。Agent 按内容领域选；起点 catalog 见
`skill/references/node-type-vocabularies.md`。

## 准备好了就开始

把这个 `cosmos.json` 替换掉（agent 在 `regenerate` 时会做），或
者直接说"把这个文件作为星图投影"，把 agent 指到内容。viewer 实时
重渲染。
