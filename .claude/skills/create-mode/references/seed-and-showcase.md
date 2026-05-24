# Seed & Showcase

> 一个新 mode 启动时给用户"看的第一眼"。Seed 是用户在空 workspace 上打开 mode 时框架自动写入的内容；showcase 是 launcher gallery 上的营销素材。

---

## Seed 策略

### 三种形态

| 形态 | 适合 | 例子 |
|------|------|------|
| **单文件** | 单一 main file 的 mode（draw、diagram、remotion 项目） | `diagram.drawio`、`src/Root.tsx` 等 |
| **多内容集（use-case 驱动）** | 用户会用 mode 做多种用途，每个用途配一份示范 | webcraft（pneuma / gazette / pneuma-console），illustrate（pneuma-brand / feature-cards / blog-heroes） |
| **多内容集（locale × theme）** | 国际化或主题对称演示 | slide（en-dark / en-light / zh-dark / zh-light） |

**选哪种？** 看你的 mode 用户的"创作单元"是什么。如果一份 deck 就是一个完整产物（slide），content sets 沿用途或语言分；如果一张 diagram 自成一个产物（diagram），单文件即可。

### Seed 不是模板

**Seed 是"看到就能用"的具体例子**，不是空白模板。新用户进入 mode 后应该看到一个完整的、可工作的内容样例——它告诉用户"这个 mode 能做这样的东西"。

- ❌ `slide-1.html` 只写一句 "Title here"
- ✓ `slide-1.html` 是一张真做出来的 slide，配色、字体、布局都到位

**Seed 像是产品演示，不是脚手架占位符。**

### 多 content set 的命名

| 模式 | 模式 | 例子 |
|------|------|------|
| Use-case 驱动 | `<purpose-noun>/` | `pneuma-brand/`, `feature-cards/`, `blog-heroes/` |
| Locale × theme | `<locale>-<theme>/` | `en-light/`, `zh-dark/` |
| 混合 | 上述任意 + `_shared/` | kami 的 `_shared/` 装跨 content set 共享资源 |

`_shared/` 目录在 `kami` 里被用作多 content set 共享资源（字体、CSS、模板片段）。这是约定，不是必须。

### Seed 与 init.seedFiles

`manifest.init.seedFiles` 把 mode 包内的 seed 文件映射到 workspace：

```ts
init: {
  contentCheckPattern: "**/*.html",
  seedFiles: {
    "pneuma-brand/index.html":     "seed/pneuma-brand/index.html",
    "pneuma-brand/manifest.json":  "seed/pneuma-brand/manifest.json",
    "feature-cards/index.html":    "seed/feature-cards/index.html",
    "feature-cards/manifest.json": "seed/feature-cards/manifest.json",
    // ...
  },
}
```

- **key** = workspace 中的目标相对路径
- **value** = mode 包内的源相对路径（相对于 `modes/<name>/`）

**只在 `contentCheckPattern` 匹配不到任何文件时写入。** 用户已经创作了内容的 workspace 不会被 seed 覆盖。

### Init 参数与 seed 模板替换

Seed 文件可以用 `{{param}}` 模板变量，会被 `init.params` 收集的值替换。例：

```html
<!-- seed/pneuma-brand/index.html -->
<style>
  body { font-family: {{primaryFont}}, sans-serif; }
</style>
```

manifest 端：

```ts
init: {
  params: [
    {
      name: "primaryFont",
      label: "Primary font family",
      type: "select",
      options: ["Inter", "DM Serif Display", "JetBrains Mono"],
      defaultValue: "Inter",
    },
  ],
  seedFiles: { /* ... */ },
}
```

`deriveParams` 可以从 `params` 算派生值（如 paperWidth/paperHeight from paperSize）；同样可在 seed 里引用。

---

## Showcase

### 文件位置

`modes/<name>/showcase/`（与 `manifest.ts` 是 sibling，**不在 manifest 里 inline**）。框架通过 `GET /api/modes/:name/showcase/*` 服。

```
modes/<name>/showcase/
├── showcase.json    ★ 文案配置（必有）
├── hero.png         ★ 1376×768，首屏图
├── highlight-1.png  ★ 1376×768
├── highlight-2.png  ★ 1376×768
├── highlight-3.png  ★ 1376×768
└── highlight-4.png  ○ 复杂 mode 可加 4th
```

### `showcase.json` schema

```json
{
  "tagline": {
    "en": "Short punchy tagline (5-10 words, no period)",
    "zh-CN": "中文短句标语",
    "ja": "日本語のキャッチコピー"
  },
  "hero": "hero.png",
  "highlights": [
    {
      "title": {
        "en": "Feature Name",
        "zh-CN": "功能名称",
        "ja": "機能名"
      },
      "description": {
        "en": "1-2 sentences. Concrete, benefit-focused.",
        "zh-CN": "一两句话。具体、聚焦益处。",
        "ja": "1〜2文。具体的に、利点に焦点を当てる。"
      },
      "media": "drag-reorder.png",
      "mediaType": "image"
    }
    // 通常 3 项，复杂 mode 4 项
  ]
}
```

### 写文案的几条经验

- **Tagline**：5-10 词，无句号结尾，evocative。"AI-orchestrated video production"、"Paper-canvas typesetting"。
- **Highlight title**：2-4 词，title case。"Design Commands"、"Drag Reorder"、"Export Options"。
- **Highlight description**：1-2 句，具体收益。"Drag slides to reorder; the manifest updates automatically and the agent picks up the new sequence on its next read." — 比 "Easy reordering" 信息量大得多。
- **多语言**：至少 `en` / `zh-CN` / `ja`。skill-installer 没有强制；缺失时 framework 自动 fallback 到 `en`。

### 图片命名

- **kebab-case** + 描述性。`design-commands.png`, `drag-reorder.png`, `responsive-preview.png`。
- 文件名应该跟 highlight title 对应——读到 title 能预测 media 是哪张。

### 图片生成

`/showcase` 命令（位于 `.claude/commands/showcase.md`）封装了图像生成流程，遵循 "Ethereal Tech Dark Mockup" 美学：

- 深色背景（`#09090b` 到 `#18181b`，柔和 radial gradient）
- 内容是**风格化 UI mockup**——不是真截图，是简化的概念示意
- 橙色强调（`#f97316`）用在交互元素
- 常见构图模式：input → output 配橙色箭头、before/after 对照、dashboard overview、canvas + toolbar、feature callout

**Hero 图**：mode 的总览——workspace 在动作中是什么样的最有冲击力的状态。

**Highlight 图**：每张聚焦一个 feature，看图就能看懂这功能干啥。

### Create-mode 时怎么处理图片？

**Phase 3 的最后一步**调 `/showcase` 流程生成图。你已经在 Phase 3 早些时候写好 `showcase.json`——其中 `description` 字段就是每张图的生成 brief。

如果当前 session 没有图像生成能力（无 API key 等），明确告诉用户："文案 `showcase.json` 已就位，imagery 待你后续手动跑 `/showcase` 时补上"——这是有效的中间状态。

---

## Seed × Showcase 的呼应

Seed 与 showcase 应当讲同一个故事：

- Seed 里的 `pneuma-brand` 内容集 → Showcase 的 hero 图应该展示 `pneuma-brand` 渲染成什么样
- Seed 里的"3 种用途" → Showcase 的 3 个 highlight 对应这 3 种用途
- Seed 的命名约定（kebab-case purpose noun）→ Showcase 图片命名同样的 noun

这种呼应让"新用户启动 mode 后看到的"与"在 launcher gallery 上看到的"是连续的——不需要二次说服。

---

## 反模式

- ❌ **Seed 用 Lorem Ipsum**：用户进来看到占位符以为是 broken state；用真实内容（你自己产品的、知名 demo 的、虚构但可信的）。
- ❌ **Showcase 用真实截图**：截图老旧、UI 一变就过时；用风格化 mockup（参考 `.claude/commands/showcase.md`）。
- ❌ **Highlight title 写动词**：title 是 noun (Design Commands)；description 是动词的事。
- ❌ **Seed 内容只覆盖一种用法**：用户会以为 mode 只能做这一种；至少 2-3 个 content set，每个示范一种用法。
- ❌ **Tagline 用句号结尾**：tagline 是名词短语，不是句子。
