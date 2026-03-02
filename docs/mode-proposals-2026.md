# 三个高价值 Mode 提案

> **日期**: 2026-03-02
> **目标**: 基于市场调研和技术可行性分析，提出三个最值得开发的新 Mode
> **评估维度**: 用户价值 × Agent 能力匹配度 × 技术可行性 × 实现成本

---

## 总览

| Mode | 一句话描述 | 核心库 | Agent 匹配度 | 开发周期 |
|------|-----------|--------|-------------|---------|
| **`site`** | 自然语言 → 可交互网页原型 | iframe (复用 Slide 基础设施) | ⭐⭐⭐⭐⭐ | 1~2 周 |
| **`chart`** | CSV/JSON → 交互式数据仪表盘 | Recharts + Tremor | ⭐⭐⭐⭐ | 1~2 周 |
| **`flow`** | 对话式工作流/架构图设计 | React Flow (@xyflow/react) | ⭐⭐⭐⭐ | 2~3 周 |

建议按 `site` → `chart` → `flow` 的顺序实施。

---

## 提案 1: `site` Mode — Web 原型设计

### 是什么

用户用自然语言描述想要的网页，Agent 直接生成 HTML/CSS/JS 文件，Viewer 实时渲染预览。输出就是标准的网页文件——可直接部署。

```
用户: "给我做一个 SaaS 产品的落地页，有 hero 区、功能展示卡片、价格对比表和底部 CTA"
Agent: 写入 index.html + styles.css
Viewer: 实时预览完整网页
```

### 为什么选这个

**1. Agent 能力匹配度最高**

Claude 最擅长的就是写代码。在 chart 模式下 Agent 写的是 JSON 配置，在 draw 模式下写的是 Excalidraw 的 JSON 结构——都需要学习特定格式。但在 site 模式下，Agent 写的就是它最熟悉的 HTML/CSS/JS。这意味着输出质量天然更高，且不需要复杂的 Skill 指引。

**2. 基础设施已存在**

Slide Mode 的 iframe 预览是完全相同的技术方案。SlidePreview 已经实现了：
- HTML 文件在 iframe 中渲染
- 文件变更 → iframe 刷新
- 元素选择 → CSS selector 捕获 → 上下文注入
- 资产（图片、CSS）在 workspace 目录中管理

site 模式需要做的只是去掉 slide 的"逐页"逻辑，加上响应式预览工具栏。

**3. 竞品分析留出清晰空白**

| 竞品 | 短板 |
|------|------|
| v0.dev (Vercel) | SaaS 锁定，输出 React+Tailwind 组件而非独立网页，不可本地编辑 |
| Bolt.new | 生成完整应用（过重），SaaS 锁定 |
| Framer / Webflow | 设计工具，非 AI 原生，proprietary 格式 |
| Cursor + 浏览器 | 手动切换 IDE 和浏览器，无实时预览 |

Pneuma site mode 的差异化：**本地文件、标准格式、实时预览、对话式迭代、零导出步骤。**

### 技术方案

#### Manifest 设计

```typescript
// modes/site/manifest.ts
export const manifest: ModeManifest = {
  name: "site",
  version: "1.0.0",
  displayName: "Website",
  description: "AI-assisted web page prototyping with live preview",
  skill: {
    sourceDir: "skill",
    installName: "pneuma-site",
    claudeMdSection: `Use the /site skill: Create web pages with HTML, CSS, and JS.
Write clean, semantic HTML with Tailwind CSS (CDN included automatically).
File structure: index.html (main page), styles.css (custom styles), *.js (scripts).
Assets go in assets/ directory.`
  },
  viewer: {
    watchPatterns: ["**/*.html", "**/*.css", "**/*.js", "assets/**/*"],
    ignorePatterns: [
      "node_modules/**", ".git/**", ".claude/**", ".pneuma/**"
    ],
    serveDir: "."
  },
  agent: {
    permissionMode: "bypassPermissions",
    greeting: "描述你想要的网页，我来为你创建。"
  },
  init: {
    contentCheckPattern: "**/*.html",
    seedFiles: {
      "index.html": "modes/site/seed/index.html"
    }
  }
};
```

#### Viewer 架构

```
┌─────────────────────────────────────────────────┐
│  SitePreview                                    │
│  ┌──────────────────────────────────────────┐   │
│  │  ResponsiveToolbar                       │   │
│  │  [Desktop 1280] [Tablet 768] [Mobile 375]│   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │                                          │   │
│  │  <iframe src="workspace/index.html">     │   │
│  │    (select mode: overlay + CSS selector) │   │
│  │                                          │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │  FileNav: index.html | about.html | ...  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

核心组件：

| 组件 | 职责 | 复用来源 |
|------|------|---------|
| `SitePreview.tsx` | 主预览容器 | 参考 SlidePreview，去掉分页逻辑 |
| `ResponsiveToolbar.tsx` | 视口尺寸切换 | 新增 |
| `SiteIframe.tsx` | iframe 渲染 + select mode 覆盖层 | 参考 SlideIframePool 的 iframe 管理 |
| `FileNav.tsx` | 多 HTML 文件切换 | 新增 |

#### 元素选择方案

复用 Slide Mode 已有的 iframe overlay 机制：

1. `select` mode 激活时，向 iframe 注入覆盖层脚本
2. 用户点击元素 → 计算 CSS selector path
3. 可选：元素 SVG 缩略图捕获（复用 Slide 的 `foreignObject` 方案）
4. 上下文注入: `[User is viewing: index.html]\n[User selected: section.hero > h1]`

#### Seed 文件设计

```html
<!-- modes/site/seed/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Website</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-gray-900">
  <main class="max-w-4xl mx-auto px-4 py-16">
    <h1 class="text-4xl font-bold">Welcome</h1>
    <p class="mt-4 text-lg text-gray-600">
      Describe what you want, and I'll build it for you.
    </p>
  </main>
</body>
</html>
```

#### Skill 设计要点

SKILL.md 应指导 Agent：
- 使用 Tailwind CSS CDN（已在 seed 中包含）
- 语义化 HTML（`<header>`, `<main>`, `<section>`, `<footer>`）
- 响应式设计（mobile-first）
- 图片使用 placeholder service 或 workspace `assets/` 目录
- 多页网站: 每个页面独立 HTML，共享 `styles.css`
- 不使用构建工具、不使用 npm、纯 vanilla HTML/CSS/JS

#### 估算

| 工作项 | 工作量 |
|--------|--------|
| Manifest + ModeDefinition | 0.5 天 |
| SitePreview 组件（基于 SlidePreview 改造） | 1 天 |
| ResponsiveToolbar | 0.5 天 |
| 元素选择覆盖层（复用 Slide 代码） | 0.5 天 |
| FileNav 多文件切换 | 0.5 天 |
| Skill 编写 + Seed 文件 | 1 天 |
| 测试 | 1 天 |
| **总计** | **~5 天** |

---

## 提案 2: `chart` Mode — 数据可视化仪表盘

### 是什么

用户提供 CSV/JSON 数据文件，用自然语言描述想要的可视化，Agent 生成声明式 JSON 配置文件，Viewer 实时渲染成交互式图表仪表盘。

```
用户: [拖入 sales-2025.csv] "做一个销售仪表盘，包含月度收入趋势、区域对比柱状图和产品分类饼图"
Agent: 读取 CSV 结构，写入 dashboard.chart.json
Viewer: 渲染三个交互式图表 + KPI 卡片
```

### 为什么选这个

**1. 数据可视化是最大的未被 AI 赋能的日常需求之一**

大多数人做数据可视化的路径是：打开 Excel → 选择数据 → 插入图表 → 调整格式 → 复制粘贴到 PPT。这个流程低效且结果丑陋。专业 BI 工具（Power BI, Tableau）门槛太高。AI 可视化工具（Polymer AI）都是 SaaS。

**没有任何本地工具能做到"给一个 CSV + 一句话 = 交互式仪表盘"。**

**2. JSON 配置格式完美契合 Pneuma 架构**

Agent 不需要写复杂代码，只需输出声明式 JSON。这与 Draw Mode 写 `.excalidraw` JSON 是同一种模式——已被验证可行。Viewer 负责渲染解释。

**3. Recharts 库成熟度极高**

- 26.7k GitHub stars
- 每周 1380 万次 npm 下载
- 纯 React/SVG，零原生依赖
- MIT 协议
- 与 Tailwind CSS 兼容

### 技术方案

#### 核心依赖

| 库 | 用途 | Stars | 周下载量 |
|----|------|-------|---------|
| **recharts** | 核心图表渲染 | 26.7k | 13.8M |
| **tremor** (可选) | KPI 卡片、仪表盘布局组件 | 16.5k | 1.1M |
| **papaparse** | CSV 解析 | 12k+ | 4.5M |

#### 文件格式设计

```jsonc
// dashboard.chart.json
{
  "$schema": "pneuma-chart/v1",
  "title": "2025 Sales Dashboard",
  "theme": "light",
  "dataSources": {
    "sales": {
      "file": "sales-2025.csv",
      "format": "csv"
    },
    "targets": {
      "file": "targets.json",
      "format": "json"
    }
  },
  "layout": {
    "columns": 2,
    "gap": "1rem"
  },
  "widgets": [
    {
      "id": "revenue-kpi",
      "type": "kpi",
      "title": "Total Revenue",
      "span": 1,
      "dataSource": "sales",
      "value": { "field": "revenue", "aggregate": "sum" },
      "format": "currency",
      "trend": { "field": "month", "compare": "previous_period" }
    },
    {
      "id": "revenue-trend",
      "type": "line",
      "title": "Monthly Revenue",
      "span": 2,
      "dataSource": "sales",
      "xAxis": { "field": "month", "type": "category" },
      "series": [
        { "field": "revenue", "name": "Revenue", "color": "#8884d8" },
        { "field": "profit", "name": "Profit", "color": "#82ca9d" }
      ]
    },
    {
      "id": "region-bar",
      "type": "bar",
      "title": "Sales by Region",
      "span": 1,
      "dataSource": "sales",
      "xAxis": { "field": "region" },
      "series": [{ "field": "sales", "color": "#ffc658" }]
    },
    {
      "id": "category-pie",
      "type": "pie",
      "title": "Product Categories",
      "span": 1,
      "dataSource": "sales",
      "value": { "field": "revenue" },
      "category": { "field": "product_category" }
    }
  ]
}
```

**设计决策**: 采用声明式 JSON 而非让 Agent 直接写 React/Recharts 代码。理由：
1. JSON 修改的原子性更好（改一个颜色不会引入语法错误）
2. Viewer 可以做安全边界检查（JSON 不能执行任意代码）
3. 与 Draw Mode 的 `.excalidraw` JSON 方案一致

#### Manifest 设计

```typescript
export const manifest: ModeManifest = {
  name: "chart",
  version: "1.0.0",
  displayName: "Dashboard",
  description: "AI-assisted data visualization and dashboards",
  skill: {
    sourceDir: "skill",
    installName: "pneuma-chart",
    claudeMdSection: `Use the /chart skill: Create interactive data dashboards.
Data files: CSV or JSON in workspace root.
Dashboard config: .chart.json files (declarative widget definitions).
Supported chart types: line, bar, area, pie, scatter, kpi.
Always read the data file first to understand column names and types.`
  },
  viewer: {
    watchPatterns: ["**/*.chart.json", "**/*.csv", "**/*.json"],
    ignorePatterns: [
      "node_modules/**", ".git/**", ".claude/**", ".pneuma/**",
      "package.json", "tsconfig.json"
    ]
  },
  agent: {
    permissionMode: "bypassPermissions",
    greeting: "上传一个数据文件（CSV 或 JSON），告诉我你想看到什么样的可视化。"
  },
  init: {
    contentCheckPattern: "**/*.chart.json",
    seedFiles: {
      "sample-data.csv": "modes/chart/seed/sample-data.csv",
      "dashboard.chart.json": "modes/chart/seed/dashboard.chart.json"
    }
  }
};
```

#### Viewer 架构

```
┌──────────────────────────────────────────────────┐
│  ChartPreview                                    │
│  ┌──────────────────────────────────────────┐    │
│  │  DashboardHeader: "2025 Sales Dashboard" │    │
│  ├──────────────────────────────────────────┤    │
│  │  ┌──────────┐  ┌──────────┐             │    │
│  │  │  KPI     │  │  KPI     │             │    │
│  │  │  $1.2M   │  │  +15.3%  │             │    │
│  │  └──────────┘  └──────────┘             │    │
│  │  ┌───────────────────────────────────┐  │    │
│  │  │  LineChart: Monthly Revenue       │  │    │
│  │  │  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~     │  │    │
│  │  └───────────────────────────────────┘  │    │
│  │  ┌────────────────┐ ┌────────────────┐ │    │
│  │  │  BarChart       │ │  PieChart      │ │    │
│  │  │  ████ ██ █████  │ │  🟣🔵🟡       │ │    │
│  │  └────────────────┘ └────────────────┘ │    │
│  └──────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────┐    │
│  │  FileNav: dashboard.chart.json | ...     │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

核心组件：

| 组件 | 职责 |
|------|------|
| `ChartPreview.tsx` | 解析 `.chart.json` + 加载数据 + 渲染仪表盘 |
| `WidgetRenderer.tsx` | 根据 widget type 分发到具体图表组件 |
| `LineWidget.tsx` | Recharts `<LineChart>` 封装 |
| `BarWidget.tsx` | Recharts `<BarChart>` 封装 |
| `PieWidget.tsx` | Recharts `<PieChart>` 封装 |
| `AreaWidget.tsx` | Recharts `<AreaChart>` 封装 |
| `ScatterWidget.tsx` | Recharts `<ScatterChart>` 封装 |
| `KpiWidget.tsx` | 数值卡片 (Tremor 或自定义) |
| `DashboardGrid.tsx` | CSS Grid 布局容器 |

#### 元素选择方案

chart 模式的选择粒度是 **widget 级别**：

1. `select` mode 下，每个 widget 容器变为可点击
2. 点击 widget → 捕获 `widget.id` + `widget.type`
3. 上下文注入: `[User is viewing: dashboard.chart.json]\n[User selected: widget "revenue-trend" (line chart)]`
4. Agent 可以精确修改被选中的 widget 配置

#### 数据加载管道

```
.csv file → PapaParse → { columns: string[], rows: object[] }
.json file → JSON.parse → object[]
                ↓
        DashboardConfig.dataSources → { [name]: DataTable }
                ↓
        WidgetRenderer → 根据 widget 配置选择列 → Recharts 数据
```

#### 估算

| 工作项 | 工作量 |
|--------|--------|
| Manifest + ModeDefinition | 0.5 天 |
| ChartPreview + DashboardGrid | 1 天 |
| Widget 组件 (6 种图表类型) | 2 天 |
| 数据加载 (CSV + JSON) | 0.5 天 |
| 元素选择 (widget 级别) | 0.5 天 |
| Skill 编写 + JSON Schema + Seed 文件 | 1 天 |
| 测试 | 1 天 |
| **总计** | **~6~7 天** |

---

## 提案 3: `flow` Mode — 工作流/架构图设计

### 是什么

用户用自然语言描述流程或系统架构，Agent 生成结构化的节点图 JSON，Viewer 渲染为可交互的节点-边图。

```
用户: "画一个用户注册流程：输入表单 → 验证邮箱 → 发送确认邮件 → 创建账户 → 跳转首页。验证失败时显示错误"
Agent: 写入 registration.flow.json
Viewer: 渲染流程图，节点可拖拽，边可编辑
```

### 为什么选这个

**1. 结构化图 vs 自由画布 — 填补 Draw Mode 的空白**

Draw Mode (Excalidraw) 是自由画布——适合草图和头脑风暴。但对于有明确结构的图（流程图、架构图、数据管道、状态机），结构化节点图更合适：
- 节点有类型和属性（不只是图形）
- 边有方向和语义（不只是箭头）
- 自动布局——Agent 不需要计算像素坐标
- 导出为结构化数据（可用于代码生成或配置导出）

**2. React Flow 是该领域的统治性库**

- 35.2k GitHub stars
- 每周 294 万次 npm 下载
- 原生 JSON 序列化（`toObject()` → `{ nodes, edges, viewport }`）
- 自定义节点类型是 React 组件
- 自动布局集成（dagre/elkjs）
- MIT 协议

**3. 市场需求强劲**

工作流自动化市场 2025 年 $23.77B → 2031 年 $40.77B。AI Agent 市场 44.6% CAGR。n8n (176.7k stars) 证明了可视化工作流设计的需求。但所有方案都是重型平台——没有轻量的、对话式的、文件输出的工作流设计工具。

### 技术方案

#### 核心依赖

| 库 | 用途 | Stars | 周下载量 |
|----|------|-------|---------|
| **@xyflow/react** | 节点图渲染与交互 | 35.2k | 2.94M |
| **dagre** (或 **elkjs**) | 自动布局算法 | 3k+ | 1.2M |

#### 文件格式设计

```jsonc
// registration.flow.json
{
  "$schema": "pneuma-flow/v1",
  "title": "User Registration Flow",
  "description": "New user registration with email verification",
  "layoutDirection": "TB",
  "nodes": [
    {
      "id": "1",
      "type": "input",
      "data": {
        "label": "Registration Form",
        "description": "User fills name, email, password",
        "icon": "form"
      }
    },
    {
      "id": "2",
      "type": "process",
      "data": {
        "label": "Validate Email",
        "description": "Check format + uniqueness"
      }
    },
    {
      "id": "3",
      "type": "decision",
      "data": {
        "label": "Valid?",
        "description": "Email format and uniqueness check"
      }
    },
    {
      "id": "4",
      "type": "process",
      "data": {
        "label": "Send Confirmation",
        "description": "Send verification email via SendGrid"
      }
    },
    {
      "id": "5",
      "type": "process",
      "data": {
        "label": "Create Account",
        "description": "Insert into users table"
      }
    },
    {
      "id": "6",
      "type": "output",
      "data": {
        "label": "Dashboard",
        "description": "Redirect to user dashboard"
      }
    },
    {
      "id": "7",
      "type": "error",
      "data": {
        "label": "Show Error",
        "description": "Display validation error message"
      }
    }
  ],
  "edges": [
    { "id": "e1-2", "source": "1", "target": "2", "label": "" },
    { "id": "e2-3", "source": "2", "target": "3", "label": "" },
    { "id": "e3-4", "source": "3", "target": "4", "label": "Yes", "sourceHandle": "yes" },
    { "id": "e3-7", "source": "3", "target": "7", "label": "No", "sourceHandle": "no" },
    { "id": "e4-5", "source": "4", "target": "5", "label": "" },
    { "id": "e5-6", "source": "5", "target": "6", "label": "" },
    { "id": "e7-1", "source": "7", "target": "1", "label": "Retry", "animated": true }
  ]
}
```

**关键设计**: 文件格式与 React Flow 的 `ReactFlowJsonObject` 结构高度一致，但省略了 `position` 字段（由自动布局计算）。Agent 只需声明节点和连接关系，不需要计算坐标。

#### Manifest 设计

```typescript
export const manifest: ModeManifest = {
  name: "flow",
  version: "1.0.0",
  displayName: "Flowchart",
  description: "AI-assisted workflow and architecture diagram design",
  skill: {
    sourceDir: "skill",
    installName: "pneuma-flow",
    claudeMdSection: `Use the /flow skill: Design flowcharts and architecture diagrams.
Output: .flow.json files with nodes and edges.
Node types: input, output, process, decision, error, note.
Edges connect source to target with optional labels.
Do NOT specify position — auto-layout handles placement.
Use layoutDirection "TB" (top-bottom) or "LR" (left-right).`
  },
  viewer: {
    watchPatterns: ["**/*.flow.json"],
    ignorePatterns: [
      "node_modules/**", ".git/**", ".claude/**", ".pneuma/**"
    ]
  },
  agent: {
    permissionMode: "bypassPermissions",
    greeting: "描述你想要设计的流程或架构，我来为你生成可视化图表。"
  },
  init: {
    contentCheckPattern: "**/*.flow.json",
    seedFiles: {
      "example.flow.json": "modes/flow/seed/example.flow.json"
    }
  }
};
```

#### Viewer 架构

```
┌────────────────────────────────────────────────┐
│  FlowPreview                                   │
│  ┌────────────────────────────────────────┐    │
│  │  FlowToolbar                           │    │
│  │  [Auto Layout] [Direction: TB/LR]      │    │
│  │  [Zoom In] [Zoom Out] [Fit View]       │    │
│  └────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────┐    │
│  │                                        │    │
│  │   ┌──────┐      ┌──────┐              │    │
│  │   │ Form │ ───► │Valid?│ ──Yes──►...   │    │
│  │   └──────┘      └──┬───┘              │    │
│  │                    No                   │    │
│  │                  ┌──▼───┐              │    │
│  │                  │Error │              │    │
│  │                  └──────┘              │    │
│  │                                        │    │
│  │  <ReactFlow>                           │    │
│  └────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────┐    │
│  │  FileNav: registration.flow.json | ... │    │
│  └────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

核心组件：

| 组件 | 职责 |
|------|------|
| `FlowPreview.tsx` | 解析 `.flow.json` + 自动布局 + ReactFlow 渲染 |
| `FlowToolbar.tsx` | 布局控制 + 缩放 + 导出 |
| `InputNode.tsx` | 自定义节点：输入（绿色圆角矩形） |
| `ProcessNode.tsx` | 自定义节点：处理步骤（蓝色矩形） |
| `DecisionNode.tsx` | 自定义节点：判断（橙色菱形） |
| `OutputNode.tsx` | 自定义节点：输出（紫色圆角矩形） |
| `ErrorNode.tsx` | 自定义节点：错误（红色矩形） |
| `NoteNode.tsx` | 自定义节点：注释（黄色便签） |
| `AutoLayout.ts` | dagre 布局算法封装 |

#### 元素选择方案

flow 模式的选择粒度是 **节点级别**：

1. `select` mode 下，点击节点 → 捕获 `node.id` + `node.type` + `node.data`
2. 上下文注入: `[User is viewing: registration.flow.json]\n[User selected: node "3" (decision) "Valid?"]`
3. Agent 可以精确修改选中节点的属性或添加从该节点出发的新分支

#### 自动布局管道

```
.flow.json (无 position)
        ↓
  dagre.graphlib.Graph
    + setNode(id, { width, height })
    + setEdge(source, target)
    + dagre.layout(graph)
        ↓
  { nodes: [{ ...node, position: { x, y } }], edges }
        ↓
  <ReactFlow nodes={nodes} edges={edges} />
```

Agent 写文件时不需要指定位置——dagre 自动计算。用户拖拽节点后，位置保存在内存中（不回写文件，避免 Agent 和用户的位置冲突）。

#### 高级特性（v2 考虑）

1. **节点组/子流程**: `type: "group"` 包含子节点集合，可折叠
2. **流程模拟**: 高亮执行路径动画（从入口到出口的步进）
3. **代码生成**: 从 flow.json 生成伪代码或状态机代码
4. **Mermaid 导入**: 解析 Mermaid flowchart 语法 → flow.json
5. **PNG/SVG 导出**: React Flow 支持 `toImage()`

#### 估算

| 工作项 | 工作量 |
|--------|--------|
| Manifest + ModeDefinition | 0.5 天 |
| FlowPreview + ReactFlow 集成 | 1.5 天 |
| 自定义节点组件 (6 种类型) | 2 天 |
| 自动布局 (dagre 集成) | 1 天 |
| 元素选择 (节点级别) | 0.5 天 |
| FlowToolbar (缩放、布局控制) | 0.5 天 |
| Skill 编写 + Seed 文件 | 1 天 |
| 测试 | 1 天 |
| **总计** | **~8~9 天** |

---

## 实施路线图

```
Week 1-2: site mode
  ├── Day 1-2: Manifest + SitePreview (iframe 复用)
  ├── Day 3: ResponsiveToolbar + FileNav
  ├── Day 4: Skill + Seed + 元素选择
  └── Day 5: 测试 + 打磨

Week 3-4: chart mode
  ├── Day 1: Manifest + ChartPreview + DashboardGrid
  ├── Day 2-3: Widget 组件 (6 种图表)
  ├── Day 4: 数据加载 + 元素选择
  └── Day 5-6: Skill + Seed + 测试

Week 5-6: flow mode
  ├── Day 1-2: Manifest + FlowPreview + ReactFlow 集成
  ├── Day 3-4: 自定义节点 (6 种) + dagre 布局
  ├── Day 5: 元素选择 + Toolbar
  └── Day 6-7: Skill + Seed + 测试
```

每个 Mode 完成后应：
1. 验证与外部 Mode 加载机制的兼容性
2. 验证元素选择 → 上下文注入 → Agent 理解的完整链路
3. 用至少 3 个不同的用户场景进行端到端测试

---

## 附录：被排除的候选方案

| 候选 | 排除理由 |
|------|---------|
| **3D 场景 (React Three Fiber)** | Agent 写 3D 代码的质量不稳定；React Three Fiber 学习曲线陡；用户群窄 |
| **音乐/音频 (Reactronica)** | 库不成熟 (300 stars)；文件格式碎片化；实时音频预览复杂 |
| **表格/电子表格 (FortuneSheet)** | Excel 替代品市场已饱和；Agent 不擅长精确的单元格操作 |
| **表单构建 (SurveyJS)** | 需要后端才能发挥价值（收集数据）；Pneuma 是文件系统方案 |
| **API 设计 (Scalar)** | Scalar 自身已经很好；差异化不足 |
| **知识图谱/思维导图** | 与 flow mode 重叠；独立价值不够突出 |
| **视频/故事板** | 技术复杂度极高；浏览器端视频处理受限 |
| **游戏/交互内容** | 太泛，缺乏明确的文件格式和预览模式 |

---

## 参考资源

### 库文档
- [Recharts](https://recharts.org/) — React 图表库
- [Tremor](https://tremor.so/) — React 仪表盘组件
- [React Flow (@xyflow/react)](https://reactflow.dev/) — 节点图编辑器
- [dagre](https://github.com/dagrejs/dagre) — 有向图自动布局
- [PapaParse](https://www.papaparse.com/) — CSV 解析器

### 市场数据
- AI 数据可视化市场: 27.67% CAGR, 2030 年 $826.7B ([ThoughtSpot](https://www.thoughtspot.com/data-trends/ai/ai-tools-for-data-visualization))
- 工作流自动化市场: 2025 年 $23.77B → 2031 年 $40.77B ([Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/workflow-automation-market))
- AI Agent 市场: 44.6% CAGR, 2032 年 $93.2B ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/agentic-ai-market-208190735.html))

### 竞品
- [v0.dev](https://v0.dev) — Vercel AI UI 生成
- [Bolt.new](https://bolt.new) — AI 全栈应用生成
- [n8n](https://n8n.io) — 开源工作流自动化
- [Polymer AI](https://www.polymersearch.com/) — AI 数据可视化
