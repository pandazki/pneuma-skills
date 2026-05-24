# Mode Anatomy

> 一个 mode 在磁盘上长什么样、manifest 每个字段填什么、哪些必有哪些选填。本篇是骨架速查；语义见 `docs/reference/viewer-agent-protocol.md`。

## 目录骨架

```
modes/<name>/
├── manifest.ts          ★ 纯数据声明（backend + frontend 都 import；不含 React）
├── pneuma-mode.ts       ★ ModeDefinition 绑定（manifest + ViewerContract，仅 frontend 动态 import）
├── domain.ts            △ 当 sources 用 aggregate-file 时配它写 load/save 纯函数
├── skill/
│   ├── SKILL.md         ★ Agent 的项目指引（per-mode 版的 CLAUDE.md）
│   ├── references/      ○ Progressive disclosure 的进阶资料
│   ├── presets/         · 主题集（slide 用）
│   ├── rules/           · 编译规则（remotion 用）
│   └── scripts/         · 共享脚本拷贝目标（modes/_shared/scripts/ 是源头）
├── seed/                ★ 第一份种子内容；可以是单文件，也可以是 N 个 content set
├── viewer/              ★ React PreviewComponent + utils
│   ├── <Name>Preview.tsx   ★ 主组件（默认导出）
│   └── scaffold.ts      ○ 复杂 mode 抽离的初始化函数（webcraft / slide 有）
├── showcase/            ★ showcase.json + hero.png + 3-4 张 highlight 图
│   └── showcase.json    ★ Launcher gallery 的卡片素材
├── NOTICE.md            △ 当借鉴他人内容需要标 license 时
└── __tests__/           · 视情况；目前仅 kami 用于验证 domain 逻辑
```

★ 必有  △ 视情况  ○ 推荐  · 偶尔

### Skeleton check（从 6 个现役 mode 抽出来的统计）

| 文件 | webcraft | slide | diagram | illustrate | remotion | kami |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| domain.ts | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| pneuma-mode.ts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| hooks/ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| __tests__/ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| NOTICE.md | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| skill/references/ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |

**读法：** domain.ts 与 aggregate-file 强相关；hooks/ 仅必要时（多数 mode 用 util 函数而非 hook 树）；NOTICE.md 只在借了他人内容时；skill/references/ 几乎人人都有，是 SKILL.md 主体的减负器。

---

## manifest.ts 字段矩阵

`core/types/mode-manifest.ts::ModeManifest` 是完整契约。下表标"现役 6 mode 谁填了什么"，用于选填决策。

| 字段 | 类型 | 必填 | 用途 | 6 mode 命中 |
|------|------|------|------|------------|
| `name` | `string` (kebab-case) | ★ | 唯一 id | 6/6 |
| `version` | `string` (semver) | ★ | 跟 `skill-version.json` 比对触发更新提示 | 6/6 |
| `displayName` | `LocalizedString` | ★ | UI 显示 | 6/6 |
| `description` | `LocalizedString` | ★ | UI 描述、launcher 卡片 | 6/6 |
| `icon` | `string` (SVG inline) | ★ | Mode icon | 6/6 |
| `changelog` | `Record<string, string[]>` | ○ | per-version highlights，触发 skill update 提示时拼出来给用户 | 2/6 |
| `skill` | `SkillConfig` | ★ | sourceDir / installName / mdScene / envMapping / mcpServers / sharedScripts / skillDependencies | 6/6 |
| `viewer` | `ViewerConfig` | ★ | watchPatterns / ignorePatterns / refreshStrategy | 6/6 |
| `agent` | `AgentPreferences` | ○ | permissionMode / greeting | 5/6 |
| `init` | `InitConfig` | ★ | seedFiles / params / deriveParams / contentCheckPattern | 6/6 |
| `viewerApi` | `ViewerApiConfig` | ○ | workspace / actions / commands / scaffold | 5/6 |
| `evolution` | `EvolutionConfig` | ○ | directive 给 evolve agent | 6/6（建议必填） |
| `showcase` | `ModeShowcase`（manifest 内）OR `showcase/showcase.json`（外部） | ★ | Gallery 营销素材 | 6/6 走外部 JSON 路径 |
| `supportedBackends` | `string[]` | · | 锁后端用 | 1/6 (remotion) |
| `pneumaVersion` | `string` (semver range) | ○ | 仅外部 mode 需声明，触发兼容性提示 | 内置 mode 不需 |
| `inspiredBy` | `{ name, url }` | △ | 标注上游、非许可性质 | 1/6 (remotion) |
| `layout` | `"editor" \| "app"` | ○ | "app" 是全屏 viewer + 浮动 chat | 1/6 (remotion) |
| `window` | `{ width, height }` | ○ | Electron 启动窗口尺寸 | 1/6 |
| `editing` | `{ supported: true }` | △ | 启用 view/edit 切换 | 视 mode 而定 |
| `proxy` | `Record<string, ProxyRoute>` | △ | viewer 反代外部 API 绕 CORS | 1/6 (diagram → draw.io) |
| `sources` | `Record<string, SourceDescriptor>` | ★ | viewer 数据通道声明 | 6/6 |
| `hidden` | `boolean` | △ | 内部 mode（evolve / project-onboard 等）用 | 内置时填 |

> **决策线：** `★` 永远填；`○` 几乎都填，缺了 viewer 还能跑但 agent 缺少线索；`△` 视具体设计；`·` 极少。`name / displayName / description / icon / skill / viewer / init / sources` 是不可省略的 8 个核心字段。

---

## 选填字段的决策线

- **没有外部 API key 需求** → 不填 `init.params`（默认空）；仍要填 `init.seedFiles` 与 `init.contentCheckPattern`。
- **没有借鉴上游 / 不输出他人内容** → 不写 `NOTICE.md`，不填 `inspiredBy`。
- **viewer 不需要全屏沉浸** → 不填 `layout`（默认 `"editor"` 双面板）。
- **mode 内永远在创作态** → 不填 `editing`（默认永远 `true`）。
- **viewer 不调用外部 web API** → 不填 `proxy`。
- **不打算让 evolve agent 学这块** → 仍建议填 `evolution.directive`，因为 evolve 是 mode 长期迭代的杠杆；只有在该 mode 本身是 hidden internal mode 时才不填。

---

## pneuma-mode.ts 的角色

`pneuma-mode.ts` 默认导出一个 `ModeDefinition`：

```ts
// modes/<name>/pneuma-mode.ts
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import manifest from "./manifest.js";
import { Preview } from "./viewer/Preview.js";

const mode: ModeDefinition = {
  manifest,
  viewer: {
    PreviewComponent: Preview,
    extractContext(selection, files) { /* … */ },
    workspace: {
      type: manifest.viewerApi!.workspace!.type,
      multiFile: manifest.viewerApi!.workspace!.multiFile,
      ordered: manifest.viewerApi!.workspace!.ordered,
      hasActiveFile: manifest.viewerApi!.workspace!.hasActiveFile,
      resolveItems(files) { /* … */ },
      resolveContentSets: /* createDirectoryContentSetResolver() if 多内容集 */,
      createEmpty(files) { /* … */ },
    },
    actions: manifest.viewerApi?.actions,
    updateStrategy: "incremental",
  },
};

export default mode;
```

**分工：**
- `manifest.ts` 不能 import React，因为 backend（Bun runtime，不带 React）也要 import 它做 skill-installer。
- `pneuma-mode.ts` 是 frontend 专属——它 import viewer 的 React 组件、import `manifest`、绑出一个完整的 `ModeDefinition`。
- 框架的 `mode-loader.ts` 在 frontend 动态 import `pneuma-mode.ts`；skill-installer 与 backend 经 `core/mode-loader.ts::loadModeManifest()` 走 `manifest.ts`。

---

## 命名约定

- **mode name**：kebab-case（`webcraft`, `mode-maker`），与目录名一致。
- **installName**（`skill.installName`）：`pneuma-<name>`（如 `pneuma-webcraft`）。skill 安装后落在 `<sessionDir>/.claude/skills/pneuma-<name>/`。
- **PreviewComponent**：PascalCase + `Preview` 后缀（`WebPreview`、`SlidePreview`、`DiagramPreview`）。
- **showcase 图片**：kebab-case（`design-commands.png`, `drag-reorder.png`），尺寸 1376×768。
- **content set 目录**：`<purpose>` 或 `<locale>-<theme>`，前者如 `pneuma-brand` `feature-cards`，后者如 `en-light` `zh-dark`。

---

## 注册步骤

新 mode 创建后必须在两处声明：

1. **`CLAUDE.md`** —— `**Builtin Modes:**` 行追加 mode name。
2. **`README.md` "Built-in Modes" 表** —— 追加一行（除非 `hidden: true`）。
3. **`AGENTS.md`** —— 通过 `cp CLAUDE.md AGENTS.md` 同步（版本 bump checklist 已经写明）。

`bin/pneuma.ts` 不需要硬编码 mode 名（所有 mode driven by ModeManifest）；`pneuma <name>` 启动会经 `core/mode-resolver.ts` 找到 `modes/<name>/manifest.ts`。
