// locale.ts — everything language-specific in the video: copy, text faces, size tweaks.
// Scenes import from here; swap this file to change the language without touching them.
//
// Chinese face: LXGW WenKai (霞鹜文楷, SIL OFL 1.1) — a kai-style face with a calligraphic
// warmth that sits naturally beside Fraunces on warm paper. Loaded from jsDelivr at render
// time; its CSS is split by unicode-range, and theme.tsx loads only the slices this copy uses.

const LOCALE = "zh";

const FONT = {
  css: [
    "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css",
    "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-bold.css",
  ],
  /** CSS font shorthands that must be loaded before any frame is drawn. */
  faces: ["400 1em 'LXGW WenKai'", "700 1em 'LXGW WenKai'"],
  /** Latin runs inside Chinese lines stay in Fraunces; CJK falls through to WenKai. */
  head: "'Fraunces', 'LXGW WenKai', serif",
  body: "'Fraunces', 'LXGW WenKai', serif",
  monoFallback: "'LXGW WenKai'",
  headWeight: 400,
  titleWeight: 700,
};

const SIZE = {
  /** Pillar titles (可视环境 …). */
  pillarTitle: 64,
  pillarTitleTracking: 2,
  /** The h1 on the mock slide in the hero scene. */
  slideTitle: 44,
  /** Width of the selection box around the picked slide item. */
  pickW: 196,
  finaleTagline: 28,
};

const T = {
  opening: {
    kicker: "Greek · n. · breath, spirit",
    gloss: "希腊语，意为「气息」。",
    tagline: "人与 code agent 共创的基础设施",
  },
  gap: {
    kicker: "今天的协作方式",
    agentCaption: "Agent 在文件里工作。",
    humanCaption: "人面对的，是一屏 diff。",
    missingPre: "中间缺了一层：",
    missingEm: "看得见的界面",
    missingPost: "。",
  },
  loop: {
    headline: "同一份文件，两种视角。",
    aside: "agent 写文件 · 人看 viewer",
    code: [
      `<section class="slide">`,
      `  <h1>京都三日</h1>`,
      `  <p>秋天，慢一点走</p>`,
      `  <ol>`,
      `    <li>Day 1 · 东山</li>`,
      `    <li>Day 2 · 岚山</li>`,
      `    <li>Day 3 · 伏见稻荷</li>`,
      `  </ol>`,
      `</section>`,
    ],
    newLine: `    <li>Day 2 · 竹林小径</li>`,
    title: "京都三日",
    subtitle: "秋天，慢一点走",
    items: ["Day 1 · 东山", "Day 2 · 岚山", "Day 3 · 伏见稻荷"],
    itemAfter: "Day 2 · 竹林小径",
    ask: "改成「竹林小径」",
    steps: [
      { k: "看见", d: "文件一落盘，viewer 当场渲染。" },
      { k: "指出", d: "在 viewer 里选中，上下文直接交给 agent。" },
      { k: "参与", d: "agent 改文件，你看着它变。" },
    ],
  },
  pillars: {
    rail: "四个支柱 · Four pillars",
    items: [
      {
        title: "可视环境",
        kicker: "Visual Environment",
        rail: "可视环境",
        body: "Agent 写下的文件，实时变成\n可以看、可以点的 viewer。",
      },
      {
        title: "Skills",
        kicker: "Domain Skills",
        rail: "Skills",
        body: "每个 mode 自带领域 skill：\n约定、流程、参考资料，agent 按需取用。",
      },
      {
        title: "持续学习",
        kicker: "Continuous Learning",
        rail: "持续学习",
        body: "你的偏好跨会话沉淀，不必每次从头交代。",
      },
      {
        title: "分发",
        kicker: "Distribution",
        rail: "分发",
        body: "把一种工作方式打包成 mode，\n分享出去，别人装上就能用。",
      },
    ],
    viewerKinds: ["文档", "幻灯片", "看板", "视频", "图表"],
    viewerNote: "每种内容，一个为它设计的 viewer",
    skillNotes: ["约定与流程", "设计参考", "按需读取"],
    learningNote: "纠正一次，下次就按你的来。",
    destinations: ["团队", "社区", "另一个项目"],
    /** Real text set over the two chat bubbles in the visual-environment painting. */
    visualChat: ["Agent：片头标题卡\n已对齐到音乐的节拍。", "Agent：改好了，看 0:04。"],
  },
  modes: {
    kicker: "Mode 目录",
    headline: "十九种工作方式，已经打包成 mode。",
    sub: "装上就能用，也可以照着改成你自己的。",
    counter: "modes",
    here: "本片",
    yours: "下一个，是你的。",
    yourTile: "你的工作方式",
    labels: {
      slide: "幻灯片",
      doc: "文档",
      webcraft: "网页设计",
      kami: "纸感排版",
      diagram: "专业图表",
      draw: "手绘白板",
      gridboard: "仪表盘",
      remotion: "编程视频",
      clipcraft: "AI 短片",
      backlot: "影片全流程",
      illustrate: "插画工坊",
      bansho: "板书讲解",
      eli5: "深入浅出",
      plotwise: "剧情课程",
      cosmos: "结构星图",
      lucid: "三维场景",
      sprite: "精灵图",
      wordtaste: "中文长文",
      "mode-maker": "造新 mode",
    } as Record<string, string>,
  },
  finale: {
    caption: "人与 agent，在同一处创作。",
    tagline: "人与 code agent 共创的基础设施",
    pillars: ["可视环境", "Skills", "持续学习", "分发"],
    credit: "这支视频由 agent 在 Pneuma Remotion mode 中写成",
  },
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { LOCALE, FONT, SIZE, T };
