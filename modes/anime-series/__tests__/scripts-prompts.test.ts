/**
 * prompts.mjs — deterministic prompt assembly from bible + episode.
 *
 * The golden strings pin the whole method at once (reference order, the
 * "reference only" opener, continuity, timed shots with sound, no text in
 * frame); the targeted cases below each pin one rule so a failure names it.
 */

import { describe, expect, test } from "bun:test";

import { PROMPT_LOCALES } from "../skill/scripts/prompt-locales.mjs";
import {
  COPY_LINE,
  JIMENG_MAX_REFS,
  PromptError,
  SEEDANCE_MAX_REFS,
  assemblePanel,
  assemblePart,
  assemblePatch,
  bibleLang,
  defaultContinuity,
  jimengSheet,
  noTextLine,
  refsFor,
  sheetPrompt,
} from "../skill/scripts/prompts.mjs";
import { fixtureBible, fixtureBibleZh, fixtureEpisode, fixtureEpisodeZh, fixtureSheetOf } from "./scripts-fixture";

const GOLDEN_STORYBOARD = `Draw a 16:9 storyboard of 9 panels (3 rows × 3 columns) as rough animation sketches. Requirements: black-and-white pencil sketch, clean and uncluttered, no detailed backgrounds, no extra panels, no text except the shot number in the top-left corner of each panel. Character reference: image 1 is Lamp, image 2 is Ox, image 3 is the setting, open-plan office.
All 9 panels take place in the same open-plan office, during the same late afternoon.
Sticky Notes: a swarm of yellow sticky notes that flap like birds. Leader: one red note three times the size, URGENT printed on it in bold black letters, angry brows.

Shot 1: wide: Lamp eyes the clock at 5:59, Ox already packed.
Shot 2: close-up: the sticky notes peel off the wall and turn toward them.
Shot 3: Lamp's arm stretched over desks toward the door.
Shot 4: the notes swarm and stick Lamp's arm to a desk.
Shot 5: tracking side shot: Ox charges with Lamp riding on its back.
Shot 6: Ox bursts through the note swarm.
Shot 7: they reach the door, it is locked.
Shot 8: the clock strikes six; the door unlocks; both fall through.
Shot 9: freeze: a blank sticky note lands on Ox's face, Lamp sighs.

Again: black-and-white pencil sketch, no colour anywhere. The reference images are for character shapes only — draw those characters as pencil sketches too.`;

const GOLDEN_VIDEO = `Make an animated video from the storyboard @Image4. Use the storyboard only for its shot design, action timing, framing and camera moves; never paste or splice the storyboard image itself into the video.

@Image1 is Lamp; their appearance must match the reference image exactly: a small desk lamp with a round brass shade, one bendy arm and a square base.
@Image2 is Ox; their appearance must match the reference image exactly: a stout cartoon ox in a loose blue tie, short horns, one horn chipped.
Sticky Notes: a swarm of yellow sticky notes that flap like birds. Leader: one red note three times the size, URGENT printed on it in bold black letters, angry brows.

Style: Rounded 3D animation, the office lit a warm yellow, broad slapstick timing. No dialogue. The whole film stays in the same open-plan office, during the same late afternoon: rows of desks, a coffee machine, a big window at dusk. Scene reference: @Image3.

Continuity: every shot picks up the motion where the previous one left it; every run crosses the frame left to right.

Shot 1 | 0-3s: wide: Lamp eyes the clock at 5:59, Ox already packed.
Sound: ticking, office hum

Shot 2 | 3-6s: close-up: the sticky notes peel off the wall and turn toward them.
Sound: paper rustle, ominous sting

Shot 3 | 6-9s: Lamp stretches its arm across three desks to reach the door.
Sound: a rubbery stretch

Shot 4 | 9-12s: the notes swarm and stick Lamp's arm to a desk.
Sound: flapping, splat

Shot 5 | 12-16s: tracking side shot: Ox charges with Lamp riding on its back.
Sound: hooves on carpet, drum roll

Shot 6 | 16-19s: Ox bursts through the note swarm.
Sound: paper explosion

Shot 7 | 19-22s: they reach the door, it is locked.
Sound: rattle, record scratch

Shot 8 | 22-26s: the clock strikes six; the door unlocks; both fall through.
Sound: bell, thud

Shot 9 | 26-30s: freeze: a blank sticky note lands on Ox's face, Lamp sighs.
Sound: a deflating whistle, a cymbal tap

Apart from the word URGENT on the red leader note, no other text, subtitles, captions or logos anywhere in the frame.`;

describe("assemblePart — golden output", () => {
  const assembled = assemblePart(fixtureBible(), fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "ep01-a-board-1" });

  test("storyboard prompt", () => {
    expect(assembled.storyboard.prompt).toBe(GOLDEN_STORYBOARD);
    expect(assembled.storyboard.refs).toEqual(["char-lamp-sheet-1", "char-ox-sheet-2", "scene-office-sheet-1"]);
  });

  test("Seedance video prompt", () => {
    expect(assembled.video.prompt).toBe(GOLDEN_VIDEO);
  });

  test("references: cast in episode order, then scene, storyboard last", () => {
    expect(assembled.refs).toEqual([
      { n: 1, kind: "character", id: "lamp", name: "Lamp", asset: "char-lamp-sheet-1" },
      { n: 2, kind: "character", id: "ox", name: "Ox", asset: "char-ox-sheet-2" },
      { n: 3, kind: "scene", id: "office", name: "open-plan office", asset: "scene-office-sheet-1" },
      { n: 4, kind: "storyboard", id: null, name: "storyboard", asset: "ep01-a-board-1" },
    ]);
    expect(assembled.textOnly).toEqual([{ kind: "group", id: "notes", name: "Sticky Notes" }]);
    expect(assembled.grid).toEqual({ rows: 3, cols: 3, tidy: true });
    expect(assembled.seconds).toBe(30);
  });

  test("the Jimeng variant: same body, @图N tokens, a canvas line and the copy line", () => {
    const [head, cut, blank, ...body] = assembled.jimeng.video.split("\n");
    expect(head).toBe("[Jimeng canvas | Video generation | Seedance 2.5 omni-reference | select these nodes in this order: @图1 Lamp sheet, @图2 Ox sheet, @图3 open-plan office sheet, @图4 storyboard | 16:9 | 30 s | 480p first, upscale once it is right | whole episode]");
    expect(cut).toBe(COPY_LINE);
    expect(blank).toBe("");
    expect(body.join("\n")).toBe(GOLDEN_VIDEO.replaceAll(/@Image(\d)/g, "@图$1"));
    expect(assembled.jimeng.storyboard.split("\n").slice(3).join("\n")).toBe(GOLDEN_STORYBOARD);
  });

  test("assembly is deterministic", () => {
    const again = assemblePart(fixtureBible(), fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "ep01-a-board-1" });
    expect(again).toEqual(assembled);
  });
});

describe("references", () => {
  test("a group with a sheet takes a slot between the cast and the scene", () => {
    const sheets = (kind: string, id: string) => (kind === "group" ? "group-notes-sheet-1" : fixtureSheetOf(kind, id));
    const { refs, textOnly } = refsFor(fixtureBible(), fixtureEpisode(), { sheetOf: sheets, board: "b" });
    expect(refs.map((r) => `${r.n}:${r.kind}`)).toEqual(["1:character", "2:character", "3:group", "4:scene", "5:storyboard"]);
    expect(textOnly).toEqual([]);
    const video = assemblePart(fixtureBible(), fixtureEpisode(), "A", { sheetOf: sheets, board: "b" }).video.prompt;
    expect(video).toContain("@Image3 is the design sheet of Sticky Notes: a swarm of yellow sticky notes that flap like birds.");
    expect(video).toContain("Scene reference: @Image4.");
    expect(video.startsWith("Make an animated video from the storyboard @Image5.")).toBe(true);
  });

  test("cast order follows the episode, not the bible", () => {
    const episode = { ...fixtureEpisode(), cast: ["ox", "lamp"] };
    const { refs } = refsFor(fixtureBible(), episode, { sheetOf: fixtureSheetOf, board: "b" });
    expect(refs.slice(0, 2).map((r) => r.id)).toEqual(["ox", "lamp"]);
  });

  test("a character without a sheet is described in text, not numbered", () => {
    const sheets = (kind: string, id: string) => (id === "ox" ? null : fixtureSheetOf(kind, id));
    const assembled = assemblePart(fixtureBible(), fixtureEpisode(), "A", { sheetOf: sheets, board: "b" });
    expect(assembled.refs.map((r) => r.kind)).toEqual(["character", "scene", "storyboard"]);
    expect(assembled.video.prompt).toContain("Ox: a stout cartoon ox in a loose blue tie, short horns, one horn chipped.");
    expect(assembled.video.prompt).not.toContain("@Image4");
  });

  test("an unknown cast id is refused by name", () => {
    expect(() => refsFor(fixtureBible(), { ...fixtureEpisode(), cast: ["lamp", "goose"] })).toThrow(/"goose" is not in bible\.json/);
  });

  test("more references than the limit is refused; Seedance's limit is 30, Jimeng's 9", () => {
    expect(SEEDANCE_MAX_REFS).toBe(30);
    expect(JIMENG_MAX_REFS).toBe(9);
    expect(() => refsFor(fixtureBible(), fixtureEpisode(), { sheetOf: fixtureSheetOf, board: "b", limit: 3 })).toThrow(PromptError);
    expect(() => refsFor(fixtureBible(), fixtureEpisode(), { sheetOf: fixtureSheetOf, board: "b", limit: 4 })).not.toThrow();
  });

  test("the Jimeng variant warns past 9 references while generation still allows them", () => {
    const bible = fixtureBible();
    const cast = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, look: `look ${i}`, sheet: null }));
    bible.characters = cast;
    const episode = { ...fixtureEpisode(), cast: cast.map((c) => c.id) };
    const assembled = assemblePart(bible, episode, "A", { sheetOf: (_k: string, id: string) => `sheet-${id}`, board: "b" });
    expect(assembled.refs).toHaveLength(12); // 9 cast + group + scene + storyboard
    expect(assembled.warnings).toEqual(["the Jimeng variant needs 12 reference images; the Jimeng canvas takes at most 9 (the upstream method's figure, from third-party reports — check the canvas's current limit)"]);
  });
});

describe("timing guards", () => {
  test("an episode that breaks the timing rules is not assembled", () => {
    const episode = fixtureEpisode();
    episode.parts[0].shots[0].dur = 1.5;
    expect(() => assemblePart(fixtureBible(), episode, "A")).toThrow(/at least 2 s/);
  });

  test("a 60 s episode assembles each part with its own clock and label", () => {
    const episode = fixtureEpisode();
    episode.duration = 60;
    episode.parts = [episode.parts[0], { id: "B", shots: episode.parts[0].shots.map((s) => ({ ...s })) }];
    const b = assemblePart(fixtureBible(), episode, "B", { sheetOf: fixtureSheetOf, board: "ep01-b-board-1" });
    expect(b.seconds).toBe(30);
    expect(b.video.prompt).toContain("Shot 1 | 0-3s:");
    expect(b.jimeng.video.split("\n")[0]).toContain("| part B of 2]");
  });
});

describe("panels and patches", () => {
  test("a single panel keeps the grid's proportions and its own number", () => {
    const panel = assemblePanel(fixtureBible(), fixtureEpisode(), "A", 3, { sheetOf: fixtureSheetOf });
    expect(panel.prompt).toBe(`Draw one animation storyboard panel with the proportions of a single panel of a 9-panel grid (3 rows × 3 columns). Requirements: black-and-white pencil sketch, clean, no text except the number 3 in the top-left corner. Character reference: image 1 is Lamp, image 2 is Ox, image 3 is the setting, open-plan office.
The panel takes place in the same open-plan office, during the same late afternoon.
Sticky Notes: a swarm of yellow sticky notes that flap like birds. Leader: one red note three times the size, URGENT printed on it in bold black letters, angry brows.

Shot 3: Lamp's arm stretched over desks toward the door.

Again: black-and-white pencil sketch, no colour anywhere. The reference images are for character shapes only — draw those characters as pencil sketches too.`);
    expect(panel.refs).toEqual(["char-lamp-sheet-1", "char-ox-sheet-2", "scene-office-sheet-1"]);
  });

  test("a patch keeps shot numbers, restarts the clock and says it is hard-cut", () => {
    const patch = assemblePatch(fixtureBible(), fixtureEpisode(), "A", 5, 6, { sheetOf: fixtureSheetOf, board: "ep01-a-board-1" });
    expect(patch.plan).toEqual({ shots: [5, 6], covered: [5, 6], extended: false, span: [12, 19], offset: 0, seconds: 7, requestSeconds: 7 });
    expect(patch.video.prompt.split("\n")[0]).toBe("Make an animated video from the storyboard @Image4. Use the storyboard only for its shot design, action timing, framing and camera moves; never paste or splice the storyboard image itself into the video. This run covers only storyboard panels 5–6; it opens and ends on a hard cut.");
    expect(patch.video.prompt).toContain("Shot 5 | 0-4s: tracking side shot");
    expect(patch.video.prompt).toContain("Shot 6 | 4-7s: Ox bursts through the note swarm.");
    expect(patch.video.prompt).not.toContain("Shot 4 |");
    expect(patch.warnings).toEqual([]);
  });

  test("a patch under the minimum render takes the next shot along and says so", () => {
    const patch = assemblePatch(fixtureBible(), fixtureEpisode(), "A", 6, 6, { sheetOf: fixtureSheetOf, board: "b" });
    expect(patch.plan.covered).toEqual([6, 7]);
    expect(patch.plan.span).toEqual([16, 19]);
    expect(patch.plan.offset).toBe(0);
    expect(patch.video.prompt).toContain("Shot 7 | 3-6s:");
    expect(patch.warnings[0]).toMatch(/shots 6–6 last 3 s, under the 4 s minimum render; the patch also covers shots 6–7/);
  });
});

describe("design sheets", () => {
  test("a character sheet: defaults for empty expressions, whole pose phrases, a faceless silhouette, no stray notes", () => {
    const sheet = sheetPrompt(fixtureBible(), "character", "lamp");
    expect(sheet.aspectRatio).toBe("1:1");
    expect(sheet.prompt).toBe(`Character design sheet for one character: a full-body turnaround (front, side, back), 6 different expressions (happy, startled, angry, sulking, smug, resigned), 2 poses (standing; arm stretched across a desk) and a solid silhouette with no face. Clean layout; no explanatory text other than the name and a short caption per panel; the name "Lamp" written in the top-left corner.
Character: a small desk lamp with a round brass shade, one bendy arm and a square base.
Soft 3D animation style, clean white background, gentle shadows.`);
  });

  test("a group sheet takes its poses and leader panel from the bible", () => {
    const sheet = sheetPrompt(fixtureBible(), "group", "notes");
    expect(sheet.aspectRatio).toBe("16:9");
    expect(sheet.prompt).toBe(`Group character design sheet: Sticky Notes, a swarm of yellow sticky notes that flap like birds. Draw 3 members in different poses (stuck flat on a wall; swarming in; smug), one consistent design. Then draw a separate large front view of the leader: one red note three times the size, URGENT printed on it in bold black letters, angry brows. Clean layout; no explanatory text other than the name and a short caption per panel; the name "Sticky Notes" written in the top-left corner.
Soft 3D animation style, clean white background, gentle shadows.`);
    const bare = fixtureBible();
    delete bare.groups[0].leader;
    bare.groups[0].poses = [];
    expect(sheetPrompt(bare, "group", "notes").prompt).toContain("Draw 5 members in different poses (standing; on the move; acting together; smug; startled), one consistent design. Clean layout;");
  });

  test("a scene sheet: no characters, its own time of day, the series ratio, and the cast sheets as style-only references", () => {
    const bible = { ...fixtureBible(), ratio: "9:16" };
    const textOnly = sheetPrompt(bible, "scene", "office");
    expect(textOnly.aspectRatio).toBe("9:16");
    expect(textOnly.prompt).toBe("Scene design sheet with no characters in it: open-plan office, rows of desks, a coffee machine, a big window at dusk. Wide establishing view, dusk. Rounded 3D animation, the office lit a warm yellow, broad slapstick timing. No text anywhere in the image.");
    const styled = sheetPrompt(bible, "scene", "office", { styleReferences: 2 });
    expect(styled.styleReferences).toBe(2);
    expect(styled.prompt.split("\n")[1]).toBe("The reference images are only for matching the art style, materials and roundness: build the furniture and props of this set in that same style. Do not draw any character from the reference images.");
  });

  test("the Jimeng sheet form says how to register the kept image", () => {
    const text = jimengSheet(sheetPrompt(fixtureBible(), "group", "notes"));
    expect(text.split("\n")[0]).toBe("[Jimeng canvas | Image generation | ratio 16:9 | make 4, keep the best 1 | register it: series.mjs make-sheets --group notes --upload <file>]");
    expect(text.split("\n")[1]).toBe(COPY_LINE);
    expect(jimengSheet(sheetPrompt(fixtureBible(), "scene", "office", { styleReferences: 2 })).split("\n")[0]).toContain("select the picked character sheet nodes (style reference only)");
  });

  test("a sheet needs a written look", () => {
    const bible = fixtureBible();
    bible.characters[0].look = " ";
    expect(() => sheetPrompt(bible, "character", "lamp")).toThrow(/has no look yet/);
  });
});

describe("markings and time", () => {
  test("without markings the closing line forbids all text", () => {
    const bible = fixtureBible();
    delete bible.groups[0].markings;
    const video = assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" }).video.prompt;
    expect(video.split("\n").at(-1)).toBe("No text, subtitles, captions or logos anywhere in the frame.");
    expect(noTextLine([])).toBe("No text, subtitles, captions or logos anywhere in the frame.");
  });

  test("markings of every cast member and group are listed as the exceptions", () => {
    const bible = fixtureBible();
    bible.characters[1].markings = "the ox head on Ox's tie clip.";
    const video = assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" }).video.prompt;
    expect(video.split("\n").at(-1)).toBe("Apart from the ox head on Ox's tie clip; the word URGENT on the red leader note, no other text, subtitles, captions or logos anywhere in the frame.");
  });

  test("markings of an entity outside the episode do not loosen the rule", () => {
    const episode = { ...fixtureEpisode(), groups: [] };
    const video = assemblePart(fixtureBible(), episode, "A", { sheetOf: fixtureSheetOf, board: "b" }).video.prompt;
    expect(video).toContain("No text, subtitles, captions or logos anywhere in the frame.");
    expect(video).not.toContain("URGENT");
  });

  test("an episode without a time takes the scene's", () => {
    const episode = { ...fixtureEpisode(), time: "" };
    const assembled = assemblePart(fixtureBible(), episode, "A", { sheetOf: fixtureSheetOf, board: "b" });
    expect(assembled.storyboard.prompt).toContain("All 9 panels take place in the same open-plan office, during the same dusk.");
    expect(assembled.video.prompt).toContain("The whole film stays in the same open-plan office, during the same dusk:");
  });
});

// ---------------------------------------------------------------------------
// Chinese scaffolding: a Chinese bible gets the upstream-tested Chinese
// sentences end to end (prompt-locales.mjs), an English one stays English.
// ---------------------------------------------------------------------------

const GOLDEN_ZH_STORYBOARD = `生成 16:9 六宫格（2 行 3 列）动画分镜素描草图。要求：黑白铅笔素描、画面干净不杂乱、不要复杂背景、无多余画面、无文字，每格左上角标镜头序号。角色外形参考：图 1 是台灯，图 2 是老牛，图 3 是场景开放办公区。
全部 6 格在同一个开放办公区，同一个傍晚。
便利贴群：一大群黄色便利贴，像鸟一样扑腾。头目：一张三倍大的红色便利贴，印着粗黑字「紧急」，眉头紧皱。

镜头 1：全景：台灯盯着挂钟，五点五十九，老牛已经收拾好包。
镜头 2：便利贴群从墙上揭下来，齐刷刷转向它们。
镜头 3：台灯的灯臂伸过桌子够向门。
镜头 4：老牛驮着台灯冲过便利贴群。
镜头 5：六点整，门开了，两个一起摔出去。
镜头 6：定格：一张空白便利贴落在老牛脸上。

再强调一次：全部画成黑白铅笔素描，不要上任何颜色。参考图只用来看角色的外形，画进分镜里也一样是铅笔素描。`;

const GOLDEN_ZH_VIDEO = `根据故事板 @Image4 生成分镜视频，仅参考其镜头设计、动作节奏、景别和运镜，禁止直接拼接故事板图片。

@Image1 是台灯，外形必须和参考图完全一致：一盏小台灯，圆圆的黄铜灯罩，一根能弯的灯臂，方形底座。
@Image2 是老牛，外形必须和参考图完全一致：一头矮壮的卡通牛，系着松垮的蓝领带，牛角很短，一只缺了个角。
便利贴群：一大群黄色便利贴，像鸟一样扑腾。头目：一张三倍大的红色便利贴，印着粗黑字「紧急」，眉头紧皱。

风格：圆润的 3D 动画短片画面，办公室里亮着暖黄的灯，动作夸张、节奏像默剧。没有台词。全片在同一个开放办公区、同一个傍晚：一排排工位，一台咖啡机，一扇黄昏的大窗。场景参考 @Image3。

连贯要求：每一镜都从上一镜停下的那个动作接着演；所有跑动都从画面左侧跑向右侧，方向不变。

镜头 1｜0-3s：全景：台灯盯着挂钟，五点五十九，老牛已经收拾好包。
音效：钟表滴答

镜头 2｜3-5s：便利贴群从墙上揭下来，齐刷刷转向它们。
音效：纸片沙沙

镜头 3｜5-8s：台灯把灯臂伸过三张桌子，够到门把手。
音效：灯臂拉长的吱嘎声

镜头 4｜8-11s：老牛驮着台灯冲过便利贴群。
音效：纸片炸开

镜头 5｜11-13s：六点整，门开了，两个一起摔出去。
音效：钟响

镜头 6｜13-15s：定格：一张空白便利贴落在老牛脸上。
音效：泄气的哨子声

除了红色头目上的「紧急」两个字，画面里不要出现任何其他文字、字幕、商标。`;

const GOLDEN_ZH_JIMENG_HEAD = "【即梦画布｜视频生成｜Seedance 2.5 全能参考｜框选节点：@图1 台灯设定图、@图2 老牛设定图、@图3 开放办公区设定图、@图4 故事板｜16:9｜15 秒｜先 480p，满意再超清｜整集】";

describe("scaffolding language follows the bible", () => {
  test("detected from the bible's own text, overridable with lang", () => {
    expect(bibleLang(fixtureBible())).toBe("en");
    expect(bibleLang(fixtureBibleZh())).toBe("zh");
    expect(bibleLang({ ...fixtureBibleZh(), lang: "en" })).toBe("en");
    expect(bibleLang({ ...fixtureBible(), lang: "zh" })).toBe("zh");
    // An English bible with one Chinese name stays English.
    const mixed = fixtureBible();
    mixed.characters[0].name = "光";
    expect(bibleLang(mixed)).toBe("en");
  });

  test("Chinese storyboard prompt", () => {
    const zh = assemblePart(fixtureBibleZh(), fixtureEpisodeZh(), "A", { sheetOf: fixtureSheetOf, board: "ep01-a-board-1" });
    expect(zh.lang).toBe("zh");
    expect(zh.storyboard.prompt).toBe(GOLDEN_ZH_STORYBOARD);
  });

  test("Chinese video prompt: Chinese scaffolding, fal's @ImageN tokens", () => {
    const zh = assemblePart(fixtureBibleZh(), fixtureEpisodeZh(), "A", { sheetOf: fixtureSheetOf, board: "ep01-a-board-1" });
    expect(zh.video.prompt).toBe(GOLDEN_ZH_VIDEO);
  });

  test("the Jimeng variant: @图N tokens, the Chinese canvas line and cut line", () => {
    const zh = assemblePart(fixtureBibleZh(), fixtureEpisodeZh(), "A", { sheetOf: fixtureSheetOf, board: "ep01-a-board-1", boardFile: "episodes/ep01/boards/a.png" });
    const [head, cut, blank, ...body] = zh.jimeng.video.split("\n");
    expect(head).toBe(GOLDEN_ZH_JIMENG_HEAD);
    expect(cut).toBe(PROMPT_LOCALES.zh.copyLine);
    expect(blank).toBe("");
    expect(body.join("\n")).toBe(GOLDEN_ZH_VIDEO.replaceAll(/@Image(\d)/g, "@图$1"));
    expect(zh.jimeng.storyboard.split("\n")[0]).toBe("【即梦画布｜图片生成｜框选节点：台灯设定图、老牛设定图、开放办公区设定图｜比例 16:9｜出 4 张挑 1 张，下载存成 episodes/ep01/boards/a.png，登记：series.mjs shoot-board --episode ep01 --part A --upload <文件>】");
  });

  test("a Chinese panel, patch and sheets", () => {
    const panel = assemblePanel(fixtureBibleZh(), fixtureEpisodeZh(), "A", 3, { sheetOf: fixtureSheetOf });
    expect(panel.prompt.split("\n")[0]).toBe("生成一格动画分镜素描草图，比例和六宫格（2 行 3 列）里的一格相同。要求：黑白铅笔素描、画面干净、无文字，左上角标序号 3。角色外形参考：图 1 是台灯，图 2 是老牛，图 3 是场景开放办公区。");
    expect(panel.prompt.split("\n").at(-1)).toBe(PROMPT_LOCALES.zh.boardClosing);
    const patch = assemblePatch(fixtureBibleZh(), fixtureEpisodeZh(), "A", 5, 5, { sheetOf: fixtureSheetOf, board: "b" });
    expect(patch.video.prompt.split("\n")[0]).toBe("根据故事板 @Image4 生成分镜视频，仅参考其镜头设计、动作节奏、景别和运镜，禁止直接拼接故事板图片。这次只生成故事板第 5–6 格，开头和结尾都是硬切。");
    expect(patch.jimeng.video.split("\n")[0]).toContain("｜4 秒｜先 480p，满意再超清｜补拍第 A 段镜头 5–6】");
    expect(sheetPrompt(fixtureBibleZh(), "character", "lamp").prompt.split("\n")[0]).toBe("角色设定图，同一个角色的全身三视图（正面、侧面、背面）、6 个不同表情（开心、惊吓、生气、委屈、得意、无奈）、2 个动作姿势（站着；灯臂横跨整张桌子（伸得很长，绷直））和一个不画五官的实心剪影，排版干净，除了名字和每格一句简短说明之外不要写任何解释文字，左上角写角色名「台灯」。");
    expect(sheetPrompt(fixtureBibleZh(), "scene", "office").prompt).toBe("场景设定图，没有任何角色：开放办公区，一排排工位，一台咖啡机，一扇黄昏的大窗。广角全景，黄昏。圆润的 3D 动画短片画面，办公室里亮着暖黄的灯，动作夸张、节奏像默剧。画面中没有文字。");
    expect(jimengSheet(sheetPrompt(fixtureBibleZh(), "group", "notes")).split("\n")[0]).toBe("【即梦画布｜图片生成｜比例 16:9｜出 4 张挑 1 张｜登记：series.mjs make-sheets --group notes --upload <文件>】");
  });

  test("the default continuity lines state the method's two rules, in the bible's language", () => {
    expect(defaultContinuity(fixtureBibleZh())).toEqual(["每一镜都从上一镜停下的那个动作接着演", "所有跑动都从画面左侧跑向右侧，方向不变"]);
    expect(defaultContinuity(fixtureBible())).toEqual(["every shot picks up the motion where the previous shot left it", "every run crosses the frame the same way, left to right"]);
  });

  test("every locale fills every template the assembler uses", () => {
    expect(Object.keys(PROMPT_LOCALES.zh).sort()).toEqual(Object.keys(PROMPT_LOCALES.en).sort());
    expect(noTextLine(["a"], "zh")).toBe("除了a，画面里不要出现任何其他文字、字幕、商标。");
  });
});

describe("the Jimeng panel redraw", () => {
  test("its canvas line lists the board node first, then the sheets, in the prompt's own numbering", () => {
    const panel = assemblePanel(fixtureBible(), fixtureEpisode(), "A", 3, { sheetOf: fixtureSheetOf, board: "ep01-a-board-2", boardFile: "episodes/ep01/boards/a-2.png" });
    expect(panel.aspectRatio).toBe("16:9");
    const [head, cut, blank, ...body] = panel.jimeng.panel.split("\n");
    expect(head).toBe("[Jimeng canvas | Image generation | select these nodes in this order: @图1 storyboard (episodes/ep01/boards/a-2.png), @图2 Lamp sheet, @图3 Ox sheet, @图4 open-plan office sheet | ratio 16:9 | make 4, keep the best 1 | register it: series.mjs redo-panel --episode ep01 --part A --shot 3 --upload <file> (it becomes a new storyboard), then drag the new storyboard onto the canvas and select it for the clip]");
    expect(cut).toBe(COPY_LINE);
    expect(blank).toBe("");
    expect(body.join("\n")).toBe(panel.prompt);
    // The prompt numbers the references the way the line asks them selected.
    expect(panel.prompt).toContain("Character reference: image 2 is Lamp, image 3 is Ox, image 4 is the setting, open-plan office.");
    expect(panel.prompt).toContain("Image 1 is the current storyboard:");
  });

  test("in Chinese, at one cell of the grid at the series ratio", () => {
    const panel = assemblePanel(fixtureBibleZh(), fixtureEpisodeZh(), "A", 3, { sheetOf: fixtureSheetOf, board: "ep01-a-board-1", boardFile: "episodes/ep01/boards/a-1.png" });
    // 16:9 frames laid out 2 × 3: one cell is nearest 4:3.
    expect(panel.aspectRatio).toBe("4:3");
    expect(panel.jimeng.panel.split("\n")[0]).toBe("【即梦画布｜图片生成｜框选节点：@图1 故事板（episodes/ep01/boards/a-1.png）、@图2 台灯设定图、@图3 老牛设定图、@图4 开放办公区设定图｜比例 4:3｜出 4 张挑 1 张｜登记：series.mjs redo-panel --episode ep01 --part A --shot 3 --upload <文件>（会拼成一张新故事板），再把新故事板拖回画布，出视频时框选它】");
    expect(panel.jimeng.panel.split("\n")[1]).toBe(PROMPT_LOCALES.zh.copyLine);
    expect(panel.prompt).toContain("角色外形参考：图 2 是台灯，图 3 是老牛，图 4 是场景开放办公区。");
  });
});

describe("round 2: scene rules and the redrawn panel's style reference", () => {
  test("a scene's rules reach the scene sheet, every board and panel, and the clip", () => {
    const bible = fixtureBible();
    bible.scenes[0].rules = "the wall clock has no numbers on its face";
    const part = assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" });
    const board = part.storyboard.prompt.split("\n");
    expect(board[1]).toBe("All 9 panels take place in the same open-plan office, during the same late afternoon.");
    expect(board[2]).toBe("Set rules: the wall clock has no numbers on its face.");
    expect(part.video.prompt).toContain("rows of desks, a coffee machine, a big window at dusk. Set rules: the wall clock has no numbers on its face. Scene reference: @Image3.");
    expect(assemblePanel(bible, fixtureEpisode(), "A", 3, { sheetOf: fixtureSheetOf }).prompt).toContain("\nSet rules: the wall clock has no numbers on its face.\n");
    expect(sheetPrompt(bible, "scene", "office").prompt).toBe("Scene design sheet with no characters in it: open-plan office, rows of desks, a coffee machine, a big window at dusk. Wide establishing view, dusk. Set rules: the wall clock has no numbers on its face. Rounded 3D animation, the office lit a warm yellow, broad slapstick timing. No text anywhere in the image.");
    // Without rules nothing is added.
    expect(assemblePart(fixtureBible(), fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" }).storyboard.prompt).not.toContain("Set rules");

    const zh = fixtureBibleZh();
    zh.scenes[0].rules = "挂钟的钟面只有刻度，没有数字";
    const zhPart = assemblePart(zh, fixtureEpisodeZh(), "A", { sheetOf: fixtureSheetOf, board: "b" });
    expect(zhPart.storyboard.prompt.split("\n")[2]).toBe("场景要求：挂钟的钟面只有刻度，没有数字。");
    expect(zhPart.video.prompt).toContain("一扇黄昏的大窗。场景要求：挂钟的钟面只有刻度，没有数字。场景参考 @Image3。");
  });

  test("boards and panels carry the constraint clauses of the scene's look; the clip already has the whole look", () => {
    // The live Ep01 board drew "12" on a clock whose look said it has no
    // numerals: the board line names only the scene, not its look.
    const bible = fixtureBible();
    bible.scenes[0].look = "rows of desks, a coffee machine. A round wall clock with no numbers on its face; never any posters, warm and not gloomy";
    const part = assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" });
    expect(part.storyboard.prompt.split("\n")[2]).toBe("Set rules: A round wall clock with no numbers on its face; never any posters; warm and not gloomy.");
    expect(assemblePanel(bible, fixtureEpisode(), "A", 3, { sheetOf: fixtureSheetOf }).prompt).toContain("\nSet rules: A round wall clock with no numbers on its face; never any posters; warm and not gloomy.\n");
    // Whole words only: "notebook" and "nothing" are not constraints.
    bible.scenes[0].look = "rows of desks, a notebook on every desk";
    expect(assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" }).storyboard.prompt).not.toContain("Set rules");
    // A clause the rules already state is not repeated.
    bible.scenes[0].look = "rows of desks, the clock has no numbers";
    bible.scenes[0].rules = "the clock has no numbers, no posters";
    expect(assemblePart(bible, fixtureEpisode(), "A", { sheetOf: fixtureSheetOf, board: "b" }).storyboard.prompt.split("\n")[2]).toBe("Set rules: the clock has no numbers, no posters.");

    // The seed's own wording: three constraint clauses; "dim but not black"
    // (暗而不黑) is a description, not a constraint, and stays out.
    const zh = fixtureBibleZh();
    zh.scenes[0].look = "一排排工位，桌面上没有便利贴，也没有带脸的摆件；墙上一只圆形挂钟，钟面只有刻度没有数字；整体暗而不黑";
    const zhPart = assemblePart(zh, fixtureEpisodeZh(), "A", { sheetOf: fixtureSheetOf, board: "b" });
    expect(zhPart.storyboard.prompt.split("\n")[2]).toBe("场景要求：桌面上没有便利贴；也没有带脸的摆件；钟面只有刻度没有数字。");
    expect(assemblePanel(zh, fixtureEpisodeZh(), "A", 3, { sheetOf: fixtureSheetOf }).prompt).toContain("\n场景要求：桌面上没有便利贴；也没有带脸的摆件；钟面只有刻度没有数字。\n");
    // The clip prompt carries the whole look once and adds no rules line of its own.
    expect(zhPart.video.prompt).not.toContain("场景要求");
    expect(zhPart.video.prompt).toContain("钟面只有刻度没有数字");
  });

  test("a redrawn panel carries the board it goes back into as image 1, its style reference", () => {
    const panel = assemblePanel(fixtureBible(), fixtureEpisode(), "A", 3, { sheetOf: fixtureSheetOf, board: "ep01-a-board-2" });
    expect(panel.refs).toEqual(["ep01-a-board-2", "char-lamp-sheet-1", "char-ox-sheet-2", "scene-office-sheet-1"]);
    const lines = panel.prompt.split("\n");
    expect(lines[0]).toBe("Draw one animation storyboard panel with the proportions of a single panel of a 9-panel grid (3 rows × 3 columns). Requirements: black-and-white pencil sketch, clean, no text except the number 3 in the top-left corner. Character reference: image 2 is Lamp, image 3 is Ox, image 4 is the setting, open-plan office.");
    expect(lines[1]).toBe("Image 1 is the current storyboard: draw this panel in exactly its style — the same pencil line and weight, the same framing scale, the shot number marked exactly as the other panels mark theirs. Draw only this one panel, not the grid.");
    const zh = assemblePanel(fixtureBibleZh(), fixtureEpisodeZh(), "A", 3, { sheetOf: fixtureSheetOf, board: "b" }).prompt.split("\n");
    expect(zh[0]).toContain("角色外形参考：图 2 是台灯，图 3 是老牛，图 4 是场景开放办公区。");
    expect(zh[1]).toBe("图 1 是现在的整张分镜：完全照它的画法画这一格——同样的铅笔线条和粗细、同样的景别大小，序号的标法和其他格一模一样。只画这一格，不要画整张宫格。");
  });
});
