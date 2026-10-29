/**
 * A small original series for the anime-series script tests: two characters,
 * one group, one scene, one 30 s episode of nine shots. Original content —
 * not upstream's example.
 */

import type { Bible, Episode } from "../skill/scripts/series-state.mjs";

export function fixtureBible(): Bible {
  return {
    title: "Lamp and Ox",
    ratio: "16:9",
    dialogue: false,
    style: "Rounded 3D animation, the office lit a warm yellow, broad slapstick timing.",
    sheetStyle: "Soft 3D animation style, clean white background, gentle shadows.",
    characters: [
      {
        id: "lamp",
        name: "Lamp",
        look: "a small desk lamp with a round brass shade, one bendy arm and a square base",
        ability: "bends its arm to any length",
        personality: "eager and jumpy",
        palette: ["#d4a017", "#2b2b2b", "#f5e6c8"],
        expressions: [],
        poses: ["standing", "arm stretched across a desk"],
        sheet: null,
      },
      {
        id: "ox",
        name: "Ox",
        look: "a stout cartoon ox in a loose blue tie, short horns, one horn chipped",
        ability: "carries anything on its back",
        personality: "slow and stubborn",
        palette: { body: "#6b4f3a", tie: "#2f5fa8", horns: "#efe7da" },
        expressions: [],
        poses: [],
        sheet: null,
      },
    ],
    groups: [{
      id: "notes",
      name: "Sticky Notes",
      look: "a swarm of yellow sticky notes that flap like birds",
      leader: "one red note three times the size, URGENT printed on it in bold black letters, angry brows",
      markings: "the word URGENT on the red leader note",
      poses: ["stuck flat on a wall", "swarming in", "smug"],
      sheet: null,
    }],
    scenes: [{ id: "office", name: "open-plan office", look: "rows of desks, a coffee machine, a big window at dusk", time: "dusk", sheet: null }],
    locks: [],
  };
}

export function fixtureEpisode(): Episode {
  return {
    id: "ep01",
    title: "Clock Out",
    duration: 30,
    cast: ["lamp", "ox"],
    groups: ["notes"],
    scene: "office",
    time: "late afternoon",
    continuity: ["every shot picks up the motion where the previous one left it", "every run crosses the frame left to right"],
    parts: [
      {
        id: "A",
        shots: [
          { dur: 3, desc: "wide: Lamp eyes the clock at 5:59, Ox already packed", sfx: "ticking, office hum" },
          { dur: 3, desc: "close-up: the sticky notes peel off the wall and turn toward them", sfx: "paper rustle, ominous sting" },
          { dur: 3, desc: "Lamp stretches its arm across three desks to reach the door", sfx: "a rubbery stretch", sketch: "Lamp's arm stretched over desks toward the door" },
          { dur: 3, desc: "the notes swarm and stick Lamp's arm to a desk", sfx: "flapping, splat" },
          { dur: 4, desc: "tracking side shot: Ox charges with Lamp riding on its back", sfx: "hooves on carpet, drum roll" },
          { dur: 3, desc: "Ox bursts through the note swarm", sfx: "paper explosion" },
          { dur: 3, desc: "they reach the door, it is locked", sfx: "rattle, record scratch" },
          { dur: 4, desc: "the clock strikes six; the door unlocks; both fall through", sfx: "bell, thud" },
          { dur: 4, desc: "freeze: a blank sticky note lands on Ox's face, Lamp sighs", sfx: "a deflating whistle, a cymbal tap" },
        ],
      },
    ],
    log: null,
    picks: {},
  };
}

/** Sheet assets in effect for the fixture: both characters and the scene; the group is text-only. */
export const FIXTURE_SHEETS: Record<string, string> = {
  "character:lamp": "char-lamp-sheet-1",
  "character:ox": "char-ox-sheet-2",
  "scene:office": "scene-office-sheet-1",
};

export const fixtureSheetOf = (kind: string, id: string) => FIXTURE_SHEETS[`${kind}:${id}`] ?? null;

/**
 * The same small series written in Chinese, for the Chinese scaffolding
 * (prompt-locales.mjs `zh`). Original content, like the English fixture.
 */
export function fixtureBibleZh(): Bible {
  return {
    title: "台灯和老牛",
    ratio: "16:9",
    dialogue: false,
    style: "圆润的 3D 动画短片画面，办公室里亮着暖黄的灯，动作夸张、节奏像默剧。",
    sheetStyle: "柔和的 3D 动画风格，纯白背景，阴影柔和。",
    characters: [
      {
        id: "lamp",
        name: "台灯",
        look: "一盏小台灯，圆圆的黄铜灯罩，一根能弯的灯臂，方形底座",
        ability: "灯臂能伸到任意长",
        personality: "积极又毛躁",
        palette: ["#d4a017"],
        expressions: [],
        poses: ["站着", "灯臂横跨整张桌子（伸得很长，绷直）"],
        sheet: null,
      },
      {
        id: "ox",
        name: "老牛",
        look: "一头矮壮的卡通牛，系着松垮的蓝领带，牛角很短，一只缺了个角",
        expressions: [],
        poses: [],
        sheet: null,
      },
    ],
    groups: [{
      id: "notes",
      name: "便利贴群",
      look: "一大群黄色便利贴，像鸟一样扑腾",
      leader: "一张三倍大的红色便利贴，印着粗黑字「紧急」，眉头紧皱",
      markings: "红色头目上的「紧急」两个字",
      poses: ["整齐贴在墙上", "成群飞过来"],
      sheet: null,
    }],
    scenes: [{ id: "office", name: "开放办公区", look: "一排排工位，一台咖啡机，一扇黄昏的大窗", time: "黄昏", sheet: null }],
    locks: [],
  };
}

export function fixtureEpisodeZh(): Episode {
  return {
    id: "ep01",
    title: "准点下班",
    duration: 15,
    cast: ["lamp", "ox"],
    groups: ["notes"],
    scene: "office",
    time: "傍晚",
    continuity: ["每一镜都从上一镜停下的那个动作接着演", "所有跑动都从画面左侧跑向右侧，方向不变"],
    parts: [
      {
        id: "A",
        shots: [
          { dur: 3, desc: "全景：台灯盯着挂钟，五点五十九，老牛已经收拾好包", sfx: "钟表滴答" },
          { dur: 2, desc: "便利贴群从墙上揭下来，齐刷刷转向它们", sfx: "纸片沙沙" },
          { dur: 3, desc: "台灯把灯臂伸过三张桌子，够到门把手", sfx: "灯臂拉长的吱嘎声", sketch: "台灯的灯臂伸过桌子够向门" },
          { dur: 3, desc: "老牛驮着台灯冲过便利贴群", sfx: "纸片炸开" },
          { dur: 2, desc: "六点整，门开了，两个一起摔出去", sfx: "钟响" },
          { dur: 2, desc: "定格：一张空白便利贴落在老牛脸上", sfx: "泄气的哨子声" },
        ],
      },
    ],
    log: null,
    picks: {},
  };
}
