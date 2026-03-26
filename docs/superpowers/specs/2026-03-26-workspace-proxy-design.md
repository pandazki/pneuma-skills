# Workspace Proxy — Reverse Proxy for Viewer API Access

> Pneuma 通用的反向代理机制，解决 viewer 访问外部 API 时的 CORS 问题。

## Problem

Viewer 组件（如 gridboard tiles）在浏览器中直接 `fetch()` 外部 API。当目标 API 没有 `Access-Control-Allow-Origin` 头时，请求被浏览器拦截。Agent 目前没有任何手段绕过 CORS，只能祈祷目标 API 碰巧支持。

## Solution

在 Pneuma server 上提供一个 `/proxy/<name>/*` 的反向代理层。Viewer 代码用相对路径访问，请求由 server 端转发到目标 API，天然规避 CORS。

代理路由通过两层配置声明：
- **Manifest**（mode 作者预置常用代理）
- **Workspace `proxy.json`**（Agent 运行时动态添加）

---

## Data Model

### ProxyRoute 类型

新增到 `core/types/mode-manifest.ts`：

```typescript
interface ProxyRoute {
  /** 转发目标 base URL */
  target: string;
  /** 附加请求头，值支持 {{ENV_VAR}} 模板语法 */
  headers?: Record<string, string>;
  /** 允许的 HTTP 方法，默认 ["GET"] */
  methods?: string[];
  /** 描述（注入 CLAUDE.md 时用） */
  description?: string;
}
```

### ModeManifest 扩展

```typescript
interface ModeManifest {
  // ...existing fields
  /** Mode 预置的反向代理路由 */
  proxy?: Record<string, ProxyRoute>;
}
```

### Workspace 配置文件

`<workspace>/proxy.json`，格式为 `Record<string, ProxyRoute>`：

```jsonc
{
  "github": {
    "target": "https://api.github.com",
    "headers": {
      "Authorization": "Bearer {{GITHUB_TOKEN}}"
    },
    "description": "GitHub REST API"
  }
}
```

### 合并规则

`manifest.proxy` 与 `proxy.json` 合并，**workspace 同名条目覆盖 manifest 条目**。这允许 Agent/用户 override mode 作者的默认值（如替换 target 或追加 auth headers）。

---

## Server Implementation

### Proxy Middleware (`server/proxy-middleware.ts`)

新文件，约 80-100 行。核心流程：

```
GET /proxy/github/repos/foo/bar?page=2
  ↓
1. 解析 URL → name="github", path="repos/foo/bar", query="page=2"
2. 内存 Map 查找 "github" → ProxyRoute { target, headers, methods }
   ↓ 找不到 → 404
3. 检查 HTTP method ∈ methods（默认 ["GET"]）
   ↓ 不在 → 405
4. 解析 headers 模板 {{ENV_VAR}} → process.env[ENV_VAR]
5. server-side fetch(target + "/" + path + "?" + query, {
     method,
     headers: { ...resolved_headers, ...passthrough_headers },
     body: (POST/PUT/PATCH 时透传 request body stream)
   })
   ↓ 上游不可达 → 502 Bad Gateway
6. 过滤 hop-by-hop response headers (transfer-encoding, content-encoding 等)
7. 返回 Response(upstream.body, { status, headers })
```

**关键行为：**
- Body stream pipe，不 buffer 全量
- Query string 原样透传
- 上游超时 30s，返回 502
- Response status 原样透传（包括 4xx/5xx）
- **Passthrough headers:** 从浏览器请求透传 `accept`、`content-type`、`accept-language` 到上游；不透传 `host`、`origin`、`referer`、`cookie`（安全边界）。ProxyRoute 的 `headers` 优先级高于 passthrough。

### 路由注册 (`server/index.ts`)

在现有 Hono app 上注册 middleware：

```typescript
import { proxyMiddleware } from "./proxy-middleware";
app.all("/proxy/*", proxyMiddleware(proxyConfigRef));
```

`proxyConfigRef` 是一个 `{ current: Map<string, ProxyRoute> }` 引用，middleware 每次请求读取最新值。

### 热更新 (`server/file-watcher.ts`)

在现有 chokidar watcher 上添加 `proxy.json` 监听：

```
proxy.json add/change → JSON.parse → 与 manifest.proxy 合并 → 更新 proxyConfigRef.current
proxy.json unlink → 回退到纯 manifest.proxy
```

不新建 watcher 实例，复用现有的 chokidar。

### Dev / Prod 模式

| 模式 | 链路 |
|------|------|
| **Dev** | Browser → Vite (`/proxy` → backend) → Hono middleware → 上游 |
| **Prod** | Browser → Hono middleware → 上游 |

对 viewer 代码完全透明，都是 `/proxy/<name>/...`。

### Vite 配置 (`vite.config.ts`)

新增 proxy 条目：

```typescript
proxy: {
  "/api": ...,
  "/content": ...,
  "/export": ...,
  "/proxy": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,  // 新增
}
```

---

## Agent Awareness

### Skill Installer 自动注入 (`server/skill-installer.ts`)

在 `generateViewerApiSection()` 中，根据合并后的 proxy config 生成 Proxy 段落，注入到 CLAUDE.md 的 `<!-- pneuma:viewer-api:start -->` 区块内：

```markdown
### Proxy

The runtime provides a reverse proxy to avoid CORS issues when fetching external APIs.

**Available proxies (from mode defaults):**
| Name | Target | Description |
|------|--------|-------------|
| `coingecko` | `https://api.coingecko.com` | Crypto price data |
| `wttr` | `https://wttr.in` | Weather API |

**Usage in viewer code:**
- Use `/proxy/<name>/<path>` instead of absolute URLs
- Example: `fetch("/proxy/coingecko/api/v3/simple/price?ids=bitcoin")`

**Adding new proxies:**
- Write `proxy.json` in workspace root:
  ```json
  { "github": { "target": "https://api.github.com", "headers": { "Authorization": "Bearer {{GITHUB_TOKEN}}" } } }
  ```
- Immediately available at `/proxy/github/...`
- Headers support `{{ENV_VAR}}` for secrets from environment
- Allowed methods default to GET only; add `"methods": ["GET","POST"]` if needed
```

此段落在 session 启动时一次性生成。proxy.json 运行时变更不需要重写 CLAUDE.md — Agent 已知机制，只是代理列表变了。

### Per-Mode Skill 补充

各 mode 的 skill 文件应在示例代码中推荐 proxy 写法：

```typescript
// ❌ Direct external fetch (may hit CORS)
fetch("https://api.github.com/repos/foo/bar")

// ✅ Use /proxy/ prefix (proxied by pneuma, no CORS)
fetch("/proxy/github/repos/foo/bar")
```

这是 mode 作者的责任，不属于 runtime 自动行为。

---

## Changes Summary

| File | Change |
|------|--------|
| `core/types/mode-manifest.ts` | Add `ProxyRoute` type, `ModeManifest.proxy` field |
| `server/proxy-middleware.ts` | **New file** — proxy middleware (~100 lines) |
| `server/index.ts` | Register `/proxy/*` middleware, init proxy config from manifest |
| `server/file-watcher.ts` | Watch `proxy.json`, merge with manifest, update in-memory map |
| `vite.config.ts` | Add `"/proxy"` entry to dev server proxy |
| `server/skill-installer.ts` | Generate Proxy section in `generateViewerApiSection()` |
| `modes/gridboard/manifest.ts` | Add preset proxy routes (coingecko, wttr) |
| `modes/gridboard/skill/SKILL.md` | Update dataSource examples to use `/proxy/` |

## Out of Scope

- Request/response body transform — 如果需要数据转换，在 tile 代码里做
- 代码式 handler（API routes）— 未来可作为独立特性扩展
- 认证 OAuth flow — proxy 只做 header 注入，token 管理由用户/Agent 自行处理
- Rate limiting — 初版不做，视使用情况决定是否追加
