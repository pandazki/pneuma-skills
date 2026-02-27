# Slide Viewer Enhancements

> Scope: SlidePreview.tsx 组件增强，不含演讲/演示相关功能。

## 功能列表

### A. Navigator / Outline

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| A1 | 缩略图预览 | Navigator 中每个 slide 显示实际渲染的缩略图（缩小版 iframe），替代纯文字列表 | DONE |
| A2 | 收起/展开 | Navigator 可折叠隐藏，最大化 viewer 区域。三态循环：left → bottom → hidden | DONE |
| A3 | 底部横向模式 | Navigator 可切换到底部横向滚动展示缩略图（类 Keynote/PowerPoint） | DONE |
| A4 | 拖拽排序 | 在 Navigator 中拖拽缩略图调整 slide 顺序，同步更新 manifest.json | DONE |
| A5 | 右键菜单 | 缩略图上右键：复制、删除、在前/后插入新 slide | TODO |

### B. Viewer 主区域

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| B1 | 缩放控制 | Zoom in/out (−/+按钮) + 点击百分比重置 + 30%-200% 范围 | DONE |
| B2 | 全屏演示 | 浏览器全屏 (F键或按钮)，隐藏所有 UI，Esc 退出，箭头键导航 | DONE |
| B3 | Slide 跳转 | 点击计数器弹出输入框，直接跳转到指定 slide | DONE |
| B4 | 网格总览 | Slide Sorter 视图，所有 slide 以网格排列，快速定位 | DONE |

### C. 工具栏

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| C1 | 主题切换 | toolbar 提供 light/dark 主题切换（修改注入的 theme.css 变量） | TODO |
| C2 | 宽高比切换 | 16:9 / 4:3 / 16:10 切换 | TODO |
| C3 | Speaker Notes | 显示/隐藏演讲者备注（manifest.json 扩展 notes 字段） | TODO |

### D. 选择模式

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| D1 | 选中高亮持久化 | 选中元素后保持高亮，不仅是 hover outline | TODO |
| D2 | 面包屑路径 | 选中时底部显示 DOM 路径，如 `div.slide > ul > li` | TODO |
| D3 | 多选支持 | Shift+Click 多选元素，批量发送给 agent | TODO |

## 实施顺序

1. **A1** — 缩略图预览（Navigator 核心升级）
2. **A2** — 收起/展开（缩略图完成后加折叠能力）
3. **A3** — 底部横向模式（Navigator 第二形态）
4. **B2** — 全屏演示
5. **B1** — 缩放控制
6. **A4** — 拖拽排序
7. **B3** — Slide 跳转
8. **C3** — Speaker Notes
9. **B4** — 网格总览
10. **C1** — 主题切换
11. **C2** — 宽高比切换
12. **A5** — 右键菜单
13. **D1** — 选中高亮持久化
14. **D2** — 面包屑路径
15. **D3** — 多选支持
