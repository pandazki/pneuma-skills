# Release Process

Canonical release checklist and recovery notes. Read as part of the `bump` skill.

CI (`release.yml`) handles tagging, GitHub Release, and npm publish on push to `main`. **Do NOT manually create or push git tags.**

### Version Bump Checklist (same commit)
1. `package.json` — `"version"`
2. `desktop/package.json` — `"version"`, **must equal** `package.json` 的值。`electron-updater` 用它比较运行中的桌面应用与最新 release;3.10.3 起两者绑定,**只 bump 一份就是 bug**。
3. `AGENTS.md` — `**Version:**` 行(仓库根指令文件。`CLAUDE.md` 只是一行 `@AGENTS.md` import,不含版本号——**不要**往 `CLAUDE.md` 写任何内容)
4. `CHANGELOG.md` — new section
5. `README.md` **和 `README.zh.md`** — 若本次改动碰了 mode 表、CLI 用法/子命令、技术栈表或 feature 列表,**两个语言版本都要改**。zh 版没有任何自动化守卫,只靠这条清单;它曾经因此落后英文版两个月(缺 wordtaste、缺整个 `library` 子命令族、`mode add` 描述停在单-mode 时代)。改一个就得改另一个。

6. **发布体积** —— 若本次新增了 mode 或往仓库里加了大宗二进制(截图、证据帧、样例素材),先跑 `npm pack --dry-run` 看打包体积。**npm 单包上限约 250 MB**,超了 `npm publish` 回 `413 Payload Too Large`,而那一步在 CI 的**最后**:tag 建了、GitHub Release 发了、**只有 registry 没拿到包**——半发布状态,而且从 release 页面上看不出来。3.29.0 就这么炸过一次(bansho 的 `harness/screenshots/` 166 MB,把包顶到 346 MB)。
   **排除大宗物料只能靠 `package.json` 的 `files` 否定模式**(`"!modes/*/harness/"`),**`.npmignore` 对 `files` 白名单里的目录无效**——`files` 优先级更高,写进 `.npmignore` 的那一版打出来一个字节都没少。
   **先 `bun run build` 再 `npm pack --dry-run`,否则少算 `dist/`(30 MB / 294 文件)**——CI 在 publish 前会 build,`files` 里有 `dist/`。3.45.0 就是这样漏的:本地 dry-run 185.8 MB 看着安全,CI 打出 202.5 MB / 249.4 MB unpacked,`413`;3.44.1 是 244 MB unpacked 刚好挤过去的。**实际上限按 tarball ≈ 195 MB / unpacked ≈ 245 MB 算,目标留 40 MB 余量**。大头是 launcher 的 showcase / seed-gallery PNG(94 张 87 MB → pngquant 后 40 MB)和 kami 种子里的两份 19 MB 字体;新加的 showcase 图先 `pngquant --quality=85-100` 再提交。
   **mode 分发拆分之后(见下面 6b)量到**:187.3 MB / 238.2 MB unpacked / 2294 文件 → **136.1 MB / 174.2 MB unpacked / 1469 文件**。新增一个 **catalog** mode 现在只往包里加它的 `showcase/` 图(几 MB);只有新增 **bundled** mode 才会整个进包——往 `modes/distribution.json` 的 `bundled` 里加名字之前先量一次。`files` 里 `modes/*/showcase/**` **末尾那两个星号不能省**:npm-packlist 只对真实目录展开出 `!dir/**`,带 glob 的条目原样使用,写成 `modes/*/showcase/` 会只进 3 个文件而不是 127 个,而且不报错。



6b. **Catalog modes 要跟这次 release 一起发到 CDN,而且必须在 push 之前** —— `modes/distribution.json` 的 `bundled` 之外的每个 mode 都不进包(只留 `showcase/`),靠 `modes/catalog.json` 里钉死的 URL + SHA-256 在首次使用时下载。预构建的 viewer bundle 内联了这个 core 的 `src/`/`core/` 辅助代码、依赖宿主的 React/store/Tailwind,**只能跑在造出它的那个 core 上**——所以每次 release 都要把每个 catalog mode 从同一个 commit 重新构建、重新上传:

   ```bash
   bun run publish:modes --version X.Y.Z --dry-run   # 先看体积,不上传
   bun run publish:modes --version X.Y.Z             # 构建 + 打包 + 上传
   ```

   凭证用 `~/.pneuma/r2.json`(和 snapshot publish 同一份)。Key 是 `official/vX.Y.Z/<name>-<modeVersion>.tar.gz`,目录里还有一份 `catalog.json`。**CI 没有 R2 凭证、不上传**,只在 `Build` 之后、**建 tag 之前**跑 `Verify mode catalog`:它把 `official/vX.Y.Z/catalog.json` 拉下来、对每个 archive 发 HEAD 比对 size,通过之后那份文件留在磁盘上,正是 `npm publish` 会打进包的那份(`package.json` 的 `files` 里列了 `modes/catalog.json`,尽管它被 gitignore)。desktop 矩阵同样先拉一次,所以安装包和 npm 钉的是同一批 archive。

   **覆盖规则**:字节完全相同的 key 跳过;字节不同的 key **只在 `pneuma-skills@X.Y.Z` 还没上 npm 时**允许覆盖——这正是 3.51.0 那种「release gate 挂了、同一个版本号补两个 fix commit」的路径。**一旦那个版本发布到了 npm,脚本拒绝覆盖**并让你改版本号:已发布 core 的用户解析的就是这几个 URL,改掉它们等于悄悄换掉一个已发行版的内容。重跑时跑整个脚本、别用 `--only`——一次 release 里的 archive 必须同出一个 commit。

   **半发布恢复**:如果 push 之后 CI 在 verify 步挂了(archive 没上去 / size 对不上),tag 和 npm 都还没发生,本地补跑 `publish:modes` 再 `gh workflow run Release` 即可。如果是 archive 传了但 npm 挂了,重跑同版本的 `publish:modes` 会把所有 key 报成「相同字节,跳过」,不会触发拒绝。

7. **桌面产物半发布的恢复路径** —— desktop 矩阵在 release 之后跑,单个平台失败(先例:3.36.0 的 macOS 连续两次在 dmg 步 ENOSPC——runner 磁盘被 .app+zip+dmg 暂存三份大件顶爆)**不会**回滚已发的 tag/Release/npm。**先看 ENOSPC 报在哪个卷**:3.45.1 的 macOS 报的是 `/Volumes/Pneuma Skills 3.45.1-arm64/...`,而 `df -h /` 还有 91 GiB——那是 dmgbuild 自动估算的 **DMG 临时镜像**装不下 .app(估算不算硬链接/框架的实际占用),是确定性失败,重跑无用;修法是 `desktop/electron-builder.yml` 里钉 `dmg.size`(现为 `3g`,UDZO 压缩后空闲块不占体积)。恢复用 `gh workflow run Release`(workflow_dispatch):tag 已存在 → release job 跳过,desktop 矩阵重建并**只补缺失资产**(已发布的安装包与 latest*.yml 校验和不被搅动)。不要删 tag 重推。darwin job 自带磁盘清理 + `df -h` 诊断;`electron-builder.yml` 的 modes 条目排除 `harness/`(npm 的 `files` 负模式管不到桌面包)。

8. **在线播放器 CI 不碰,由 `/bump` 自动部署** —— `core/player-support.ts` 的白名单改了(新 mode 支持云端查看)、或任何 `src/player/**` / mode viewer 的改动要在 `pneuma.deepaste.ai` 上生效,**必须跑 `scripts/deploy-player.sh`**(需要本机 wrangler 已登录)。`/bump` 的 6b 步会按 tag 间的 diff 自动判定并执行——手动 bump 时别漏。viewer 是**构建期**打进播放器 bundle 的,所以「代码里进了白名单」不等于「线上能播」。更糟的是这两者脱节会**变成硬报错**而不是优雅降级:导出器按新白名单给包盖 `supported: true`,而线上旧 bundle 里没有那个 mode 的 viewer,`loadMode()` 直接抛错 → 用户看到 "This shared link could not be loaded"。先例:eli5 随 3.37.0 发布并进了白名单,但播放器没重新部署,那期间分享的 eli5 链接全是坏的。

然后 `git push origin main`(不带 `--tags`)。CI 建 tag、发 release、publish。完整流程走 `/bump` command。
