# Case Studies — Patterns by Reference Mode

> 当你要做一个具体选择时，想知道"哪个现役 mode 已经做过这个选择？" —— 用这张索引找到那个 mode，去它的源代码里看实例。

按"我现在在纠结的问题"组织。

---

## "我的 domain 是什么样的？"

| 你的 domain 是 | 看这个 mode | 关键文件 |
|---|---|---|
| 多文件聚合成一个 deck/site/studio（典型创作型） | **slide** | `modes/slide/domain.ts`（aggregate-file load/save） |
| 单文件结构化（如 ClipCraft Project） | clipcraft（外） | `modes/clipcraft/domain/types.ts` |
| 每个文件独立、用户编辑 N 份 | **doc** / **diagram** | `modes/doc/manifest.ts`（file-glob 单 patterns） |
| 多页 site，页与页有结构 | **webcraft** | `modes/webcraft/domain.ts` |
| 单张纸 / 单画布 | **kami** / draw | `modes/kami/domain.ts`、`modes/draw/` |
| 行式画布（图像集合，逐行铺开） | **illustrate** | `modes/illustrate/domain.ts` |
| 视频项目（src/ 下 N 个 .tsx，靠 compiler 黏合） | **remotion** | `modes/remotion/manifest.ts`（file-glob src/**/*.tsx） |

## "Source 选哪种 kind？"

| Source kind | 谁在用 | 理由 |
|---|---|---|
| `aggregate-file` | webcraft, slide, illustrate, kami | Domain 是聚合体，文件是它的存储形态 |
| `file-glob` | diagram, remotion, doc | 文件就是 domain，每个独立 |
| `json-file` | （现役未用；适合单文件 JSON 结构 mode） | — |
| `memory` | （现役未用；适合 ephemeral session state） | — |

## "ViewerAddress 词表怎么定？"

| Mode | Address shape | 适用情形 |
|---|---|---|
| slide | `{ contentSet?, slide, file?, selector? }` | 用户主要选 slide，偶尔深到 DOM region |
| webcraft | `{ contentSet?, page, anchor?, selector? }` | 多页 site，三层深度（page → anchor → selector） |
| illustrate | `{ contentSet?, file?, rowId? }` | 选行 / 选图就够（图不可分割） |
| diagram | `{ pageId?, nodeId? }` | draw.io 多页文件，到 cell 为止 |
| doc | `{ file, heading?, lineRange? }` | 文本文档，标题 / 行号定位 |
| draw | `{ elementId? }` | 单画布，Excalidraw 元素 id |
| kami | `{ paperId?, ... }`（看 kami 自己定） | 单页或多页纸 |

**找你最像的，从那儿学粒度选择。**

## "actions 应该列哪些？"

| Action 类型 | 谁在用 | id 示例 |
|---|---|---|
| **navigate-to**（必有） | 每个 mode | `navigate-to`、`goto-slide`、`zoom-to-row` |
| **custom diagnostic** | slide, kami | `checkContentFit`、`checkOverflow` |
| **ui 状态切换** | webcraft | `set-content-set`、`toggle-grid` |
| **file 初始化** | webcraft, slide, illustrate（走 manifest.viewerApi.scaffold） | scaffold（manifest 声明，非自定义 action） |
| **`capture`** | 全部（框架内建，不在 manifest 列） | — |

## "viewer 怎么组织子组件？"

| 复杂度 | 看这个 mode | 经验 |
|---|---|---|
| 简单（一个 PreviewComponent + 几个 utils） | **doc**、**draw**、**illustrate** | 大组件 + utils 函数；不要细拆 hooks |
| 中（PreviewComponent + 工具栏 + canvas） | **webcraft**、**kami**、**diagram** | scaffold.ts 抽离初始化逻辑 |
| 高（PreviewComponent + navigator + viewer pool + 自定义 hooks） | **slide** | 切多个子组件（SlideNavigator / SlideViewer / HighlighterCanvas）+ 一两个 hooks（useSlideThumbnails） |
| 外部引擎驱动（compiler + error boundary + player） | **remotion** | RemotionPreview 是 thin shell；编译 / 渲染由 Remotion compiler 控 |

## "init.params 怎么用？"

| 场景 | 看这个 mode | 实例 |
|---|---|---|
| 选纸张尺寸 → 派生 width/height/margins | **kami** | `params: paperSize`，`deriveParams` 算 paperWidth/paperHeight |
| 选 video 分辨率 + fps → 派生 composition 设置 | **remotion** | `compositionWidth/Height/Fps/Duration` |
| API key + 派生 feature flag | **illustrate** / **webcraft** | `openrouterApiKey` + `deriveParams` 算 `imageGenEnabled` |
| 选 fontFamily 注入到 seed 模板 | (建议) | seed 里 `{{primaryFont}}` 模板替换 |

## "seed 怎么组织？"

| 形态 | 看这个 mode | 子目录 |
|---|---|---|
| 单文件 | **diagram** | `seed/diagram.drawio` |
| 单内容集（完整项目） | **remotion** | `seed/src/`、`seed/public/` 等 |
| Use-case 驱动多内容集 | **webcraft**、**illustrate** | `pneuma/`、`gazette/`、`pneuma-console/` |
| Locale × theme 多内容集 | **slide** | `en-light/`、`en-dark/`、`zh-light/`、`zh-dark/` |
| 多内容集 + 共享资源 | **kami** | `pneuma-one-pager/`、`kaku-portfolio/`、`nvda-equity-report/` + `_shared/` |

## "外部技术栈怎么集成？"

| 集成方式 | 看这个 mode | 加载点 |
|---|---|---|
| CDN + ProxyRoute | **diagram**（draw.io viewer-static） | `manifest.proxy.drawio`；viewer 里 `<script src="/proxy/drawio/...">` |
| npm + JIT 编译 | **remotion**（@remotion/player + @babel/standalone） | `viewer.refreshStrategy: "manual"` + RemotionCompiler |
| iframe srcdoc | **webcraft**（HTML preview） | viewer 用 srcdoc 注入 |
| 第三方 npm SDK 内嵌 | **draw**（@excalidraw/excalidraw） | viewer 直接 import |

## "borrow 自上游，NOTICE.md 怎么写？"

| Mode | 上游 | NOTICE 风格 |
|---|---|---|
| **webcraft** | Impeccable.style (Apache 2.0) | Version pinned (skill-v3.1.1)、22 条 design 命令映射、字段级 借/改/弃 表 |
| **kami** | tw93/kami (MIT) | Version pinned (v1.5.0)、design language 借鉴 + 字体许可（TsangerJinKai 商用） |

两个都遵循同样模板（见 `references/external-integrations.md::NOTICE.md`）。

## "evolution.directive 怎么写？"

按"学什么 + 怎么学 + 用在哪"三段：

| Mode | directive 摘要 |
|---|---|
| **webcraft** | 学用户的设计偏好（美学方向、配色、排版、布局） → 注入 mode skill 主体 → 影响主 agent 的设计决策默认值 |
| **slide** | 学用户的演示风格（排版、调色板、密度、结构模式） → 注入 skill → 影响默认幻灯片布局选择 |
| **kami** | 学内容密度倾向、中英文调性偏好、图表使用模式 → 注入 skill → 影响排版决策默认值 |
| **clipcraft** | 学剪辑节奏、镜头偏好、BGM 风格 → 注入 skill → 影响 timeline 默认操作 |

**找你最像的 mode，复用它的句式。**

---

## 速查规则

- 当你 **不知道哪个字段应该填什么**，去对照的现役 mode 里读 `manifest.ts` 同字段。
- 当你 **不知道某个 SKILL.md 段落该怎么写**，去对照 mode 的 `skill/SKILL.md` 同段落。
- 当你 **不知道 ViewerContract 五个面怎么实现**，去对照 mode 的 `pneuma-mode.ts`。
- 当你 **不确定 viewer 该怎么组织子组件**，去对照 mode 的 `viewer/` 目录结构。

**这张表的价值在于"从问题指向 mode"**，而不是"逐 mode 介绍它做什么"。Mode 之间的功能差异不重要——你要的是模式（pattern）。
