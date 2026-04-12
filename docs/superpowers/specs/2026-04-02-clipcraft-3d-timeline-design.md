# ClipCraft 3D Timeline — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Branch:** `feat/clipcraft-3d-timeline`
**Depends on:** ClipCraft timeline (multi-track), store + hooks pattern

## Problem

当前 timeline 是一个扁平的多轨底栏。所有信息压缩在 200px 高的条带里——在内容层级多、时间长的情况下，用户无法直观感知视频结构。更关键的是，AI 辅助创作中产生的中间产物（对话、变体、被放弃的版本）没有地方展示。

## 目标

将 timeline 底栏升级为可展开的 3D 空间化创作环境。

**Phase 1（本 spec 范围）：** 展开按钮 + 3D Overview + 收回动画
**Phase 2（后续）：** Layer Dive — xyflow 画布 + clip nodes + 帧操作
**Phase 3（后续）：** 外挂内容 — AI 对话历史、变体、参考资料节点

## 非目标

- Phase 2/3 的实现细节（另开 spec）
- 替换现有 collapsed timeline（它作为收起态保留）
- Three.js / WebGL（CSS 3D 够用）
- 移动端适配

## 用户流程

```
[底栏 Timeline] --点击炫光按钮--> [3D Overview 全屏]
     ^                                    |
     |                              shift+滚轮横移
     |                              alt+滚轮缩放
     |                              点击切换3D视角
     |                                    |
     +----按 Esc / 点击收回按钮-----------+
                                          |
                              --点击某层--> [Layer Dive] (Phase 2)
```

## 架构

### 三种模式

| 模式 | 触发 | 视觉 | 高度 |
|------|------|------|------|
| `collapsed` | 默认 / Esc / 收回按钮 | 当前 200px 多轨时间轴 | 200px |
| `overview` | 炫光展开按钮 | 3D 多层景深全屏 | 100vh |
| `dive` | 在 overview 中点击某层 | 2D xyflow 画布全屏（Phase 2） | 100vh |

### 文件结构

```
viewer/timeline/
├── Timeline.tsx              # 现有多轨时间轴（collapsed 态内容）
├── TimelineShell.tsx         # 新：模式管理 + 展开/收回动画容器
├── ExpandButton.tsx          # 新：炫光展开按钮
├── overview/
│   ├── TimelineOverview3D.tsx  # 新：3D 容器 + 相机状态
│   ├── Layer3D.tsx             # 新：单层的 3D 平面（CSS transform）
│   ├── OverviewControls.tsx    # 新：视角切换按钮组
│   └── useOverviewCamera.ts   # 新：相机（perspective-origin）+ 键盘/滚轮操控
├── hooks/
│   ├── useTimelineZoom.ts     # 现有
│   ├── useFrameExtractor.ts   # 现有
│   └── useWaveform.ts         # 现有
└── ... (现有 track 组件)
```

### Store 扩展

```typescript
// 新增到 ClipCraftState
timelineMode: "collapsed" | "overview" | "dive";
diveLayer: "caption" | "video" | "audio" | "bgm" | null;

// 新增 Actions
| { type: "SET_TIMELINE_MODE"; mode: "collapsed" | "overview" | "dive" }
| { type: "SET_DIVE_LAYER"; layer: "caption" | "video" | "audio" | "bgm" | null }
```

### 组件层级

```
ClipCraftLayout
├── TopSection (AssetPanel + VideoPreview)
│   └── framer-motion: overview 时 opacity→0, height→0
└── TimelineShell  ← 新组件
    ├── ExpandButton (collapsed 态显示，overview 态变为收回按钮)
    ├── motion.div (animate height: 200px ↔ 100vh)
    │   ├── collapsed → <Timeline />
    │   ├── overview → <TimelineOverview3D />
    │   └── dive → <LayerDive /> (Phase 2, 占位)
    └── AnimatePresence 管理模式切换的 enter/exit 动画
```

## 详细设计

### TimelineShell

容器组件。职责：
1. 从 store 读取 `timelineMode`
2. 用 `framer-motion` 的 `motion.div` 做高度动画（200px ↔ 100vh）
3. 通知 Layout 上半区隐藏/显示（overview 时上半区压缩到 0）
4. 渲染 ExpandButton
5. 根据模式渲染对应子组件

动画配置：
```typescript
const heightVariants = {
  collapsed: { height: 200 },
  overview: { height: "100vh" },
  dive: { height: "100vh" },
};
// spring 动画，柔和过渡
const transition = { type: "spring", stiffness: 200, damping: 30 };
```

### ExpandButton

位于 timeline 左上角。两种状态：
- `collapsed` 态：显示展开图标 + 炫光特效（参考 reactbits.dev 选一种 glow/shimmer 效果）
- `overview/dive` 态：变为收回图标（箭头朝下），点击回到 collapsed

炫光效果用 CSS animation：一个 conic-gradient 旋转边框 + box-shadow pulse。

### TimelineOverview3D

3D 容器。核心 CSS：

```css
.overview-3d {
  perspective: 1200px;
  perspective-origin: 50% 40%;
  transform-style: preserve-3d;
}
```

四个层从前到后排列：

| 层 | Z 偏移 | 内容 | 颜色主题 |
|----|--------|------|----------|
| Caption | translateZ(120px) | 字幕文本块 | 橙色系 |
| Video | translateZ(40px) | 帧缩略图 filmstrip | 暖色调 |
| Audio | translateZ(-40px) | 配音波形 | 蓝色系 |
| BGM | translateZ(-120px) | BGM 波形 | 紫色系 |

每层是一个 `Layer3D` 组件，接收 `z` 偏移和 `rotateX` 角度。
层与层之间有半透明连接线（可选，增强空间感）。

每层可点击 → 高亮 + 显示层名标签。
双击层 → dispatch `SET_TIMELINE_MODE: "dive"` + `SET_DIVE_LAYER`（Phase 2）。

### Layer3D

单层渲染。Props：

```typescript
interface Layer3DProps {
  layerType: "caption" | "video" | "audio" | "bgm";
  zOffset: number;        // translateZ 值
  rotateX: number;        // 倾斜角度（如 -15deg）
  scenes: Scene[];
  totalDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selected: boolean;      // 是否被选中高亮
  onSelect: () => void;
  onDive: () => void;     // 双击进入 dive
}
```

每层内部复用现有 Track 组件的渲染逻辑（帧缩略图、波形等），只是外层加了 3D transform。

选中层时，该层 `opacity: 1`、`scale: 1.02`，其他层 `opacity: 0.5`。用 `framer-motion` `animate` 做柔和过渡。

### useOverviewCamera

管理 3D 视角状态：

```typescript
interface CameraState {
  perspectiveOrigin: { x: number; y: number };  // 视角焦点 (%)
  rotateX: number;      // 整体俯仰角 (deg)
  rotateY: number;      // 整体偏航角 (deg)
  zoom: number;         // perspective 值 (px，越小越"近")
}
```

**预设视角（离散切换）：**

| 视角 | rotateX | rotateY | 用途 |
|------|---------|---------|------|
| 鸟瞰 | -25° | 0° | 默认，俯视所有层 |
| 正面 | 0° | 0° | 平视，层叠效果最强 |
| 侧面 | -15° | 30° | 斜视，看层间关系 |

视角切换按钮组（`OverviewControls`）放在右上角，3 个图标按钮循环切换。
切换动画用 `framer-motion` 的 `animate`，spring 过渡。

**滚轮操控：**
- `Shift + 滚轮`：横移时间轴（复用 useTimelineZoom 的 scrollLeft）
- `Alt + 滚轮`：缩放时间轴（复用 useTimelineZoom 的 pixelsPerSecond）
- 普通滚轮：在 3D overview 中无操作（避免误触页面滚动）

### OverviewControls

右上角的视角切换按钮组 + 收回按钮：

```
[鸟瞰] [正面] [侧面]  ·····  [收回 ↓]
```

按钮样式与 timeline 的 zoom +/- 按钮一致（透明背景 + 边框）。
当前激活的视角按钮高亮。

### ClipCraftLayout 改造

```typescript
// 当前
<div style={{ flex: "1 1 60%" }}>  // TopSection
<div style={{ flex: "0 0 200px" }}> // Timeline

// 改造后
<motion.div animate={{ flex: mode === "collapsed" ? "1 1 60%" : "0 0 0px", opacity: mode === "collapsed" ? 1 : 0 }}>
  // TopSection — overview 时压缩消失
</motion.div>
<TimelineShell />  // 管理自身高度动画
```

### 展开/收回动画序列

**展开（collapsed → overview）：**
1. 上半区 opacity 0 + height 压缩（300ms, ease-out）
2. Timeline 区域 height 从 200px → 100vh（400ms, spring）
3. 内部 tracks 从 flat 排列过渡到 3D 排列（translateZ 展开，rotateX 倾斜）（300ms, spring, 延迟 200ms）
4. 炫光按钮变为收回按钮（fade 切换）

**收回（overview → collapsed）：**
1. 3D 层收回 flat（translateZ → 0, rotateX → 0）（300ms）
2. Timeline 高度收回 200px（400ms, spring）
3. 上半区淡入（300ms）

### Playhead

3D overview 中 playhead 是一条贯穿所有层的垂直线。
在 3D 空间中，它是一个薄的平面（rotateY: 90deg）或者简单地在每层上各画一条对齐的线。

简单方案：每个 Layer3D 内部各自渲染 playhead 线段，位置相同，视觉上形成一条贯穿线。不需要真正的 3D 几何体。

## 性能考虑

1. **CSS 3D 合成层** — 每个 Layer3D 设置 `will-change: transform` 触发 GPU 合成
2. **内容复用** — 3D 层内部复用 collapsed 态的帧缩略图和波形数据（不重新提取）
3. **动画帧率** — framer-motion spring 动画自动使用 rAF，不阻塞主线程
4. **层渲染** — overview 中不需要的层（如被遮挡的后方层）不做帧提取优化（Phase 1 层少，不需要虚拟化）

## Phase 2 预留接口

`TimelineShell` 的 `dive` 模式渲染 `<LayerDive />`，Phase 1 中为占位组件（显示"Layer Dive — coming soon"）。

`LayerDive` 的接口预留：
```typescript
interface LayerDiveProps {
  layerType: "caption" | "video" | "audio" | "bgm";
  scenes: Scene[];
  totalDuration: number;
  onExit: () => void;  // 返回 overview
}
```

Phase 2 将使用 `@xyflow/react` 实现，每个 clip 是自定义 node，三段式布局（上部外挂折叠区、中部正式内容、下部迷你时间轴）。

## 迁移路径

1. Store 加 `timelineMode` + `diveLayer` + 对应 actions
2. 创建 `TimelineShell` + `ExpandButton`（先不做 3D，只做展开/收回动画）
3. 创建 `TimelineOverview3D` + `Layer3D`（3D 布局 + 层渲染）
4. 创建 `useOverviewCamera` + `OverviewControls`（视角切换 + 滚轮操控）
5. Playhead 贯穿所有 3D 层
6. 改造 `ClipCraftLayout`（上半区动画压缩）
7. 炫光按钮特效（从 reactbits.dev 选取）
8. LayerDive 占位组件

每步可独立测试和提交。
