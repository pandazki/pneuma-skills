# Slide Skill Upgrade — 能力映射与迁移方案

## 背景

参考项目 (`a025-tanka-memory-output/pitch_deck/`) 拥有完整的 PPT 生成/编辑 pipeline：
- Python 工具链（LangChain + Gemini + FAL + 无头浏览器）
- Brain+Hands 多 Agent 架构（Main Agent 规划，Sub-agent 执行）
- 三层 Slide 模型（style / layout / content 分离）
- AI 图片生成 + 自动布局检测

Pneuma Slide Mode 的目标：**将同等能力迁移为 Claude Code 原生 Skill**，利用：
- Claude Code 本身作为唯一 Agent（无需 sub-agent）
- SKILL.md + 支撑文档 = 完整领域知识注入
- Viewer iframe 实时预览 = 自带"无头浏览器"
- chrome-devtools MCP = 截图 + 布局检测
- skill-installer 生命周期 = 依赖安装时机

---

## 能力清单：参考项目 → Pneuma 映射

### 1. 设计大纲工作流 (Design Outline) ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| Main Agent 收集信息 → 写 `design_outline.md` | SKILL.md 指导 Claude 先写大纲再生成 | ✅ 完成 |
| 大纲模板（目标、受众、风格、逐页内容） | `skill/design_outline_template.md` 参考文档 | ✅ 完成 |
| PlanSlides 工具读取大纲 → JSON 结构化 | Claude 直接读大纲 → 按规范生成 HTML | ✅ 简化 |

### 2. 三层 Slide 模型 (Style / Layout / Content) ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| `Slide` dataclass: style/layout/content JSON | `manifest.json` 扩展 slides 元数据 | ✅ 简化 |
| `GlobalStyle` dataclass: colors/fonts/effects | `theme.css` CSS 自定义属性 | ✅ 已有 |
| `PresentationManager` 状态管理 | 文件系统即状态（manifest.json + slides/*.html） | ✅ 已有 |
| style/layout/content 分离存储 → LLM 重新生成 | Claude 直接编辑 HTML（style 在 theme.css） | ✅ 简化 |

**决策**: 不引入独立的 style/layout/content JSON 存储。Pneuma 的文件系统模型（theme.css + 独立 HTML）已经天然分离了样式和内容。

### 3. HTML 生成规范 ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| 1280×720 固定画布 | 已有（initParams） | ✅ 已有 |
| Tailwind CSS CDN | SKILL.md + theme.css 基础类 | ✅ 完成 |
| ECharts 5 CDN | SKILL.md 允许使用 | ✅ 完成 |
| Lucide Icons CDN | SKILL.md 推荐 | ✅ 完成 |
| 禁止动画 | SKILL.md 明确禁止 | ✅ 完成 |
| 高度计算规则 | `skill/layout_patterns.md` 参考文档 | ✅ 完成 |
| 完整独立 HTML（含 DOCTYPE） | **保持 fragment 模式** | ✅ 决策完成 |

**决策**: 保持 fragment 模式。viewer 的 `buildSrcdoc()` + theme.css 注入机制运行良好。

### 4. 编辑操作 ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| UpdateSlideContent | Claude Edit/Write + SKILL.md 指南 | ✅ 完成 |
| UpdateSlideStyle（批量） | 修改 theme.css（全局）或单页内联 | ✅ 完成 |
| AddNewSlide | Write 新文件 + 更新 manifest.json | ✅ 完成 |
| RemoveSlide | 删除文件 + 更新 manifest.json | ✅ 完成 |
| ReorderSlides | 更新 manifest.json（viewer 已支持拖拽） | ✅ 已有 |
| MergeSlides | SKILL.md 指南 | ✅ 完成 |
| SplitSlide | SKILL.md 指南 | ✅ 完成 |

### 5. AI 图片生成 ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| FAL API 图片生成 | `generate_image.py` (OpenRouter + fal.ai 双后端) | ✅ 完成 |
| HTML/CSS 优先，AI 图片其次 | SKILL.md 明确指南 | ✅ 完成 |
| 自动上传 + URL 替换 | 本地 assets/ + `<img>` 引用 | ✅ 简化 |
| `data-generate="true"` 标记 | 不迁移（直接由 Claude 判断何时生成） | — |

**实现**:
- `generate_image.py` 从 contextual-illustrator 迁入，支持 OpenRouter（零依赖）和 fal.ai 双后端
- 通过 init params 交互式配置 API keys（`openrouterApiKey` / `falApiKey`）
- 条件注入：有 API key 时 SKILL.md 和 CLAUDE.md 包含图片生成指南，无则隐藏
- `.env` 文件在 skill 安装时自动生成

### 6. 布局检测 (Layout Check) ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| 无头浏览器 + JS 溢出检测 | chrome-devtools MCP + evaluate_script | ✅ 完成 |
| 截图保存 | viewer 预览 + MCP 截图 | ✅ 完成 |
| 溢出检测 JS 脚本 | `skill/layout_check.js` | ✅ 完成 |

### 7. 并发生成模式

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| 前 2 页顺序 → 其余并行 | 顺序生成（单 Agent 限制） | ⚠️ 不迁移 |
| Cover 建立视觉标识 → Content 参考 Cover | SKILL.md 指导生成顺序 | ✅ 理念迁移 |

### 8. Presentation Viewer ✅

| 参考项目 | Pneuma 方案 | 状态 |
|---------|------------|------|
| `presentation_template.html` | Pneuma Viewer + export 端点 | ✅ 已有 |
| 水平/垂直切换 | viewer navigator position | ✅ 已有 |

---

## 文件变更总结

### 修改文件

| 文件 | 变更 |
|-----|------|
| `modes/slide/skill/SKILL.md` | 完整重写：YAML frontmatter, {SKILL_PATH}, 条件图片生成 |
| `modes/slide/manifest.ts` | API key params, deriveParams, envMapping, 条件 claudeMdSection |
| `modes/slide/seed/theme.css` | 升级为专业默认主题 |
| `modes/slide/seed/slides/slide-01.html` | 升级为更好的示例 |
| `modes/slide/seed/slides/slide-02.html` | 升级为 3-column card grid |
| `core/types/mode-manifest.ts` | +deriveParams (InitConfig), +envMapping (SkillConfig) |
| `server/skill-installer.ts` | 条件模板块 `{{#key}}...{{/key}}`, .env 生成 |
| `bin/pneuma.ts` | 调用 deriveParams |

### 新增文件

| 文件 | 用途 |
|-----|------|
| `modes/slide/skill/design_outline_template.md` | 设计大纲模板 |
| `modes/slide/skill/style_reference.md` | 设计系统参考 |
| `modes/slide/skill/layout_patterns.md` | 布局模式 + 高度计算 |
| `modes/slide/skill/layout_check.js` | 溢出检测 JS |
| `modes/slide/skill/scripts/generate_image.py` | AI 图片生成脚本 |
| `modes/slide/skill/.env.example` | API key 模板 |

---

## 无法迁移的能力

| 能力 | 原因 | 替代方案 |
|-----|------|---------|
| 并行 slide 生成 | 单 Agent 限制 | 顺序生成，SKILL.md 指导生成顺序 |
| LLM 调用重新生成 layout JSON | 参考项目用独立 LLM 调用 | Claude 本身就是 LLM，直接处理 |
| 虚拟文件系统 (MongoBackend) | Pneuma 用真实文件系统 | 不需要，文件系统更直接 |
| 独立图片上传 CDN | 参考项目上传到 Tanka CDN | 本地 assets/ + /content/ 路径 |

---

## 系统扩展总结

本次升级不仅完善了 slide skill，还为 Pneuma 框架添加了通用能力：

1. **条件模板块** (`{{#key}}...{{/key}}`): 任何 Mode 都可以根据 init params 条件注入 skill 内容
2. **deriveParams**: 从用户输入派生计算参数的通用机制
3. **envMapping**: 声明式 .env 文件生成，用于 skill 脚本的环境变量配置
4. **YAML frontmatter + {SKILL_PATH}**: 遵循 Claude Code skill 最佳实践
