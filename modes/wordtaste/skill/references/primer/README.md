# Primer — passages a writer reads before it starts

Before WordTaste dispatches a writer or repairer, `run_leaf.ts` appends a few
randomly windowed passages of good Chinese prose to the private prompt,
framed in plain Chinese as "read these, then put them down; they are not
content guidance." The passages prime the writer's sense of what clean,
uneven, breathing Chinese looks like at the moment it begins to write.

This directory is the bundled library: public-domain modern Chinese prose
(authors who died 50+ years ago). Users can add their own libraries under
`~/.pneuma/primers/<name>/` (see *User libraries*). Nothing in a user library
is ever copied into the repository or the npm package.

## Why this step exists

Evidence from the first real long-form run (`~/pneuma-projects/wordtaste-20260730-0625`,
Codex backend, 11 units, 76 minutes):

- The writer prompts carried no taste material at all — none of the
  `preset-default.md` rules, nothing from `taste/`, nothing from the user's
  preference profile.
- The orchestrator translated the skill's English terms into bookkeeping
  jargon inside its Chinese briefs (落点 ×6, 收束 ×4, 换挡 ×5, 咬合 ×23) and the
  words leaked into the article: the source had none of them; the final draft
  had 落点 ×2, 收束 ×1, 至此 ×2 and grew 「咬合」 in its title.
- Sequential writing inlines the whole finished draft into the next writer
  prompt, so tics compound: by unit 11 the prompt already carried five
  「不是……而是……」 constructions; the final draft had five (the preset's ceiling
  for a whole piece is one).

The register a writer is steeped in at the moment it starts is the strongest
signal it receives. A ban list is more of the same register. The primer swaps
what the writer has just read.

## How sampling works

`scripts/primer_sample.ts` (called by `run_leaf.ts`, never by the
orchestrator):

- **Author lottery, not file lottery.** Pick three distinct authors at random
  across every enabled library, then one piece per author. Libraries with
  many pieces by one author do not dominate.
- **Paragraph-aligned random window.** From each piece, take a contiguous run
  of whole paragraphs between 350 and 900 characters; the three windows total
  at most about 2 000 characters.
- **Deterministic per call.** The seed is `taskId + scope + repair count`, so
  the writer and the repairer of one unit read different passages, and a
  resumed or replayed call reads the same ones.
- **Two ways in.** A plain prompt gets the block appended by `run_leaf.ts`, framed by the Chinese lines in `frame.md`. A *composed* prompt (first line
  `<!-- wordtaste:composed v1 -->`, written by `scripts/compose_leaf_prompt.ts`)
  carries the same passages inside a `<reference_prose>` tag instead, framed by
  an English sentence; the Chinese framing lines are stripped there, because the
  English instruction around the tag already says the same thing and saying it
  twice, in two languages, would contradict itself. `run_leaf.ts` recognises the
  marker and does not append a second block. Both paths resolve libraries and
  seeds through `scripts/lib/sampling.ts`, so they can never drift apart.
- **Placement.** For a plain prompt the block goes at the *end* — after the
  brief and any inlined preceding prose, immediately before the writer starts
  generating — so the last thing it reads is not the draft's own habits.
  `WORDTASTE_PRIMER_POSITION=top` moves it to the front for A/B runs.
  `WORDTASTE_PRIMER=0` disables priming.
  **On the composed path that recency argument no longer holds, deliberately.**
  `<reference_prose>` sits in the middle of the prompt — after the material and
  the frozen sentences, before the user's voice and the constraints — and the
  essay so far is the last thing the writer reads, followed by one line telling
  it to continue directly from where that text stops. The two claims were
  weighed against each other on real prompts in August 2026 and the user
  decided: continuation momentum outweighs primer recency. A writer that opens
  by continuing beats one that opens with clean texture and a seam. Priming is
  still what the writer was steeped in before it read the draft, which is the
  work this block was added to do; being read last is not.
- **Roles.** Writer and repair are primed. The checker is not: it needs a
  clinical eye, and literary prose could bias it against precise-but-plain
  sentences. The planner is not: it produces structure, not sentences.
- **User voice.** If the content set has `materials/voice/*.md`, one window
  from it is appended after the library passages with its own framing line
  (`frame.md` → *voice*). Priority stays as `anchor-spec.md` states: frozen
  meaning > readability > the user's own voice > primer passages.

The framing sentences live in `frame.md`. They are prose the writer reads, so
they obey the same rule as the passages: plain Chinese, nothing about content.

## The brief lint

`brief-lint.txt` lives here for the same reason the passages do: it is about
the register a writer is handed. It holds one term per line — the Chinese nouns
this skill's own English vocabulary turns into when an orchestrator translates
it. `run_leaf.ts` scans the `<!-- brief:start -->` … `<!-- brief:end -->` region
of a writer or repair prompt against that list and refuses a hit before
dispatch; material inlined outside the markers is never scanned, and a checker
prompt is never scanned at all, because a judge brief legitimately carries
rubric vocabulary. `WORDTASTE_BRIEF_LINT=0` disables it.

A composed prompt is scanned differently: its instructions are English written
by the script, and the only hand-written part is the sibling `brief.en.md`. That
file is checked for CJK characters and merely warned about, never refused —
quoting one Chinese term in an English brief is legitimate, and by the time the
prompt is composed a rewrite is no longer cheap.

## File format

One piece per `.md` file, frontmatter then the text with the author's
paragraph breaks preserved:

```
---
author: 胡适
title: 差不多先生传
year: 1924
license_tier: A
license_note: 作者 1962 年逝世，已进入公有领域
genre: 杂文/寓言
script: simplified
chars: 1003
caveat: 直角引号「」
source_urls:
  - https://zh.wikisource.org/wiki/差不多先生傳
verification: 维基文库 parse API 抓取，程序化去除页眉/版权页脚
---
你知道中国最有名的人是谁？

提起此人，人人皆晓，处处闻名。……
```

`chars` is the count of non-whitespace characters. `caveat` flags period
orthography (1920s 「底」 for 「的」, 「甚么」, corner quotes) so a curator can
decide whether a piece should stay. The sampler only needs `author` and the
body; every other field is provenance for humans.

## Selection rules for the bundled library

- Modern vernacular Chinese, simplified script. Traditional sources are
  converted with OpenCC and old glyph variants (靑 / 吿 / 硏 / 著) normalized;
  dated signature lines are removed; the author's paragraphing is kept.
- Public domain in mainland China (author died 50+ years ago). Pieces
  published before 1930 are public domain everywhere; a few 1930s–1960s pieces
  may still be protected in life+70 jurisdictions — `year` is in the index.
- Texture over fame: uneven sentence length, paragraphs that swell and shrink,
  concrete verbs, no parallel triplets, no aphoristic endings; a person
  talking, but precise. Argumentative prose should stay at least a third of
  the library, because the writer's job is knowledge essays.
- Whole pieces, 600–4 000 characters; the sampler cuts windows.
- Every text was fetched from its source URL and checked at three points
  (opening, middle, closing) against the fetched page; discrepancies between
  sources are recorded in `verification`. No passage was typed from memory.

## User libraries

A library is a directory with a `library.json` and any number of `.md` files
in the format above:

```
~/.pneuma/primers/<name>/
  library.json        { "name": "...", "displayName": "...", "description": "..." }
  *.md
```

Project sessions also look in `<project>/.pneuma/primers/<name>/`. Put
anything you have the right to read privately: your own past writing,
clippings, a favourite author. Libraries are read at dispatch time on this
machine only; they are never installed into a session directory, committed,
or published.

Which libraries a session uses is chosen at first launch, through the
`primerLibraries` init parameter: `all` (default) uses the bundled library plus
every library under `~/.pneuma/primers/` — and, for a project session, under
`<project>/.pneuma/primers/`; a comma-separated list of names restricts it to
those, resolved against the same two roots; `bundled` uses only this directory.
`WORDTASTE_PRIMER_LIBS=<dir>[:<dir>]` overrides the whole list for one dispatch.

Resolved init params persist to `<stateDir>/config.json`, and `stateDir` depends
on the session shape (`core/path-resolver-pneuma.ts`, mirrored by the launcher's
`/api/launch`):

| Session | init params live at | note |
|---|---|---|
| quick | `$PNEUMA_SESSION_DIR/.pneuma/config.json` | the same file the viewer's `config` source reads |
| project | `$PNEUMA_SESSION_DIR/config.json` | here `$PNEUMA_SESSION_DIR/.pneuma/config.json` is a *different* file — the viewer surface only |

`run_leaf.ts` probes both and takes the first that actually carries a
`primerLibraries` value, so neither session shape needs special handling and a
`config.json` without that key — a session created before this parameter
existed, or the viewer-surface file — is skipped rather than read as `bundled`.

## Index

<!-- index:start -->
| File | Author | Title | Year | Genre | Chars | Caveat | Source |
|---|---|---|---|---|---|---|---|
| `A-fengzikai-jian.md` | 丰子恺 | 渐 | 1925 | 哲理散文 | 2070 |  | [1](https://www.sohu.com/a/430767705_120419076) [2](https://blog.sina.com.cn/s/blog_612b65240102xsle.html) [3](https://blog.sina.com.cn/s/blog_404907890102zk17.html) |
| `A-hushi-chabuduo-xiansheng.md` | 胡适 | 差不多先生传 | 1924 | 杂文/寓言 | 1003 | 直角引号「」 | [1](https://zh.wikisource.org/wiki/差不多先生傳) |
| `A-hushi-rongren-yu-ziyou-1959.md` | 胡适 | 容忍与自由 | 1959 | 议论文 | 3422 |  | [1](https://zh.wikisource.org/wiki/容忍與自由（1959年3月16日）) |
| `A-hushi-wode-muqin.md` | 胡适 | 我的母亲 | 1930 | 回忆散文（《四十自述》） | 3068 | 用「甚么」不用「什么」；直角引号「」 | [1](https://zh.wikisource.org/wiki/我的母親) |
| `A-laoshe-jinan-dongtian.md` | 老舍 | 济南的冬天 | 1931 | 写景散文 | 887 |  | [1](https://www.cngwzj.com/gushi/JinDai/86795/) [2](https://zh.wikibooks.org/wiki/初中语文/七年级上册/济南的冬天（老舍）) [3](https://www.cnprose.com/article-detail/W4zrOr3B) |
| `A-laoshe-xiang-beiping.md` | 老舍 | 想北平 | 1936 | 抒情散文 | 1660 |  | [1](https://www.sohu.com/a/314914401_488646) [2](https://baike.baidu.com/item/想北平/8387594) [3](http://www.millionbook.net/mj/l/laoshe/zw14/042.htm) |
| `A-laoshe-yinghaiji-xu.md` | 老舍 | 樱海集·序 | 1935 | 序文/随笔 | 1296 | 直角引号「」 | [1](https://zh.wikisource.org/wiki/櫻海集/序) |
| `A-liangqichao-xuewen-zhi-quwei.md` | 梁启超 | 学问之趣味 | 1922 | 演讲稿 | 2284 |  | [1](https://m.jiemian.com/article/2788609.html) [2](https://k.sina.cn/article_5502315099_147f6aa5b001001kuc.html) [3](https://www.sohu.com/a/294204286_693202) |
| `A-luxun-dengxia-manbi.md` | 鲁迅 | 灯下漫笔 | 1925 | 杂文（《坟》） | 3980 | 直角引号「」 | [1](https://zh.wikisource.org/wiki/燈下漫筆) |
| `A-luxun-qiuye.md` | 鲁迅 | 秋夜 | 1924 | 散文诗（《野草》） | 1068 |  | [1](https://zh.wikisource.org/wiki/秋夜_(魯迅)) |
| `A-luxun-tengye-xiansheng.md` | 鲁迅 | 藤野先生 | 1926 | 回忆散文（《朝花夕拾》） | 3208 |  | [1](https://zh.wikisource.org/wiki/藤野先生) |
| `A-luxun-zhaohuaxishi-xiaoyin.md` | 鲁迅 | 朝花夕拾·小引 | 1927 | 序文（《朝花夕拾》） | 690 | 直角引号「」 | [1](https://zh.wikisource.org/wiki/朝花夕拾/小引) |
| `A-xiamianzun-baimahu-zhi-dong.md` | 夏丏尊 | 白马湖之冬 | 1933 | 写景抒情散文 | 941 |  | [1](https://reader.book.qq.com/read/1034363161/12) [2](https://baike.baidu.com/item/白马湖之冬/11018013) |
| `A-xiaohong-hulanhezhuan-ch1.md` | 萧红 | 呼兰河传·第一章 | 1940 | 小说（第一章节选） | 2430 | 直角引号「」；第一章开头，截至第 28 段 | [1](https://zh.wikisource.org/wiki/呼蘭河傳/第一章) |
| `A-xudishan-luohuasheng.md` | 许地山 | 落花生 | 1922 | 叙事散文 | 575 | 二十年代白话，以「底」作「的」（16 处）；直角引号「」 | [1](https://zh.wikisource.org/wiki/落花生) |
| `A-yudafu-gudu-de-qiu.md` | 郁达夫 | 故都的秋 | 1934 | 写景抒情散文 | 1776 |  | [1](https://baike.baidu.com/item/故都的秋/6682640) [2](http://www.exam58.com/wenzhang/28293.html) [3](https://blog.sina.com.cn/s/blog_751f57fb0102v5q1.html) |
| `A-zhouzuoren-hecha.md` | 周作人 | 喝茶 | 1924 | 闲适小品 | 1575 |  | [1](https://www.vrrw.net/wx/9074.html) [2](https://www.aisixiang.com/data/84537.html) |
| `A-zhouzuoren-wupengchuan.md` | 周作人 | 乌篷船 | 1926 | 书信体散文 | 1299 |  | [1](https://www.kekeshici.com/sanwen/xueshengshiwen/68681.html) [2](https://baike.baidu.com/item/乌篷船/12005312) [3](https://www.1314179.com/74190.html) |
| `A-zhukezhen-daziran-de-yuyan.md` | 竺可桢 | 大自然的语言 | 1963 | 科普说明文 | 1672 |  | [1](https://zhidao.baidu.com/question/42176968.html) [2](https://baike.baidu.com/item/大自然的语言/1077) |
| `A-zhuziqing-beiying.md` | 朱自清 | 背影 | 1925 | 记人散文 | 1323 | 用「甚么」不用「什么」；直角引号「」 | [1](https://zh.wikisource.org/wiki/背影) |
| `A-zhuziqing-congcong.md` | 朱自清 | 匆匆 | 1922 | 抒情散文 | 616 | 用「甚么」不用「什么」 | [1](https://zh.wikisource.org/wiki/匆匆) |
| `A-zhuziqing-hetang-yuese.md` | 朱自清 | 荷塘月色 | 1927 | 写景散文 | 1340 | 直角引号「」 | [1](https://zh.wikisource.org/wiki/荷塘月色) |
<!-- index:end -->
