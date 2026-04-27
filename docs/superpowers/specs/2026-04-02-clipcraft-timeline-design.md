# ClipCraft Timeline — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Depends on:** ClipCraft viewer architecture (store + hooks pattern)

## Problem

当前 TrackOverview 是一个"假"时间轴 — 用 CSS 彩色条表示场景状态。它不能：
- 显示视频的实际帧（胶片条）
- 拖拽 playhead 进行 seek
- 显示真实音频波形
- 缩放/滚动长时间轴
- 让用户调整场景时长或位置

Medeo 的 timeline 是产品的核心交互之一 — 它把脚本、视频帧、配音、BGM 四个维度同步展示在时间轴上，用户一眼就能看到整个视频的结构。

## 目标

把 TrackOverview 升级为一个真正的多轨时间轴编辑器，支持：

1. **视频帧胶片条** — 从视频文件提取帧，按时间位置显示缩略图
2. **可拖拽 Playhead** — 拖拽定位到任意时间点，同步更新 VideoPreview
3. **真实音频波形** — 从音频文件解码并渲染波形
4. **字幕文本块** — 按时间段显示字幕文字
5. **BGM 波形** — 贯穿全时长的背景音乐波形
6. **缩放/滚动** — 长时间轴支持水平缩放和滚动

## 非目标（V1 不做）

- 拖拽调整场景顺序 — 通过 agent 命令完成
- 拖拽调整场景时长 — 通过 agent 命令完成
- 多层叠加（画中画）
- 关键帧动画曲线
- 音频混音器

## 架构

### 文件结构

```
viewer/timeline/
├── Timeline.tsx              # 容器：缩放/滚动状态，组合所有 track
├── TimeRuler.tsx             # 时间刻度尺
├── Playhead.tsx              # 可拖拽播放头（垂直线）
├── CaptionTrack.tsx          # 字幕轨：文本块
├── VideoTrack.tsx            # 视频轨：帧缩略图胶片条
├── AudioTrack.tsx            # 配音轨：波形
├── BgmTrack.tsx              # BGM 轨：波形 + 标题
├── TrackLabel.tsx            # 轨道标签（Tt, 🎬, 🔊, ♪）
└── hooks/
    ├── useFrameExtractor.ts  # 从视频提取帧缩略图
    ├── useWaveform.ts        # 从音频文件生成波形数据
    └── useTimelineZoom.ts    # 缩放/滚动/像素↔时间映射
```

### 数据流

```
storyboard.json (scenes with assets)
    ↓
Timeline reads from store (scenes, bgm, playback state)
    ↓
useFrameExtractor: video URL → Canvas → frame thumbnails (cached)
useWaveform: audio URL → AudioContext → waveform peaks (cached)
    ↓
Tracks render with real content
    ↓
Playhead drag → dispatch SEEK → VideoPreview syncs
```

### 核心 Hooks

#### useFrameExtractor

从视频文件提取指定时间点的帧作为缩略图。

```typescript
interface FrameExtractorOptions {
  videoUrl: string;          // /content/assets/clips/scene-001.mp4
  duration: number;          // 视频时长（秒）
  frameInterval: number;     // 每隔多少秒取一帧（如 0.5s）
  frameHeight: number;       // 缩略图高度（如 24px）
}

interface FrameData {
  time: number;              // 帧对应的时间点
  dataUrl: string;           // base64 图片
  width: number;
  height: number;
}

function useFrameExtractor(options: FrameExtractorOptions): {
  frames: FrameData[];
  loading: boolean;
  error: string | null;
}
```

**实现方案：**
1. 创建一个隐藏的 `<video>` 元素，设置 `src` 和 `preload="auto"`
2. 监听 `loadedmetadata` 获取实际时长
3. 设置 `video.currentTime = targetTime`，等待 `seeked` 事件
4. 用 `<canvas>` 的 `drawImage(video)` 截取帧
5. `canvas.toDataURL("image/jpeg", 0.6)` 导出为 base64
6. 循环直到所有帧提取完毕
7. 缓存结果，视频 URL 不变不重新提取

**注意事项：**
- 视频必须同源或有 CORS 头（pneuma 的 `/content/` 是同源的，OK）
- 提取是异步的（每帧需要 seek + render），用 requestAnimationFrame 避免阻塞 UI
- 帧缩略图保持视频宽高比，高度固定（如 24px）

#### useWaveform

从音频文件生成波形峰值数据。

```typescript
interface WaveformOptions {
  audioUrl: string;          // /content/assets/audio/scene-001.mp3
  bars: number;              // 波形柱数量（如 100）
}

interface WaveformData {
  peaks: number[];           // 0-1 范围的峰值数组
  duration: number;          // 音频时长（秒）
}

function useWaveform(options: WaveformOptions): {
  waveform: WaveformData | null;
  loading: boolean;
}
```

**实现方案：**
1. `fetch(audioUrl)` 获取音频数据
2. `audioContext.decodeAudioData(arrayBuffer)` 解码
3. 从 `AudioBuffer.getChannelData(0)` 获取 PCM 数据
4. 将 PCM 采样分成 N 个 bucket，取每个 bucket 的最大绝对值
5. 归一化到 0-1 范围
6. 缓存结果

#### useTimelineZoom

管理时间轴的缩放和滚动。

```typescript
interface TimelineZoom {
  pixelsPerSecond: number;    // 当前缩放级别
  scrollLeft: number;         // 水平滚动偏移（像素）
  totalWidth: number;         // 时间轴总宽度（像素）
  viewportWidth: number;      // 可见区域宽度（像素）
  
  // 坐标转换
  timeToX: (time: number) => number;
  xToTime: (x: number) => number;
  
  // 操作
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (pps: number) => void;
  scrollTo: (x: number) => void;
}

function useTimelineZoom(
  duration: number,
  containerRef: RefObject<HTMLDivElement>,
): TimelineZoom;
```

**默认缩放：** 让整个时间轴刚好填满容器宽度。
**缩放范围：** 10px/s（缩到最小）到 200px/s（放到最大）。
**滚动：** 鼠标滚轮水平滚动，Ctrl+滚轮缩放。

### Playhead 交互

```
Mouse down on playhead → start drag
Mouse move → update playhead position → dispatch SEEK
Mouse up → end drag

Click on timeline (not playhead) → jump to clicked time → dispatch SEEK
```

Playhead 是一条垂直线 + 顶部三角形手柄，贯穿所有 track。
拖拽时显示当前时间的 tooltip。

### Track 渲染

每个 Track 是一个水平条，高度固定：

| Track | 高度 | 内容 |
|-------|------|------|
| TimeRuler | 24px | 刻度线 + 时间标签 |
| CaptionTrack | 32px | 按场景分段的文本块 |
| VideoTrack | 48px | 帧缩略图胶片条（最重要的升级） |
| AudioTrack | 32px | 配音波形 |
| BgmTrack | 32px | BGM 波形 + 标题 |
| **Total** | **~170px** | |

VideoTrack 高度增加到 48px 以容纳有意义的帧缩略图。

#### VideoTrack 帧布局

```
Scene 1 (5s)                    Scene 2 (4s)
┌─────────────────────────────┬─────────────────────────┐
│ [f0][f1][f2][f3][f4][f5]... │ [f0][f1][f2][f3][f4]... │
└─────────────────────────────┴─────────────────────────┘
```

每个场景区域内，帧缩略图紧密排列，保持视频原始宽高比。
帧之间无间距，超出场景宽度的帧被裁剪。
"generating" 状态的场景显示条纹动画占位符。

### 与 Store 的集成

新增 store actions：

```typescript
| { type: "SEEK"; globalTime: number }         // 已有
| { type: "SET_ZOOM"; pixelsPerSecond: number } // 新增
| { type: "SET_SCROLL"; scrollLeft: number }    // 新增
```

Playhead 拖拽和 timeline 点击都 dispatch `SEEK`。
VideoPreview 监听 `playback.globalTime` 变化，同步显示对应场景。

### 性能考虑

1. **帧提取** — 异步后台执行，渐进式显示（先显示占位符，提取完一帧显示一帧）
2. **波形解码** — 一次性解码，结果缓存在 hook 内部
3. **缩放时重渲染** — 只重新计算位置，不重新提取帧/波形
4. **长视频** — 超过 60s 的视频自动降低帧密度（如 1 帧/秒而非 2 帧/秒）
5. **Canvas 复用** — 帧提取共用一个 offscreen canvas

## 迁移路径

1. 创建 `timeline/` 目录和 hooks
2. 实现 `useFrameExtractor` + `useWaveform`（核心技术难点）
3. 实现 `Timeline` 容器 + `TimeRuler` + `Playhead`（基础框架）
4. 实现 `VideoTrack`（最重要的视觉升级）
5. 实现 `CaptionTrack` + `AudioTrack` + `BgmTrack`
6. 接入 store（SEEK、zoom/scroll）
7. 删除旧 `TrackOverview.tsx`
8. 在 `ClipCraftLayout` 中替换

每步可独立测试和提交。
