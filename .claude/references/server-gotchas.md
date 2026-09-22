# Server records

Incident evidence and measurements behind the rules in
[`.claude/rules/server.md`](../rules/server.md). Each section states when it was
measured and on which version; re-measure before treating a number as current.

## Project-cache watcher stall

Measured 2026-09-08, `server/projects-cache.ts`, registry with 19 projects.

**Project-cache watchers must prune content before traversal** (`server/projects-cache.ts`, 2026-09-08): `depth: 2` still visits each session's content, captures, and dependency directories. Every session server primes all registered projects, so unrelated workspaces can stall a newly opened session's first HTTP response. On a registry with 19 projects, `/api/launch` returned in 354 ms but the document waited 37.7 s; running only `primeProjectCache` (no backend or downloads) stalled the event loop for 32.8 s. Use `depth: 1`, disable symlink following, and an `ignored` predicate that admits only session directories and their direct `session.json` / `history.json` / `thumbnail.png` files. Filtering emitted events is too late. The same probe then completed in 0.76 s and the full document wait fell to 0.74 s. Keep real watcher tests for content isolation AND atomic metadata replacement, history/thumbnail writes, and session creation/removal.

## Bun file-watcher deadlock

Measured 2026-09-02 on macOS arm64.

**Bun <= 1.3.13 在 macOS arm64 上会把整个 server 死锁(2026-09-02 实测)**:症状是「seek 几下视频整个应用卡死,刷新都没反应」——其实和视频无关。`sample <pid>` 看到主线程和 `File Watcher` 线程都停在 `_os_unfair_lock_lock_slow`、0% CPU、所有路由与 WS 全死、Vite 还活着(所以 HTML 能刷出来但 API 全挂)。根因是 Bun 运行时的锁序倒置(分配器锁 vs 线程池锁,oven-sh/bun#26762,mimalloc v3 升级修的),触发条件是 chokidar 监听的工作区里高频 mkdir/rename/rmdir——plotwise 播放时后台预生成分支正是这种负载(`nodes/<id>/` 落盘、`course.json.lock` 反复出现消失)。复现:用生产 `startFileWatcher` + 某个 mode 的 `viewer` 配置起一个 Bun 进程,另一进程循环「建目录写文件 → 改名 → 加锁目录 → 删旧目录」,1.3.11 在 540/1000 轮、1.3.12 在 190 轮、1.3.13 在 70 轮挂;1.3.14 与 1.4.0 跑满 3000 轮。所以 `engines.bun`、`bin/pneuma.ts::checkBunVersion`、CI `setup-bun`、`desktop/scripts/download-bun.mjs` 四处都抬到了 >= 1.3.14(CI 与桌面钉 1.4.0)。**四处必须一起动**——桌面端自带 Bun,用户升级本机 Bun 救不了桌面 app。别在应用层「绕」这个 bug(加轮询、去锁目录只是把触发概率调低)。

## Range responses and Blob slices

Measured 2026-09-02 on Bun 1.4.0.

**Bun 1.4.0:切片后的 `Bun.file().slice(a,b).stream()` 吐出整个文件,`/content/*` 的 Range 响应因此全量返回(2026-09-02 实测)**:`new Response(file.slice(a,b))` 本身是对的(Blob 体、长度对),但 Hono 的 `cors()` 等任何中间件为了盖 header 都会 `new Response(res.body, …)` 重包一次——`res.body` 走的就是那条坏掉的 stream 路径。结果是 `Content-Range: bytes 0-1023/7086087` 配上 7 MB 的 body,Chrome 直接判媒体不合法(`MediaError.code === 4`,`networkState 3`):plotwise 舞台全黑、任何 mode 的视频 seek 都失败;而已经被浏览器整份缓存过的 clip(304)照常能放,所以看起来"有的能播有的不能"。现在 Range 分支用 `Readable.toWeb(createReadStream(absPath, { start, end }))`,不依赖 blob 切片在重包后还成立;stream 体 Bun 会按 chunked 发并丢掉显式 `Content-Length`,总长靠 `Content-Range` 给。`server/__tests__/content-route.test.ts` 现在**和生产一样先挂 `cors()` 再挂路由**,并断言 partial body 的字节数——之前那份只查 header 的测试在坏版本上照样全绿。教训:凡是返回 Blob 体的路由,测试要读 body,而且要在和生产相同的中间件链下读。

## Virtualenv kills the file watcher

Measured 2026-09-02 during a plotwise session.

**文件监听会被一个工作区内的 virtualenv 无声弄死,而且服务重启时还会在 Bun 的分配器锁上卡几分钟**(2026-09-02 plotwise 实测):接地子代理在 `bayes/evidence/` 下建了 `.venv`(12,704 个文件),`DEFAULT_IGNORE` 有 `node_modules` 却没有 `.venv`/`__pycache__`。之后 course.json 每次变化服务端都看得到(`/api/files` 是现读磁盘的,**它证明不了监听还活着**),浏览器却一条 `content_update` 都收不到——用户看到的是"续段明明拍好了,页面一直转圈"。判别方法:往被监听的目录里写一个 `.md` 探测文件,同时用一个被动 WebSocket 客户端连 `/ws/browser/<sid>` 看 12 秒内有没有 `content_update`;没有就是监听死了,只能重启。重启前先把 venv 挪走:带着 17k 文件起服务,主线程会在 `_os_unfair_lock_lock_slow` 里转好几分钟(`sample` 看主线程 760/812 个样本在锁上,CPU 却有 13%——不是死锁,是 lstat 风暴下的锁争用),`/api/session` 超时,页面停在 "Loading…"。修法两层:监听忽略表对齐 `shadow-git.ts::BASE_EXCLUDE_RULES`(`.venv`/`venv`/`__pycache__`/`site-packages`/`*.pyc`/各种 cache),以及 mode 的 brief/SKILL 明说"环境建在工作区外"。**两张排除表以后要一起改。**
