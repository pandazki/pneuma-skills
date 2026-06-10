---
paths:
  - "desktop/**"
---

# Desktop (Electron) Rules

## Baseline

- Stack: Electron 41 + electron-builder + electron-updater. Main-process code in `desktop/src/main/`.
- **`desktop/package.json` version must equal root `package.json`** — `electron-updater` compares the running app against the latest release; a lagging desktop version means users never see the upgrade prompt. Bumping only one of the two is a bug (see Release Process in AGENTS.md).

## Gotchas

- **Background mode**(`pneuma://handoff` 默认):session 跑在隐藏 `BrowserWindow({ show: false, backgroundThrottling: false })`。完成自动揭示:渲染端 `useBackgroundStatusReporter` 经 IPC push `running`/`idle`,`background-sessions.ts` 按 `webContents.id` 关联;首个 `running → idle`(≥1 turn)触发 `revealModeWindow`。容错:60s watchdog 强制 reveal、`did-fail-load` 重试 `loadURL`、renderer crash 也 reveal。逃生口 `&background=0`。服务端零改动——纯桌面表现层。
- **URL 协议**:`pneuma://` 在 `desktop/src/main/index.ts::handlePneumaUrl` 处理;`handoff` case POST 到 launcher 的 `/api/handoffs/external` 再开 mode window。
- **Launcher window 复用**:launcher 经 `window.location.href` 把自己的 `BrowserWindow` 导航成 session 窗口——窗口仍是 `titleBarStyle: "hiddenInset"`,前端 TopBar 的 drag/no-drag 约束因此存在(见 `.claude/rules/frontend.md`)。
- **Mode-window teardown**:桌面 mode-window 追踪所有它导航到过的 URL,关闭时按端口对照 `/api/running` 批量 teardown;`/api/processes/children/:pid/kill` 阶梯式 SIGTERM→SIGKILL。
- **原生桌面 API**(`/api/native/*`)只在 Electron 可用:Server → WS `native_request` → Browser → Electron IPC → result。无浏览器 tab 时 10s 超时;Web 返回 `{ available: false }`。
