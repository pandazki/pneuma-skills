# Writing the prompt

Stage 6, per shot, and the most important page in this skill. The greybox is
accepted, the bible exists — and now one block of text decides whether the
paid take is the film you designed or a different one.

**The prompt is not composed here. It is the design, carried forward.** Every
beat's picture was written at the shot-plan stage into its `detail`
(`shot-plan.md`), before any Blender file existed, and the greybox was built
from it. `prompt-skeleton` turns the same beats into the pack; you add only
what they cannot carry. Arriving at this stage with an empty `prompts.md` and
inventing the shot again is how a take stops matching the film the creator
approved.

```bash
node {SKILL_PATH}/scripts/previz.mjs prompt-skeleton <shot-dir> --write
```

Three things meet in the block, and the split is what makes it work:

| what says it | where it comes from |
|---|---|
| space, blocking, prop events, timing, the one camera move | the greybox (`@Video1`), and nothing else |
| who these people are | the character sheets (`@Image…`) |
| how this film is drawn | the film's one style key frame (`@Image…`) |
| what this place is made of, bodies, faces, materials, light, tempo, **and the join with the shot before** | **the words** |

## First: is this shot blocked at all?

The pack's shape follows the shot's **conditioning** (`shot-plan.md`), and
`prompt-skeleton` emits the right one from the record — you never assemble
it by hand:

| | `greybox` | `hybrid` | `free` |
|---|---|---|---|
| replacement sentence | yes | yes | **no** |
| opening block | 【素材映射】 after it | same | **【一句话成片】 first** |
| `@Video1` line | yes | yes | **none — no video is attached** |
| 运镜总原则 | 一镜到底, one move, 严格照 @Video1 | the same **plus** 「在白模给定的位置与机位路径内，允许身体动作与镜头速度有动态变化。」 | the camera is words: 「镜头由文字决定——…」 and 「镜头随动作运动，允许加速与减速，最快处进入慢动作」 |
| timeline segments | 景别 + 构图 + detail + 按白模路线/站位 | the same | 景别 + 构图 + detail + **the body and camera verbs** (no 按白模…) |
| closing line | 重新生成自然的…，不迁移方块滑行 | the same | 重新生成自然的…，动作有真实的重量、惯性与速度变化 |
| 【全局锁】 | 不保留白模质感; 禁止 白模方块、坐标轴、视锥体… | the same | none of those — the model never saw a block |

A free shot is not a weaker pack; it is a pack whose whole job is the
action. Everything the greybox used to say — where they stand, how far
apart, when the blade lands — has to be **in the words**, at its second.

## One picture of the shot, and it is the greybox

**The reference order is fixed, and one function owns it** (`planReferences`
in `previz.mjs`):

`@Video1` the greybox → the character sheets in bible order → the film's style
key frame → `@Audio1…` the voice samples.

That is the whole list, and on a **free** shot the first line of it is gone:
the sheets start at `@Image1`. Never count the indices by hand —
`prompt-skeleton` writes the assignment lines at the indices `generate` will
actually attach.

**Every other picture is opt-in, and the reason is three acceptance rounds.**
Round 3 drew a storyboard frame per shot before the greybox existed: eight
pictures, eight invented rooms, no shared camera. The fix — rendering the key
frame *from* the greybox — removed the contradiction and kept the problem: a
still is still a composition, and a model given two of them averages them.
The set concept was the same argument in a wider lens. The practice this mode
reproduces never had any of them — in the upstream skill the greybox is the
only picture of layout, behaviour and camera, the look is text, and a key
frame appears only as a fallback for a model that cannot take a video at all:

> 仅支持图片时导出关键帧并明确这是弱约束，不能保证完整动作复刻。
> — `upstream/blender-video-workflows/skills/blender-video-original/references/video-generation.md`

Round 3's own takes found the last one: **the hand-off frame is a composition
too**. Eight 720p takes on that night, and every shot that carried the
previous shot's out-frame came back with the previous shot's *camera*: `s02`
kept `s01`'s high viewpoint instead of its designed low angle, `s04` and `s05`
kept `s03`'s over-the-shoulder framing instead of the side two-shot and the
profile close-up. The two shots generated without one (`s01`, and an earlier
isolated `s02`) followed their greybox. So the join travels as **words** now —
the 第一帧 / 最后一帧 lines, which were always in the pack — and the frame is
opt-in like the rest.

So a key frame, a legacy board, the set concept and the hand-off frame attach
**only** when the job is asked for them by name, and the pack has to be
scaffolded for the same job:

```bash
previz.mjs prompt-skeleton <shot-dir> --with-anchors --write
previz.mjs generate <shot-dir> --with-anchors
```

`--with-anchors` (this shot's key frames, leading the images) ·
`--with-board` (a legacy drawing) · `--with-concept` (the set concept) ·
`--with-handoff` (the previous shot's out-frame, last).
Reach for one when the words have already failed on a re-shoot, and say in
the report that the take carried it.

## A continuing shot carries the join in words

A shot with a `continuity` block still waits for the shot it continues —
`generate` cuts that take's last used frame into `takes/handoff-in.png`, and
`compare --handoff` is still how `take-handoff` is answered. What changed is
that the model is not shown it. `prompt-skeleton` writes the join instead:

- the 第一帧 line opens `承接上一镜（<from>）的结束状态：` (in English,
  `continuing from the end of the previous shot (<from>):`) followed by the
  `--entry` sentence — so the entry state has to be written as a **picture**:
  each body's position, facing, what is in their hands, the distance between
  them, as they read **on screen**;
- 【全局设定】 gains one sentence — 「机位与景别以本镜白模 @Video1 为准，不沿用
  上一镜的机位。」 — because a continuing shot is the one shot with a second
  camera available to copy;
- and there is no 素材映射 line for a frame nobody attached.

Write `--exit` on the earlier shot and paste it as the later shot's `--entry`
(`shot-plan.md`). Those two sentences are now the whole contract of the join.

## There is no word limit

fal's own Seedance guide documents none. The earlier version of this page
imposed "120–180 words", extrapolated from community text-to-video guides, and
the second acceptance run paid for it: the agent obeyed the cap, deleted the
designed beat `detail`s down to short clauses, and collapsed eight reference
roles into `@Image2 = storyboard intent`. The pack was structurally perfect and
starved.

**Never cap the timeline. Cap vagueness.** The pack carries the whole designed
beat plus everything the greybox cannot show, and what gets cut is adjectives,
repetition and mood words — never a designed picture. Position still matters:
adherence decays down the block, so the non-negotiables are first and the
prohibitions are last.

## Visible details, not adjectives

> 写看得见的细节：不是「很悲伤」，而是「鼻翼一紧、泪在下睑停住」。

That is the whole rule. "Sad", "tense", "atmospheric", "cinematic" and "epic"
are the words that produce the generic average of everything; a nose wing
tightening and a tear held on the lower lid are a picture the model can paint.
Bodies as verbs with physical consequences — *dust lifts on the landing*, *the
coat snaps round on the turn* — never *he moves dramatically*.

## The template

The order below is what `prompt-skeleton` emits, and the fenced `prompt` block
in `prompts.md` is expected to be in it. It is the creator's own Seedance
template, merged with what a **greybox** reference-to-video job needs on top.

````markdown
```prompt
以 @Video1 为空间、站位与机位的参考：几何占位体按下列对应关系就是这些人物，严格继承其摄影机运动、景别、
整体位置、空间关系与运动路径。几何体只表示位置和移动方向，不提供肢体参考。

【素材映射】
@Video1：只参考运镜、构图、切点、主体轨迹、相对比例与遮挡关系；
不要继承灰白材质、空场景、几何体外形与 Viewport 叠加物。
@Image1：白模中名为「…」的体块（颜色 / 第 1 帧位置）就是<角色>，
只参考这张的脸型、发型、服装与配饰，不用背景。
@Image2：（下一个角色，同样一行）
@Image3：全片画风参考，只参考画风、线条与上色方式，不参考构图与人物。
…（每一个附上的引用一行，都要「只参考…，不用…」）

【一句话成片】
《片名》· <本镜标题>：把白模渲染成<风格>的 N 秒、<画幅>成片——<这一镜一句话讲什么>。

【全局设定】
风格：<画面质感、镜头、颗粒、景深>。
场景：<地点>——<材质、颜色、尺度与陈设，来自 bible 里 set 的 look>。空间结构以 @Video1 为准。
光线：<光源方向、时间、色温>。
运镜总原则：一镜到底，只有一个运镜动作——<这一个运镜，和它停在哪>。
镜头轨迹、机位与景别严格照 @Video1，全片不切、不加转场。
机位与景别以本镜白模 @Video1 为准，不沿用上一镜的机位。（只有接戏镜头有这一句）

【时间戳分镜】（严格对齐白模秒数：共 N 秒）
第一帧：<接戏时：承接上一镜（sXX）的结束状态：><每个人的位置、朝向、手里的东西、彼此的距离>
a–b秒：景别，构图；<这一段设计好的画面>；按白模路线与时机；
       <材质与光影怎么长出来>；<肢体怎么自然化>。
b–c秒：……
最后一帧：<最后半秒停在什么状态>

声音：环境声 …；对白 …；音效 …。不要配乐——配乐在成片阶段统一铺。

重新生成自然的<这一镜真正发生的动作>，不迁移方块滑行或机械摆动。

【全局锁】
不新增不删除物体，不改镜头轨迹，不保留白模质感。
画面里只有 N 个人：…；<这一场专属的禁止项>。
禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、
突然跳切、人物变形、坐标轴、视锥体。
```
````

**The pack is written in the film's language.** `prompt-skeleton` scaffolds in
Chinese for a film whose `screenplay.md` is CJK and in English otherwise
(`【References】`, `【One-line brief】`, `【Global】`, `【Timeline】`,
`【Locks】`). Seedance is a ByteDance model and reads Chinese natively. The
reference tags stay `@Video1 / @Image1 / @Audio1` in both — that is what fal
documents and what `seedance-video.mjs` sends; do not write `@图片1`. Beat
`detail`s are written in the film's language at the shot-plan stage for exactly
this reason — they paste in whole. A `detail` that is in another language
(an older project) is translated **in full, in place**; translating by
shortening is the design deleted.

### Why each block is there

| block | it exists because |
|---|---|
| the replacement sentence | the job is not "make a video like this" but "these grey blocks *are* those people, and this camera is the camera". Said first, before the model has decided anything |
| 【素材映射】 | a reference nobody gave a job to is not ignored — it is averaged in, and it brings its own light, framing and palette. Each line needs a **positive scope and an explicit exclusion**: 只参考…，不用…. `generate` refuses a pack that leaves an attached reference unassigned |
| the `@Video1` exclusion | the greybox's grey material, empty set and viewport overlays are inherited unless they are explicitly disinherited. Unassigned, its flat studio light becomes the look of the take |
| 场景, in 【全局设定】 | the place is the one thing in this film that travels as **text**. Its structure is already in `@Video1`; its materials, colours and scale are the set's bible `look`, pre-filled here — a concept frame would only add a second camera |
| 【一句话成片】 | the model is told what it is making before it is told the seconds. Length and aspect belong here because they frame everything after |
| 【全局设定】 | style and light are global, not per second; and the **one** camera move is said here, once — with its end state, or `locked-off / 机位固定` in so many words when the camera does not move at all |
| 【时间戳分镜】 | above a few seconds the vendor's own advice is a timeline, and this mode's beats already are one, on the greybox's clock |
| 声音 | Seedance scores an open prompt by default, and the cut lays its own score: two pieces of music in one film is a re-shot |
| 重新生成自然的… | the sentence that tells the model to *re-animate* rather than transfer the block's rigid motion |
| 【全局锁】 | negatives go last, where they are still in the model's attention when it renders. This is also where the greybox itself is locked out |

## Words that make Seedance refuse

Seedance's front door classifies the request before it renders. The words
**替换 / 编辑 / 剪辑 / 剪入 / 修改这段视频** (and the English *replace / edit /
cut into*) can make it decide the job is *video editing* and return HTTP 422
("Seedance identified this request as video editing … set aspect_ratio and
duration to auto, or reword"). The eight-take run lost s07 to this. So the
opening sentence says **以 @Video1 为空间、站位与机位的参考** — the greybox is a
reference, never something the model is asked to edit — and the pack never
speaks of replacing, editing or cutting. If a 422 with that message still
comes back, reword first; only then retry once with `--duration auto`.

## The timeline, in detail

Six rules, each of which cost a take:

1. **One main event per segment.** 一段里又走路、又换景、又爆炸，模型会赶戏或漏戏。
2. **Contiguous, no gaps, no overlaps.** `0–4秒 / 4–9秒 / 9–15秒`. Every second
   of the clip is rendered whether or not the pack mentions it, so a gap is a
   second the model invents and an overlap is two instructions for one second.
3. **Density.** About one segment per 1–1.5 s for the short clips this mode
   works in — at most 4 in a 4 s shot, 5 in a 6 s shot, 6 in an 8 s — and never
   more than 7 for any clip (30 秒建议 5–7 段；再密，后半段容易崩身份或节奏).
   When the beats are denser than that, `prompt-skeleton` **merges adjacent
   beats into one segment and concatenates their details**: the merge moves
   boundaries, it never deletes a sentence.
4. **景别 + 构图 first, then the action — and in a one-take shot the 景别 is
   what the single move yields, never a free choice.** `景别 + 构图 + 主体动作 +
   关键细节`. A line with no shot size is a line the model frames however it
   likes — the v2 lines carried neither, and the takes reframed themselves.
   But a shot size that *changes* between segments is read as a **cut**: in
   the s03 A/B (2026-09-21) all five packs whose 2.0 s segment said 中景偏近
   after 中全景 cut to a close-up at exactly 2.0 s, and the one pack that held
   「同一环绕机位下的中全景（不切、不推近）」 in every segment came back as one
   camera passing round the fighters. So under 一镜到底, write the 景别 the
   move produces at that second (an orbit at constant radius keeps it; a push
   tightens it gradually — say so), and say 不切、不推近 where the model would
   be tempted. A 景别 jump belongs only to 按时间戳切镜. The camera *move* is
   not repeated per segment (it is in 运镜总原则); if a segment must mention
   it, one move only — 同一段不要互相打架.
5. **按白模路线 / 站位 / 轨迹.** Say, in the segment, that the path, the
   position and the timing are the greybox's. The blocks give the *where* and
   the *when*; the sentence keeps the model from re-choreographing them.
6. **The two clauses a greybox always needs**, per segment:
   - **材质与光影怎么长出来** — the grey has to become stone, cloth, skin and
     dusk light *at that second*, or the model keeps the grey. This is also
     where every grey object is named for what it **is**: "the box in front of
     him is a slim control pedestal", "the low slab is a stone dais".
   - **肢体如何自然化** — 真实奔跑与重心前倾，不是滑行. This is the clause
     that prevents block-sliding: the pawn has no legs, so unless the words
     ask for real steps and real weight, the model transfers the rigid slide.

A spoken line is quoted verbatim inside the segment that holds its second,
with its speaker; `take-lines` compares the transcript against exactly those
words. `第一帧` and `最后一帧` carry the shot's entry and exit states
(`shot-plan.md`) — on a continuing shot they **are** the hand-off, since the
frame itself is not sent, and they are what stops the model drifting past the
end of the move.

## What the script does for you, and what it warns about

`prompt-skeleton` writes the whole block above already filled with everything
the record knows: the assignment lines at the indices `generate` will actually
attach, the one-line brief with the shot's real seconds and aspect, the camera
beat's designed sentence, the contiguous timeline with every `detail` **whole**,
the spoken lines at their seconds, the entry and exit, the locks. It prints the
text in the JSON's `skeleton` field and `--write` puts it in
`prompts.skeleton.md` — deliberately not `prompts.md`, which is yours.

What is left for you is only what the beats cannot carry: the style phrase, the
light, the shot size and composition per segment, how the materials grow in,
how the body becomes a body, the named sounds, the shot's own prohibitions.

`generate` then **refuses** a pack that has no fenced `prompt` block, never
addresses `@Video1`, names an index nothing was attached at, or leaves an
attached reference without a job. Everything else it **warns** about and sends
— the mode owns what a take is conditioned on, not how a sentence is phrased.
Read the warnings; each one is a take that came back wrong once:

- a timeline line that runs past the shot, goes backwards, leaves a gap, or
  overlaps the line before it;
- a segment that names more than one camera move;
- **a beat whose designed `detail` no timeline line carries any more** — the
  starvation check. If the detail was wrong, fix it with `beats --set` so the
  viewer, the greybox and the take keep saying the same thing; do not quietly
  rewrite it in the prompt;
- a missing 【全局锁】/【Locks】 block, or an `@Video1` line that says what to
  take from the greybox but not what to leave;
- an unfilled `<TODO: …>` placeholder — the model is sent exactly this text.

## A worked example — the courtyard duel

`s02-landing` of the seed film: 6 s, 16:9, five references (the greybox, two
character sheets, the film's style frame and one voice), five designed beats
and one dolly zoom. It continues `s01-arrival`, so the join is in the 第一帧
line and in the camera sentence — not in a sixth reference. The courtyard
itself is in 【全局设定】 as a sentence. Nothing here is invented at this
stage; every timeline sentence is that beat's `detail`, carried whole.

````markdown
```prompt
以 @Video1 为空间、站位与机位的参考：几何占位体按下列对应关系就是这些人物，严格继承其摄影机运动、景别、整体位置、空间关系与运动路径。几何体只表示位置和移动方向，不提供肢体参考。

【素材映射】
@Video1：只参考运镜、构图、切点、主体轨迹、相对比例与遮挡关系；不要继承灰白材质、空场景、几何体外形与 Viewport 叠加物。
@Image1：白模中名为「keeper」的体块（乳白色，画右石台中央、面朝北）就是守剑人，只参考这张的脸型、发型、服装与配饰，不用背景。
@Image2：白模中名为「challenger」的体块（青灰色，第 1 帧在画左北面高台上）就是挑战者，只参考这张的脸型、发型、服装与配饰，不用背景。
@Image3：全片画风参考，只参考画风、线条与上色方式，不参考构图与人物。
@Audio1：只参考守剑人的音色与语速，不用其中的内容与环境声。

【一句话成片】
《一寸止风》· 跃下入局：把白模渲染成写实东方武侠、厚涂三维动画质感的 6 秒、16:9 成片——挑战者从北面高台一跃而下，落地卸力站稳，与守剑人隔三米对峙。

【全局设定】
风格：写实东方武侠，厚涂三维动画电影质感，细腻胶片颗粒，浅景深；不是照片。
场景：山中古寺庭院——十二米见方的青石露台，北侧断裂的石柱列，东角一座钟楼与一棵斜出的老树，朱红旗幡，散落的石块。空间结构以 @Video1 为准。
光线：暮色，西侧低角度暖光侧逆，长影铺在青石上，空气里有浮尘。
运镜总原则：一镜到底，只有一个运镜动作——落地之后一次 dolly zoom，人在画面里的大小保持不变，背景被压近，最后停住不动。
镜头轨迹、机位与景别严格照 @Video1，全片不切、不加转场。
机位与景别以本镜白模 @Video1 为准，不沿用上一镜的机位。

【时间戳分镜】（严格对齐白模秒数：共 6 秒；整条都进成片）
第一帧：承接上一镜（s01-arrival）的结束状态：挑战者在画左北面平台（0,8.4,1.2），面朝南，双膝压低，右手剑收在胯后；守剑人在画右（0,0,0.15），面朝北，右手剑下垂；两人未接触。
0.0–1.25秒：中全景，石阶自画左上斜切下来；挑战者猛地蹬开压紧的双膝，向南跃出平台，目光锁死前方，马尾与红绦被风拉直在身后；按白模路线与时机；青石与衣料在暖侧光里显出真实质感，跃起时衣摆背光透出薄红；真实的蹬地、腾空与身体前倾，不是方块平移。
1.25–1.5秒：中景，人压在画面下三分之一；常速下他的鞋底在第 1.25 秒踏上北侧石台，双膝深压吃住冲力，接触之后才扬起一团紧实的尘，牙关咬住；按白模时机；尘在逆光里发亮，石面被踩出细碎的灰；落地是真实的屈膝卸力，不是硬着陆停格。
1.5–2.5秒：中景，人居画面中线偏左；他从落地的深蹲里从容起身，压下剑锋，双脚站定；外袍先冲过头再回落，目光始终没有移开；按白模路线与时机；衣料的重量在回落里看得见，暖光扫过肩线；起身是一节一节的真实发力，不是整体上移。
2.5–5.5秒：中近景，人始终占同样大小，背景被压近；保持他挺直的上身与专注的神情不动，背后的庭院在透视里压过来；浮尘落定，红绦失去惯性；按白模站位；暮色继续沉，石面与旗幡的颜色被压到更深的暖褐；身体只有呼吸的起伏与衣料的余动，不是完全凝固的塑像。
5.5–6.0秒：中近景，两人三米相隔，守剑人在画右边缘；保持站定的姿态，剑尖朝下，呼吸受控，不多走一步、不起攻势；按白模站位；最后半秒光线与尘都稳住；重心沉在双脚之间，肩线放松而不松垮。
最后一帧：挑战者在（0,3,0.15）面朝南，落地后站直，右手剑下垂，双脚踏实；守剑人在（0,0,0.15）面朝北，剑下垂；相隔三米，尘已落定，两人未接触。

声音：环境声 山风、远处旗幡的布声；对白 无；音效 鞋底擦石、落地闷响、衣料摆动。不要配乐——配乐在成片阶段统一铺。

重新生成自然的起跳、腾空、落地卸力与站定，不迁移方块滑行或机械摆动。

【全局锁】
不新增不删除物体，不改镜头轨迹，不保留白模质感。
画面里只有 2 个人：守剑人、挑战者；每人只有一把直剑，不出现第二件兵器、弓箭、动物或路人。
禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切、人物变形、坐标轴、视锥体。
```
````

Five segments for six seconds — the density rule — each one main event, the
clock covered end to end with no gap, every `detail` whole, one camera move
named once, and the prohibitions last.

## A worked FREE example — the same duel, shot for the exchange

`s03-exchange`, 6 s, 16:9, **conditioning `free`**: two sheets and the style
frame, no `@Video1`, no greybox required. This is the control shot that came
back with the project's first 亮点. Read it against the pack above: the
blocks are gone, and everything they carried is now a sentence at its second
— who is where, how far apart, when the blades meet, and what the camera
does while it happens.

````markdown
```prompt
【一句话成片】
《一寸止风》· 交手：水面对刺：武侠漫剧（干净线条、赛璐璐上色、可读剪影）的 6 秒、16:9 成片——挑战者踏水前刺，守剑人旋身格开，剑尖在离咽喉一寸处停住。

【素材映射】
@Image1：这是挑战者，只参考这张的脸型、发型、服装与配饰，不用它的姿势、构图与背景。
@Image2：这是守剑人，只参考这张的脸型、发型、服装与配饰，不用它的姿势、构图与背景。
@Image3：全片画风参考，只参考画风、线条与上色方式，不参考构图与人物。

【全局设定】
风格：武侠漫剧，干净线条、赛璐璐上色、可读剪影，浅景深，不是照片。
场景：山中古寺庭院——青石露台上浅浅一层积水，断裂的石柱列，朱红旗幡，暮色。
光线：西侧低角度暖光侧逆，水面反光，空气里有浮尘。
运镜总原则：镜头由文字决定——贴着水面的低机位跟拍，随前刺加速逼近两人之间，在剑刃相交处甩过去，最后慢下来停在剑尖与咽喉之间。
镜头随动作运动，允许加速与减速，最快处进入慢动作；全片一镜到底，不切、不加转场。

【时间戳分镜】（共 6 秒，严格按这些秒数演出；整条都进成片）
第一帧：挑战者在画左，面朝画右，直剑收在右胯后，重心压在后脚；守剑人在画右三米外，面朝画左，剑尖下垂；两人之间是一层浅水。
0.0–1.6秒：中全景，两人分踞画面左右；挑战者蹬水前刺，鞋底踢起两道水线，剑尖直取咽喉，剑身上有一道细长的光；镜头随他的前冲加速逼近；水花在逆光里发亮，衣摆被风拉直；真实的蹬地、送胯与前压，不是平移。
1.6–3.2秒：中景，两人进入同一景框；守剑人半步侧身、旋身格开，长发与红绦在空中划出弧线，裙摆带起一圈水雾；镜头绕到两人之间；暖光扫过刀脊与湿透的衣料；旋身是从脚跟拧起来的整劲，不是上半身摆动。
3.2–4.4秒：中近景，两剑占画面中心；两剑在水花里交错相击，火星与水珠同时炸开，两人重心都压向前；镜头在这一击上甩过去又收住；金属反光与水珠一起亮起来；接触的一瞬两人的手腕都被震得一沉。
4.4–6.0秒：近景，剑尖与咽喉在同一画面；剑尖在离咽喉一寸处停住，进入慢动作，水珠悬在空中，两人对视不动；镜头慢下来停住；暮色压在两张脸上，呼吸看得见；身体只剩呼吸的起伏与衣料的余动。
最后一帧：剑尖停在守剑人咽喉前一寸，两人对视，水珠悬在空中未落。

声音：环境声 山风、水面轻响；对白 无；音效 踏水、衣袂、金属相击。不要配乐——配乐在成片阶段统一铺。

重新生成自然的踏水前刺、旋身格开、剑刃相击与急停，动作有真实的重量、惯性与速度变化。

【全局锁】
不增加画面里没有说到的人物与道具，不删除说到的。
画面里只有 2 个人：挑战者、守剑人；每人只有一把直剑，不出现第二件兵器、动物或路人。
禁止：刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切、人物变形。
```
````

Four segments for six seconds, one main event each, the clock covered end to
end — the density rule does not change. What changes is what the segments
owe: **the geography** (画左/画右, 三米, 同一景框), because no block carries
it now, and **the tempo** (加速逼近, 甩过去, 慢下来), because the camera is
allowed to have one.

## A second genre — the creator's own rooftop example

The same template on a modern action shot, 18 s, crude blocks and three
pursuers. It is worth reading because it shows how little the shape changes
between genres, and how blunt the body clauses are allowed to be:

```text
以 @Video1 为空间、站位与机位的参考：几何占位体按下列对应关系就是这些人物，严格继承其摄影机运动、景别、整体位置、空间关系与抛物线路径。几何体只表示位置和移动方向，不提供肢体参考。

【映射】
浅青长方体 = 女主，外观严格参考 @Image1（脸、发型、红夹克、靴）。
三个深灰长方体 = 三名男性特工，外观参考 @Image2。
场景结构参考白模空间，视觉质感参考 @Image3 的夜东京天台。

生成 18 秒、16:9 电影级都市奇幻动作：女主踹门冲上高楼露台，被三名特工逼到楼沿后纵身跃下。

0–4秒：女主按白模路线踹开天台门，真实奔跑与重心前倾，不是滑行。
4–9秒：三名特工按白模站位追入，女主急停、探身张望，衣摆与头发有惯性。
9–13秒：她按白模起跳轨迹跃出楼沿，镜头沿白模下坠路径跟随。
13–18秒：下坠中振翅展开（按白模体块放大方向），特工停在楼沿。

重新生成自然的奔跑、急停、起跳、振翅，不迁移方块滑行或机械摆动。
禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、枪械、字幕、BGM。
```

Four segments for 18 s — coarser than ours, because the events are coarser —
each naming the greybox as the authority for its own layer (路线 / 站位 /
轨迹 / 下坠路径) and then asking for the body to be re-animated.

## Cautions the trials paid for

- **Every picture added beside the greybox fought it, and the greybox lost.**
  Three acceptance rounds, 2026-09-21. Round 3 drew a storyboard frame per
  shot from the plan and the bible before anything was blocked: eight
  pictures, eight invented rooms, no two of them the same space, and the one
  greybox that had to serve them all disagreed with every board. Rendering
  the key frame *from* the greybox removed the contradiction and left the
  problem — a still carries a composition, and the take kept resolving the
  two against each other. The set concept was the same argument at a wider
  lens. **The greybox is the only picture of layout, behaviour and camera a
  take receives**; a sheet is a face, the style frame is an idiom, and each
  is told so in its own line. When you do send a key frame
  (`--with-anchors`), you are choosing to spend a composition on it; say so
  when you report the take.
- **The hand-off frame carried the previous shot's camera into three shots —
  continuity is words, the frame is opt-in.** Eight 720p takes on the night of
  2026-09-21, with the reference set already down to the greybox, the sheets,
  the style frame and that one frame. Every shot that carried it inherited
  the camera of the shot it continued: `s02` came back from `s01`'s
  high viewpoint although its greybox is a low angle; `s04` and `s05` came
  back in `s03`'s over-the-shoulder framing although their greyboxes are a
  side two-shot and a profile close-up. `s01`, which continues nothing, and an
  earlier isolated `s02` both obeyed their block. It is the same arithmetic as
  the board and the key frame: **the frame is a composition, and it is the one
  composition that is a *plausible* answer** — it is genuinely this action,
  one moment earlier, so the model has no reason to distrust it. The entry and
  exit sentences were already carrying the join; now they carry it alone, the
  camera line says 不沿用上一镜的机位, and `--with-handoff` is there for the
  join a re-shoot could not land in words. `compare --handoff` is unchanged:
  the frame is still cut and `take-handoff` is still answered from it.
- **A word budget copied from text-to-video guides made the agent delete the
  design.** Second acceptance run, 2026-09-21: the packs were structurally
  right and starved, because this page told the agent to fit 120–180 words.
  **Never cap the timeline; cap only vagueness.** If a pack feels too long,
  the thing to remove is an adjective, never a designed beat — and if it is
  genuinely too much to happen in one clip, the shot is two shots.
- **Two pawns are two costumes waiting to be swapped.** Name which block is
  which character, by colour and by frame-1 position, in the mapping line, and
  repeat the identity when you describe an action ("青灰色的挑战者上步"). Without
  it the model reassigns them, sometimes mid-shot.
- **The camera cuts when you contradict it.** Both packs of the first
  acceptance run described more than one camera behaviour ("orbits … and pushes
  in") and the model resolved it the way an editor would — by cutting. One
  primary move, its end state, and `一镜到底 / one continuous shot, no cut`
  next to the camera sentence, not at the bottom.
- **A dark look hides the cause.** In a night interior the model will render
  the reach and the door in shadow, and then nobody can see that cause came
  before effect. Say the action stays readable *before* the light event.
- **A light that "comes on" snaps.** Give the ramp in words and seconds ("the
  glow rises slowly over two seconds"), and say what the object looks like
  before it.
- **Tempo is named per segment**, never as a bare "fast": *"the lunge in a
  blur, then the blades meet in slow motion, dust hanging"*. Tempo is built in
  the greybox (`slowmo`, `impact` — `camera.md`) and described here.
- **Fast action: the greybox owns the timing, the prompt owns the technique.**
  `dash` fixes when the leap leaves the ground and lands; the prompt says what
  kind of movement it is, with its second — the sword form, the stance, which
  hand, whether the blade is drawn.
- **The likeness filter reads photoreal faces as real people.** A 422 from fal
  is almost always a reference image, not the prompt: keep the sheets and the
  style frame in an illustrated or 3D-animation idiom (`bible.md`) and
  regenerate the offending one rather than resubmitting the same pack.
- **A blocked shot buys consistency with the performance, and that is a
  price you choose per shot.** Eight blocked 720p takes (2026-09-21 night)
  held the space and the look across a whole film and had no 亮点: a pawn's
  body moves in proportion to its displacement, so a locked camera over a
  short path is a stiff actor. The same exchange shot free had one. Spend
  the block where the geography or the camera is the hard thing, and shoot
  the performance free — the decision lives in the shot plan, per shot, and
  `prompt-skeleton` writes whichever pack it says.
- **More references is not more control — it is less.** Every attached still
  is averaged in, and the ones that carry a composition are averaged against
  `@Video1`. Four references with exclusive roles beat eight with careful
  ones. `generate` attaches what the default says plus what you asked for by
  name: the way to send fewer is to ask for none.
