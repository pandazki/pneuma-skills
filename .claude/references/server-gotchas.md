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

## Binary files in the snapshot

Measured 2026-09-23 on a sprite workspace (1.6 GB, 2,818 files matched by `**/project.json`, `**/refs/**/*`, `**/motions/**/*`).

`GET /api/files` read every match with `readFileSync(path, "utf-8")`: 2,727 frame PNGs, 20 WebM, 20 MP4 and 10 animated WebP became 745 M characters of U+FFFD-inflated text (a 400 KB PNG decodes to about 1.2 MB). The response was 1.89 GB; first byte after 63 s, complete after 81 s, the server's RSS 122 MB -> 6.7 GB. In headless Chrome the fetch reached 1.26 GB in 14.5 s, the renderer rose to 1.8 GB with a 2.6 s long task, and the request ended `net::ERR_ABORTED`. `App.tsx` never called `markFilesHydrated`, so the viewer showed "No character yet" for as long as it stayed open (183 s run). `src/ws.ts` repeats the same fetch on every reconnect. The owner's installed Desktop 3.52.1 ships the same route.

After `readWorkspaceText` (binary -> `{ path, content: "" }`), the same workspace's snapshot is 2.8 MB (41 JSON bodies, 2,777 path-only entries), 0.12-0.4 s warm. The watcher flush applies the same rule; before it, a watched `**/*.woff2` (webcraft, kami) reached every browser as mangled text. `readWorkspaceText` is deliberately not `isBinarySeedFile`: the seed question ("must this be copied byte-for-byte?") may answer yes for text such as SVG, while a wrong "binary" here hides text a viewer reads. Tests: `server/__tests__/binary-snapshot.test.ts`.

## Watcher registration cost

Measured 2026-09-23, macOS arm64, Bun 1.4.0.

chokidar 5 has no FSEvents backend; its Node handler opens one `fs.watch` per file and per directory. Bun's per-file registration is superlinear and synchronous on the main thread. Opening N watches in one process: 250 -> 43 ms, 1,000 -> 1.4 s, 2,000 -> 2.5 s, 3,000 -> 11.1 s, 4,000 -> 69.2 s. A `--cpu-prof` of a sprite viewing session (2,882 watched files, `HOME` pointed at an empty directory so no projects-cache work ran) spent 73.4 s of 76 s in native `watch`. `/api/session` stalled up to 24 s, and the page's own `GET /` waited about 33 s, so the first render came at 40.8 s even after the snapshot fix. With sprite's frame, cell and scratch directories in `ignorePatterns` (198 watched files), the server is ready in 0.9 s and the first render lands 4.6 s after navigation. A single recursive `fs.watch(root, { recursive: true })` set up in 21.8 ms on the same tree. It would remove the per-file cost for every mode, but it has no pre-traversal `ignored` predicate: on Linux, where recursion is emulated per directory, an ignored `node_modules` or `.venv` would presumably still be walked (not measured). The awaitWriteFinish, symlink and deletion semantics would also need re-verifying, so it has not replaced chokidar.

### Replacements lost under Bun (2026-09-24)

Measured on macOS arm64, Bun 1.4.0, chokidar 5.0.0. In a large tree, chokidar under Bun loses a file that is REPLACED by rename, which is how every mode script's `writeJsonAtomic` writes. The case was backlot's `cut --finish` rewriting `cut/edl.json`, which left the open Cut stage on the old film until a reload. The same run reproduces under a passive `/ws/browser/<sid>` client: `content_update` arrived for `cut --final` and not for the `--finish` after it.

Evidence:
- **The owner's backlot clone** (391 directories and 1,016 files, after pruning): plain chokidar with three `cut --finish` runs reported 1 of 3 replacements under Bun and 3 of 3 under Node. Bun took 14.9 s to reach `ready`; Node took 0.1 s.
- **A synthetic tree:** 3 of 3 with 100 directories, but 2 of 3 with 400 (`ready` at 24 s).
- **A single recursive `fs.watch(root, { recursive: true })` alone** saw 3 of 3 on the same tree.
- **The trap:** with chokidar's per-path watches in the same process, even that recursive watch reported nothing (200 directories, native registered before or after chokidar). **Adding a native watch beside chokidar does not help**; it was tried and reverted.
- **An in-place write** (`touch`) of the replaced file was still delivered, which is why the blind trial's agent could unstick the viewer by touching `edl.json`.

The fix is to replace chokidar on macOS with one recursive watch and give that watcher the ignore, debounce, image, deletion and self-write semantics chokidar provides today. First check whether `server/projects-cache.ts`'s chokidar in the same process also deafens it. That has not been done yet.
