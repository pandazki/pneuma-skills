# Design Outline: Pneuma Slide Mode

## Design Goals

- **Purpose**: 向开发者和创作者介绍 Pneuma Skills 的 slide mode，讲清它能做什么、怎么开始
- **Audience**: 用 code agent 的开发者；做演示、做内容的创作者
- **Tone**: 克制、精确、有编辑感。靠事实说话，不喊口号
- **Key message**: 在 slide mode 里，agent 把每页写成 HTML 文件，你全程看着稿子成形，随时点中一处让它改
- **Language**: 中文，技术术语保留英文

## Visual Style

两个 content set，slide HTML 与 manifest 完全相同，只有 `theme.css` 不同：

- `zh-dark/` — Ink：暖墨黑底，骨白字，朱砂色强调
- `zh-light/` — Paper：暖纸白底，墨色字，深一档的朱砂强调

**概念：一份「活的校样」。** 每页都是一个文件，所以每页页眉印着它自己的路径（`slides/slide-03.html`），像印刷校样的页码与裁切标记。强调色只用在一个反复出现的母题上：**选中框**（虚线框 + 四角手柄，讲解选中时再加选择器标签），对应「点中一个元素指给 agent」这一核心交互。选中框只出现在它在讲东西的地方：封面配一个鼠标指针，读作「有人点中了这里」；第 5、6 页带标签，讲写入和选中；结尾页不用。

- **Typography**: 标题 Noto Serif SC（中文衬线，编辑感），拉丁点缀 Instrument Serif 斜体；正文 Inter + PingFang SC；代码与路径 JetBrains Mono
- **Visual elements**: 选中框母题、四角裁切标记、文件路径页眉、代码片段、CSS 绘制的示意图；两张生成图（同一组风格）
- **Density**: 疏朗。一页一个观点
- **可读下限**: 正文 18px 以上；页眉、眉题、图注、代码标题等等宽小字 15px；小字在它所在的每种底色上对比度都不低于 4.5:1，深浅两套都一样
- **断行**: 中文段落在意群处手动断行（`<br>`），不让一两个字单独落在末行，也不把「文件」「稿子」这类词拆在两行
- **规则**: slide 中不写死颜色，全部走 `var(--*)`；唯一例外是第 11 页用来并排展示两套主题的小样

## Slide Structure

1. 封面 — 看着它成形
2. 痛点 — 让 agent 做稿，最费劲的是来回改
3. Pneuma Skills 是什么 — 人和 code agent 共创的基础设施
4. 每一页都是一个 HTML 文件
5. 实时 — 写一页，亮一页
6. 选中 — 点中哪里，就改哪里
7. 配图 — 需要一张图，它就去生成
8. 设计系统 — 一个 theme.css 管住整套稿子
9. 版面 — 每一页都放得下
10. 交付 — 写完就能讲，也能带走
11. 两套主题 — 深浅两套，只换 theme.css
12. 开始 — 一行命令，开一套稿子

## Per-Slide Content

### 1 封面
- 左：眉题 `PNEUMA SKILLS · SLIDE MODE`；主标题「和 agent 一起做演示稿，<选中框>看着它</选中框>成形」，选中框不带选择器标签，右下角一个鼠标指针；副题一句；底部 github 地址
- 右：竖幅图版（生成图 cover-breath）

### 2 痛点
- 标题：让 agent 做稿，最费劲的是来回改
- 三条编号短句：看不到过程 / 说不清改哪一处 / 改一处牵动全篇
- 编辑式排版：大号编号 + 细分隔线，不用卡片

### 3 Pneuma Skills
- 标题：人和 code agent 共创的基础设施
- 横向示意：你 ⇄ 播放器 ⇄ 文件 ⇄ Agent；说明 agent 在磁盘文件上工作，播放器把文件实时渲染成领域内容
- 底部小字：支持 Claude Code、Codex、Kimi；slide 是众多 mode 之一

### 4 每一页都是一个 HTML 文件
- 左：文件树（manifest.json / theme.css / slides / assets）
- 右：一段 slide 片段代码

### 5 实时成形
- 胶片条：6 张缩略页，状态分三种：已写 / 正在写（选中框强调）/ 待写
- 说明：写一页，亮一页

### 6 点中就能指
- 左：一张模拟页，标题被选中框框住，标签 `h1.title`
- 右：viewer-context 片段 + 三步说明：点中 → 它收到地址 → 只改这一处

### 7 生成配图
- 左：生成图 slide-07-fold 图版
- 右：说明 + 这张图用的提示词（节选）+ 输出路径 `assets/slide-07-fold.jpg`

### 8 theme.css 设计系统
- 色票全部用 `var()` 渲染：深色稿显示深色 token，浅色稿显示浅色 token
- 字体三行样张：衬线 / 无衬线 / 等宽

### 9 每一页都放得下
- 左：1280×720 画布示意，标出 64px 边距与 1152×592 内容区
- 右：说明高度预算 + checkContentFit 返回片段

### 10 演示与导出
- 两栏：演示（presenter mode、拖拽排序、多 content set 切换）/ 导出（PDF、图片）

### 11 深浅两套
- 两张并排小样（写死两套色值）+ 命令 `diff -rq zh-dark zh-light` 的结果：只有 theme.css 不同

### 12 怎么开始
- 命令：`bunx pneuma-skills slide --workspace ./my-first-pneuma-slide`
- 四步：描述主题 → 看它成形 → 点中修改 → 演示或导出
- 也可下载桌面版；github.com/pandazki/pneuma-skills（纯文字，不加选中框）

## Image & Visual Plan

- **生成图**（同一组风格描述）：
  - cover-breath（3:4）：悬在空中、被一口气托起的几张半透明和纸，一根朱砂细线
  - slide-07-fold（16:9）：暗色石面上一张拱起的和纸，朱砂细线横过
  - 共用风格句：Editorial still-life photograph, medium-format film, warm raking light, deep warm charcoal background, bone white / warm grey / thin vermilion accent
- 交付尺寸：cover-breath 768×1024、slide-07-fold 1280×720（约为显示尺寸的两倍），JPEG
- 图作为「图版」嵌在页面里（细边框 + 图注），深浅两套主题都成立
- 其余视觉用 CSS/SVG
