/**
 * The scaffolding sentences of every prompt `prompts.mjs` assembles, per
 * language. Pure data: no `node:*` imports, no logic beyond the table.
 *
 * Why this is data, not code: the method's prompts are model-facing text in
 * the language the series is written in. A Chinese bible sent through English
 * scaffolding mixes two languages in one prompt and drifts from the wording
 * the method was tested with; the repository keeps source identifiers and
 * comments in English, so the non-English sentences live here, as values.
 *
 * `zh` reuses the wording of ai-anime-series `scripts/make_prompts.py`
 * (MIT, (c) 2026 硅基废话 / 10291124jcjc-dotcom; the licence text is in
 * LICENSE-ai-anime-series.txt beside this file)
 * wherever this mode sends the same instruction — the storyboard header, the
 * panel header, the video opener, the character and group lines, style, the
 * continuity label, the shot and sound lines, the closing "no text" line, the
 * sheet, storyboard and video Jimeng canvas lines, the grid names and the
 * default expressions and poses. The sentences the upstream method does not
 * have (the faceless silhouette, the leader panel, style-only scene
 * references, the setting in the reference list, markings, the
 * black-and-white restatement, the scene's rules, the board as the redrawn
 * panel's style reference, the redrawn panel's canvas line, the default
 * continuity lines) are this mode's own; the Chinese lineup sentence is the
 * one the seed series' lineup probe used.
 *
 * `constraintWords` mark the clauses of a scene's look that are constraints
 * ("the clock face has no numbers"); boards and panels, which do not carry
 * the whole look, carry those clauses.
 *
 * `defaultContinuity` is the two continuity lines `add-episode` writes into
 * a new episode: each shot picks up the previous one's motion, and running
 * keeps one direction. They state a rule of the upstream method in this
 * mode's own words (the upstream template's lines are CC BY-NC text and are
 * not reused; see NOTICE.md).
 *
 * The Jimeng storyboard line gives the series ratio only, where upstream
 * offered "1:1 also fine": the shot strip shows each equal-division cell
 * cropped to the series' frame, and a redrawn panel is drawn at
 * `panelAspect(series ratio)` and scaled to cover its cell, so on a board of
 * another ratio both crop the panels.
 *
 * Placeholders are `{name}`; `prompts.mjs` fills them. Each template's
 * leading or trailing space is part of the template (English joins sentences
 * with a space, Chinese with nothing).
 */

const en = Object.freeze({
  listSep: ", ",
  nodeSep: ", ",
  expressionSep: ", ",
  poseSep: "; ",
  clauseSep: "; ",
  sentenceJoin: " ",
  copyLine: "———— copy everything below this line ————",
  timeFallback: "time of day",

  expressions: Object.freeze(["happy", "startled", "angry", "sulking", "smug", "resigned"]),
  poses: Object.freeze(["standing", "running", "carrying something", "jumping"]),
  groupPoses: Object.freeze(["standing", "on the move", "acting together", "smug", "startled"]),

  characterSheet: "Character design sheet for one character: a full-body turnaround (front, side, back), {expressionCount} different expressions ({expressions}), {poseCount} poses ({poses}) and a solid silhouette with no face. Clean layout; no explanatory text other than the name and a short caption per panel; the name \"{name}\" written in the top-left corner.",
  characterLook: "Character: {look}",
  groupSheet: "Group character design sheet: {name}, {look} Draw {poseCount} members in different poses ({poses}), one consistent design.{leader} Clean layout; no explanatory text other than the name and a short caption per panel; the name \"{name}\" written in the top-left corner.",
  groupSheetLeader: " Then draw a separate large front view of the leader: {leader}",
  sceneSheet: "Scene design sheet with no characters in it: {name}, {look} Wide establishing view{time}.",
  sceneSheetTime: ", {time}",
  sceneNoText: "No text anywhere in the image.",
  sceneStyleRefs: "The reference images are only for matching the art style, materials and roundness: build the furniture and props of this set in that same style. Do not draw any character from the reference images.",

  groupWithLeader: "{look} Leader: {leader}",
  whoList: " Character reference: {list}.",
  whoEntity: "image {n} is {name}",
  whoScene: "image {n} is the setting, {name}",
  textOnly: "{name}: {look}",

  board: "Draw a {ratio} storyboard of {count} panels ({rows} rows × {cols} columns) as rough animation sketches. Requirements: black-and-white pencil sketch, clean and uncluttered, no detailed backgrounds, no extra panels, no text except the shot number in the top-left corner of each panel.{who}",
  boardPlace: "All {count} panels take place in the same {scene}, during the same {time}.",
  panel: "Draw one animation storyboard panel with the proportions of a single panel of a {count}-panel grid ({rows} rows × {cols} columns). Requirements: black-and-white pencil sketch, clean, no text except the number {shot} in the top-left corner.{who}",
  panelPlace: "The panel takes place in the same {scene}, during the same {time}.",
  boardShot: "Shot {n}: {text}",
  boardClosing: "Again: black-and-white pencil sketch, no colour anywhere. The reference images are for character shapes only — draw those characters as pencil sketches too.",
  sceneRules: "Set rules: {rules}",
  constraintWords: Object.freeze(["no", "not", "never", "without"]),
  panelBoardRef: "Image 1 is the current storyboard: draw this panel in exactly its style — the same pencil line and weight, the same framing scale, the shot number marked exactly as the other panels mark theirs. Draw only this one panel, not the grid.",

  videoOpen: "Make an animated video from the storyboard {board}. Use the storyboard only for its shot design, action timing, framing and camera moves; never paste or splice the storyboard image itself into the video.{note}",
  videoPatchNote: " This run covers only storyboard panels {a}–{b}; it opens and ends on a hard cut.",
  videoCharacter: "{token} is {name}; their appearance must match the reference image exactly: {look}",
  videoGroup: "{token} is the design sheet of {name}: {look}",
  videoStyle: "Style: {style}",
  noDialogue: "No dialogue.",
  videoPlace: "The whole film stays in the same {scene}, during the same {time}: {look}",
  videoSceneRef: "Scene reference: {token}.",
  continuity: "Continuity: {lines}.",
  videoShot: "Shot {n} | {start}-{end}s: {desc}",
  videoSound: "Sound: {sfx}",
  noText: "No text, subtitles, captions or logos anywhere in the frame.",
  noTextExcept: "Apart from {markings}, no other text, subtitles, captions or logos anywhere in the frame.",

  jimengSheetHead: "[Jimeng canvas | Image generation{refs} | ratio {ratio} | make 4, keep the best 1 | register it: series.mjs make-sheets --{kind} {id} --upload <file>]",
  jimengSheetRefs: " | select the picked character sheet nodes (style reference only)",
  jimengBoardHead: "[Jimeng canvas | Image generation | select nodes: {nodes} | ratio {ratio} | make 4, keep the best 1 | {saveAs}register it: series.mjs shoot-board --episode {episode} --part {part} --upload <file>]",
  jimengBoardNode: "{name} sheet",
  jimengNoNodes: "none",
  jimengSaveAs: "save it as {file}, ",
  jimengVideoHead: "[Jimeng canvas | Video generation | Seedance 2.5 omni-reference | select these nodes in this order: {order} | {ratio} | {seconds} s | 480p first, upscale once it is right | {label}]",
  jimengVideoNode: "{token} {name} sheet",
  jimengVideoBoard: "{token} storyboard",
  labelWhole: "whole episode",
  labelPart: "part {part} of {parts}",
  labelPatch: "re-shoot part {part} shots {a}–{b}",
  jimengPanelHead: "[Jimeng canvas | Image generation | select these nodes in this order: {order} | ratio {ratio} | make 4, keep the best 1 | register it: series.mjs redo-panel --episode {episode} --part {part} --shot {shot} --upload <file> (it becomes a new storyboard), then drag the new storyboard onto the canvas and select it for the clip]",
  jimengPanelBoard: "{token} storyboard ({file})",

  lineup: "Character lineup: {refs}. Draw these {count} characters side by side on a plain white background, facing the camera, full body, at one common scale — each at the size its description below gives. Their appearance must match the reference images exactly. No design-sheet layout and no text: only this one lineup.",
  lineupRef: "reference image {n} is {name}",

  gridNames: Object.freeze({}),
  gridFallback: "{count} panels",

  defaultContinuity: Object.freeze([
    "every shot picks up the motion where the previous shot left it",
    "every run crosses the frame the same way, left to right",
  ]),
});

const zh = Object.freeze({
  listSep: "，",
  nodeSep: "、",
  expressionSep: "、",
  poseSep: "；",
  clauseSep: "；",
  sentenceJoin: "",
  copyLine: "———————— 以下整段复制 ————————",
  timeFallback: "时间",

  expressions: Object.freeze(["开心", "惊吓", "生气", "委屈", "得意", "无奈"]),
  poses: Object.freeze(["站着", "奔跑", "抱东西", "跳起来"]),
  groupPoses: Object.freeze(["站着", "移动中", "一起行动", "得意", "惊吓"]),

  characterSheet: "角色设定图，同一个角色的全身三视图（正面、侧面、背面）、{expressionCount} 个不同表情（{expressions}）、{poseCount} 个动作姿势（{poses}）和一个不画五官的实心剪影，排版干净，除了名字和每格一句简短说明之外不要写任何解释文字，左上角写角色名「{name}」。",
  characterLook: "角色：{look}",
  groupSheet: "群体角色设定图：{name}，{look}画出 {poseCount} 个不同姿势的成员（{poses}），外形统一。{leader}排版干净，除了名字和每格一句简短说明之外不要写任何解释文字，左上角写名字「{name}」。",
  groupSheetLeader: "再单独画一个大的头目正面：{leader}",
  sceneSheet: "场景设定图，没有任何角色：{name}，{look}广角全景{time}。",
  sceneSheetTime: "，{time}",
  sceneNoText: "画面中没有文字。",
  sceneStyleRefs: "参考图只用来对齐画风、材质和圆润程度：用同样的画风搭出这个场景的家具和道具，不要画参考图里的任何角色。",

  groupWithLeader: "{look}头目：{leader}",
  whoList: "角色外形参考：{list}。",
  whoEntity: "图 {n} 是{name}",
  whoScene: "图 {n} 是场景{name}",
  textOnly: "{name}：{look}",

  board: "生成 {ratio} {gridName}（{rows} 行 {cols} 列）动画分镜素描草图。要求：黑白铅笔素描、画面干净不杂乱、不要复杂背景、无多余画面、无文字，每格左上角标镜头序号。{who}",
  boardPlace: "全部 {count} 格在同一个{scene}，同一个{time}。",
  panel: "生成一格动画分镜素描草图，比例和{gridName}（{rows} 行 {cols} 列）里的一格相同。要求：黑白铅笔素描、画面干净、无文字，左上角标序号 {shot}。{who}",
  panelPlace: "这一格在同一个{scene}，同一个{time}。",
  boardShot: "镜头 {n}：{text}",
  boardClosing: "再强调一次：全部画成黑白铅笔素描，不要上任何颜色。参考图只用来看角色的外形，画进分镜里也一样是铅笔素描。",
  sceneRules: "场景要求：{rules}",
  constraintWords: Object.freeze(["没有", "不要", "禁止", "不能"]),
  panelBoardRef: "图 1 是现在的整张分镜：完全照它的画法画这一格——同样的铅笔线条和粗细、同样的景别大小，序号的标法和其他格一模一样。只画这一格，不要画整张宫格。",

  videoOpen: "根据故事板 {board} 生成分镜视频，仅参考其镜头设计、动作节奏、景别和运镜，禁止直接拼接故事板图片。{note}",
  videoPatchNote: "这次只生成故事板第 {a}–{b} 格，开头和结尾都是硬切。",
  videoCharacter: "{token} 是{name}，外形必须和参考图完全一致：{look}",
  videoGroup: "{token} 是{name}的设定图：{look}",
  videoStyle: "风格：{style}",
  noDialogue: "没有台词。",
  videoPlace: "全片在同一个{scene}、同一个{time}：{look}",
  videoSceneRef: "场景参考 {token}。",
  continuity: "连贯要求：{lines}。",
  videoShot: "镜头 {n}｜{start}-{end}s：{desc}",
  videoSound: "音效：{sfx}",
  noText: "画面里不要出现任何文字、字幕、商标。",
  noTextExcept: "除了{markings}，画面里不要出现任何其他文字、字幕、商标。",

  jimengSheetHead: "【即梦画布｜图片生成{refs}｜比例 {ratio}｜出 4 张挑 1 张｜登记：series.mjs make-sheets --{kind} {id} --upload <文件>】",
  jimengSheetRefs: "｜框选已选定的角色设定图节点（只作画风参考）",
  jimengBoardHead: "【即梦画布｜图片生成｜框选节点：{nodes}｜比例 {ratio}｜出 4 张挑 1 张，{saveAs}登记：series.mjs shoot-board --episode {episode} --part {part} --upload <文件>】",
  jimengBoardNode: "{name}设定图",
  jimengNoNodes: "无",
  jimengSaveAs: "下载存成 {file}，",
  jimengVideoHead: "【即梦画布｜视频生成｜Seedance 2.5 全能参考｜框选节点：{order}｜{ratio}｜{seconds} 秒｜先 480p，满意再超清｜{label}】",
  jimengVideoNode: "{token} {name}设定图",
  jimengVideoBoard: "{token} 故事板",
  labelWhole: "整集",
  labelPart: "第 {part} 段（共 {parts} 段）",
  labelPatch: "补拍第 {part} 段镜头 {a}–{b}",
  jimengPanelHead: "【即梦画布｜图片生成｜框选节点：{order}｜比例 {ratio}｜出 4 张挑 1 张｜登记：series.mjs redo-panel --episode {episode} --part {part} --shot {shot} --upload <文件>（会拼成一张新故事板），再把新故事板拖回画布，出视频时框选它】",
  jimengPanelBoard: "{token} 故事板（{file}）",

  lineup: "角色身高对比图：{refs}。{count} 个角色并排站在纯白背景上，正面朝向镜头，按同一比例画全身像，每个角色的大小以下面的描述为准。外形必须和参考图完全一致，不要画设定图排版，不要写字，只画这一组并排的全身像。",
  lineupRef: "参考图 {n} 是{name}",

  gridNames: Object.freeze({ 4: "四宫格", 6: "六宫格", 8: "八宫格", 9: "九宫格", 10: "十宫格", 12: "十二宫格" }),
  gridFallback: "{count} 格",

  defaultContinuity: Object.freeze([
    "每一镜都从上一镜停下的那个动作接着演",
    "所有跑动都从画面左侧跑向右侧，方向不变",
  ]),
});

/** Scaffolding per language; `prompts.mjs` picks one with `bibleLang`. */
export const PROMPT_LOCALES = Object.freeze({ en, zh });
export const PROMPT_LANGS = Object.freeze(Object.keys(PROMPT_LOCALES));
