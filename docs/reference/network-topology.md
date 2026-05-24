# Network Topology

> 一个 mode 启动后，Pneuma 在用户机器上到底跑了几个进程、它们怎么互相说话——这篇只回答这个问题。其他通信契约（六个方向、消息形态）见 [`viewer-agent-protocol.md`](./viewer-agent-protocol.md)。

## 端口

| 端口 | 组件 | 何时 | 说明 |
|------|------|------|------|
| **17996** | Vite dev server / 生产 Hono | dev / prod | 浏览器入口；prod 模式同进程也服 API 与 WS |
| **17007** | Hono backend | dev mode | dev 模式下与 Vite 拆开的 REST + WebSocket + 文件监听 |
| auto | 子进程 backend / Vite | launcher 派生 / Mode-Maker Play | 依次递增直到空闲；通过 stdout 回传给父进程 |

所有 server 都 bind 到 `0.0.0.0`——这是为了规避 macOS 上 IPv4/IPv6 dual-stack 抢占同一端口的隐性碰撞，**不**是为了对局域网公开。

## Dev vs Prod 的拓扑差

Pneuma 通过 `dist/index.html` 是否存在判断模式：有 dist 就走单进程 prod，否则走 dev 双进程（`--dev` 强制 dev）。

**Dev — 两个进程，浏览器同时跟它们俩说话：**

```
Browser
   │ http://localhost:17996   ──→  Vite (:17996)
   │                                 ├─ /api/*    →proxy→  Hono (:17007)
   │                                 └─ /content/* →proxy→  ↑
   │                                 
   └─ ws://localhost:17007/ws/browser/:id ──→  Hono (:17007)
                                                  │
                                            Agent backend
                                       (Claude/Kimi: stdio NDJSON,
                                        Codex: stdio JSON-RPC)
```

**关键：浏览器 WebSocket 不走 Vite proxy，直连 Hono。** Vite 的 WS proxy 与 `Bun.serve` 不可靠；从一开始就让它们脱钩省下大量诡异 bug。

**Prod — 单进程，所有协议同源：**

```
Browser
   │ http://localhost:17996   ──→  Hono (:17996)
                                     ├─ Static (dist/)
                                     ├─ /api/* + /content/*
                                     └─ /ws/*
                                            │
                                      Agent backend (stdio)
```

## Scenario 矩阵

| 场景 | 命令 | Backend | Vite | 浏览器入口 |
|------|------|:-----:|:-----:|------|
| Dev 模式 | `bun run dev <mode>` | 17007 | 17996 | `:17996` |
| Prod 模式 | `pneuma <mode>` | 17996 | — | `:17996` |
| Dev launcher | `bun run dev` | 17007 | 17996 | `:17996` |
| Prod launcher | `pneuma` | 17996 | — | `:17996` |
| Launcher 派生子进程 | （由 launcher 发起） | auto | auto | auto |
| Mode-Maker Play | （由 mode-maker 发起） | 18997 | 18996 | `:18996` |
| 自定端口 | `--port 9000` | 9000 | 17996 | `:17996` |

> `--port` 只控 backend；Vite 端口独立（`PNEUMA_VITE_PORT` 可覆盖）。

## WebSocket 路由

| 路径 | 协议 | 客户端 | 用途 |
|------|------|------|------|
| `/ws/browser/:sessionId` | JSON | 浏览器 UI | 用户消息、权限审批、viewer action |
| `/ws/cli/:sessionId` | NDJSON | 历史 Claude CLI 路径 | 已被各 backend 的 stdio bridge 取代，保留供 legacy 调用 |
| `/ws/terminal/:terminalId` | binary | xterm.js | PTY I/O |

三个 backend 现都跑 stdio——Claude/Kimi 是 stdio NDJSON，Codex 是 stdio JSON-RPC，浏览器 ↔ backend 的桥接走 `BridgeBackend` 实现（`ws-bridge-{codex,kimi}.ts` 等）。Browser session state 携带 `backend_type` / `agent_capabilities` / `agent_version`，前端按这些 feature-gate，不依赖具体 transport。

## 派生进程

**Launcher → 子 session：** 用户在 launcher 点 Launch，POST `/api/launch` resolve mode + backend，spawn `bun pneuma.ts <mode> --port <auto> --backend <type> --no-open --no-prompt [--dev] [--debug]`，等子进程 stdout 打出 `[pneuma] ready http://...`，把 URL 回给浏览器跳转。`--dev` / `--debug` 父进程继承。

**Mode-Maker Play：** 在 mode-maker 里点 Play，spawn 一个隔离环境（backend `:18997`、Vite `:18996`，临时 workspace `/tmp/pneuma-play-*`）测试当前 mode。端口在 `server/mode-maker-routes.ts` 固定，避开常规递增段。

**端口自递增：** 请求的 port 被占时，server 顺序往上试至空闲；Vite 同理（`strictPort: false`）。实际绑定值经 stdout 回传给上游。

## 起点文件

| 关注点 | 文件 |
|---|---|
| 端口选取 / dev 检测 / Vite env | `bin/pneuma.ts` |
| Server 启动 + 自递增 | `server/index.ts` |
| Vite proxy | `vite.config.ts` |
| 浏览器 WS URL 推导 | `src/ws.ts` |
| Backend stdio 与 WS 桥接 | `backends/{claude-code,codex,kimi-cli}/`、`server/ws-bridge*.ts` |
| Play 子进程 | `server/mode-maker-routes.ts` |
