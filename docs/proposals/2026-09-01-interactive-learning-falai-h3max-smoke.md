# fal.ai MiniMax H3 Max 冒烟报告(交互式学习 mode 前置调研)

> 新坑代号待定:一个交互式学习(interactive learning)新 mode,核心生成引擎候选为
> fal.ai 的 MiniMax H3 Max 三个视频端点。本文是 2026-09-01 用仓库 `.env` 的
> `FAL_KEY` 实测三个 API 的一手记录 —— 全部成功,速度远超预期。

## 结论(TL;DR)

三个端点全部可用,**5 秒 480P 视频的端到端墙钟时间 2–19 秒**,GPU 推理(DiT denoising)
只占 **0.56–2.4 秒** —— 剩余时间花在 prompt expansion 与参考素材分析上。这个速度
意味着"边学边生成"的交互节奏是成立的:用户提问 → 数秒内拿到一段定制视频讲解。

| 端点 | 墙钟 | `timings.inference` | 输出 |
|------|------|--------------------|------|
| text-to-video | **2s** | 0.78s | 832×480, h264, 24fps, 5.17s |
| image-to-video | **3s** | 0.56s | 480×480(跟随输入图比例) |
| reference-to-video | **19s** | 2.43s | 832×480(`adaptive`) |

## 端点与参数(三者共享骨架)

Base:`https://fal.run/minimax/h3-max/{text-to-video|image-to-video|reference-to-video}`
认证:`Authorization: Key $FAL_KEY`(key 在仓库 `.env`)

共享参数:
- `prompt`(必填)+ `prompt_expansion_mode`(必填,`"balanced"` ≈1s / `"quality"` ≤30s)
- `duration`: 5–15(默认 5)
- `resolution`: `"480P"` / `"768P"`(默认 768P)
- `seed` / `enable_safety_checker` / `sync_mode`(base64 直返)

各自的差异参数:
- **t2v**:`aspect_ratio`(`21:9`/`16:9`/`4:3`/`1:1`/`3:4`/`9:16`,默认 16:9)
- **i2v**:`image_url`(首帧,输出比例跟随它)+ `end_image_url`(尾帧,首尾关键帧生成)。
  两者都可省 —— 省了就退化成 t2v
- **r2v**:`reference_image_urls[]` + `reference_video_urls[]`(单条 2–15s,合计 ≤15s)
  + `reference_audio_urls[]`(不能只给音频),合计 ≤12 个文件;prompt 里用
  `Image 1` / `Video 1` / `Audio 1` 的序号指代;`aspect_ratio` 多一个 `"adaptive"`(默认)

输出:`{ video: { url, file_size, … }, expanded_prompt, timings, seed(仅 r2v) }`。
`expanded_prompt` 很有价值 —— 是一份带镜头语言、逐秒编排的完整导演脚本,可回收
做 provenance / 复现 / 迭代改写的底稿。

## 定价(注意:促销价 2026-09-01 截止,今天起恢复原价)

- t2v / i2v:480P **$0.05/s**、768P **$0.08/s**(促销期为半价)
- r2v:**$0.08/s** + 参考素材按 token 计费(前 4096 token 免费;1024×1024 图 ≈ 1k token,
  即前 4 张参考图免费,之后每 1k token $0.02)
- 换算:一段 5s 讲解视频 480P 约 **$0.25**,768P 约 **$0.40**;r2v 5s 约 **$0.40**

## 实测样例(2026-09-01,均为 5s @ 480P)

1. **t2v** — prompt:黑板粉笔风水循环动画(教学场景试探)。产出质量高:深绿板面、
   白粉笔线条、太阳→海面蒸发→云→山区降雨的连贯 morph。
   `https://v3b.fal.media/files/b/0aa8a621/oXqWSWS_HOagGTG4gPC3X_minimax-h3.mp4`
2. **i2v** — 官方示例图(林间腾空的山地车手)+ 推镜 prompt,动态自然。
   `https://v3b.fal.media/files/b/0aa8a637/GAVkYMCs2JeOg-37Twz5X_minimax-h3.mp4`
3. **r2v** — 同一张图作 `Image 1`,要求角色一致地转头微笑。角色一致性极好
   (头盔、黑衣、胡茬全保留)。**值得注意**:prompt 里故意写错了性别("her"),
   模型忠实跟随参考图的真实人物而非文字 —— 参考图的权威性高于 prompt 措辞。
   `https://v3b.fal.media/files/b/0aa8a622/lIt4Uzt-iGiZRp6oum6qf_minimax-h3.mp4`

(CDN 链接可能过期;本地副本在会话 scratchpad,重生成成本 <$0.5,不入库。)

## 已知 gotchas

- `prompt_expansion_mode` 是**必填**字段(文档标 required 且无隐式默认行为可依赖),
  漏掉可能 422。`balanced` 对交互场景足够;`quality` 会把等待拉长到 ~30s,失去交互性。
- i2v 输出比例**完全跟随输入图**(实测方图进 → 480×480 出),要控比例先裁参考图。
- r2v 的 19s 墙钟里推理只占 2.4s,大头是参考素材分析 —— 参考文件越多越慢,
  交互式场景要控制参考数量。
- r2v 返回 `seed`,t2v/i2v 实测返回 `seed: null` —— 可复现性目前只有 r2v 有保障
  (t2v/i2v 可显式传入 seed 换取复现)。
- sync 端点(`fal.run`)在 ~20s 内很舒适;若未来用 `quality` expansion 或 15s 长视频,
  应改走 queue API(`queue.fal.run`)+ 轮询,避免长连接悬挂。

## 对新 mode 的初步启示(待用户 idea 落地后展开)

- **速度成立**:2–3s 出片意味着视频可以作为对话轮次内的一等反馈物,而非"提交后等待"的产物。
- **三端点分工清晰**:t2v 开新概念、i2v 让静态教学素材(图表/板书/插画)动起来
  (首尾帧 = 可控的"状态 A → 状态 B"演变,天然适合演示过程类知识)、
  r2v 维持贯穿课程的角色/风格一致性(如固定讲解员形象、统一视觉风格)。
- **`expanded_prompt` 可回收**:作为生成树 provenance 的一部分,支持"在上一版基础上改"。
