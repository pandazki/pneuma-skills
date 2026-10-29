/**
 * Every word the series viewer says, in each language it says it in.
 *
 * Keyed by `props.locale` (sprite's precedent): a Chinese agent filling an
 * English stage reads as two products. Deliberately NOT in here:
 * - CONTENT the agent or the user wrote — names, looks, shot text, notes.
 * - PROPER NOUNS and ids — `take-02`, `Seedance 2.5`, `480p`, `ep01`.
 */

import type { EpisodeStage } from "../domain.js";

export type SeriesLocale = "en" | "zh-CN";

// A video job takes minutes; past a minute and a half, seconds stop reading.
function agoEn(seconds: number): string {
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

function agoZh(seconds: number): string {
  return seconds < 90 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`;
}

export interface SeriesStrings {
  // shell
  loading: string;
  noBibleTitle: string;
  noBibleBody: string;
  bibleBroken: (error: string) => string;
  projectBroken: (error: string) => string;
  episodeBroken: (id: string, error: string) => string;
  readOnly: string;

  // rail
  untitled: string;
  bibleLocked: (version: number, day: string) => string;
  bibleEdited: (version: number) => string;
  bibleUnlocked: string;
  episodeCount: (n: number) => string;
  stage: (stage: EpisodeStage, busy: boolean) => string;
  /** A reviewed episode that still has unchecked cells. */
  stageUnchecked: (n: number) => string;
  driftCount: (n: number) => string;
  newEpisode: string;
  estimate: string;
  inFlightIncluded: (usd: string) => string;
  binge: string;
  backToDesk: string;
  seasonOverview: string;

  // wall
  wallTitle: string;
  wallHint: string;
  kindLabel: (kind: "character" | "group" | "scene") => string;
  lockedChip: (version: number) => string;
  editedChip: string;
  unlockedChip: string;
  shotUnderChip: (version: number, episode: string, under: number) => string;
  fieldLabel: (field: string) => string;
  appearances: (n: number) => string;
  noDrift: string;
  driftAt: (n: number, episode: string, shot: number) => string;
  textOnly: string;
  styleTitle: string;
  lineupTitle: string;
  /** The lineup was drawn from a sheet that is no longer picked. */
  lineupStale: string;
  logButton: string;
  /** What the episode log records, under its button. */
  logButtonHint: string;
  noSheet: string;
  sheetGenerating: string;
  sheetFailed: string;
  pickOne: (n: number) => string;
  useThis: string;
  inUse: string;
  twoMore: string;
  makeSheets: string;
  checkSheets: string;
  outdated: string;
  lockAs: (version: number) => string;
  lockHint: string;
  editHint: string;
  candidatesTitle: (name: string) => string;
  close: string;

  // verdicts
  verdictOk: string;
  verdictDrift: string;
  verdictUnverified: string;
  verdictAccepted: string;
  verdictAbsent: string;
  /** Absent from a shot whose own words name it. */
  verdictLost: string;

  // desk header
  shotsMeta: (seconds: number, shots: number) => string;
  castMeta: (names: string) => string;
  goalMeta: (goal: string) => string;
  partLabel: (id: string) => string;
  wholeGrid: string;
  prompts: string;
  review: string;
  patchSpan: string;
  shootBoard: string;
  shootVideo: string;
  needImagesKey: string;
  needVideoKey: string;
  markSpanFirst: string;

  // flag
  flagHead: (version: number) => string;
  flagBody: (names: string, latest: number) => string;
  reshootAll: string;
  acknowledge: string;
  acknowledged: (version: number) => string;

  // player
  shotSpan: (shot: number, from: string, to: string) => string;
  keysHint: string;
  driftHud: (shot: number, name: string) => string;
  noClipTitle: string;
  noClipBody: (stage: EpisodeStage) => string;
  boardOnScreen: string;
  laneBoard: string;
  laneClip: string;
  play: string;
  pause: string;

  // takes & cost
  takesTitle: string;
  takeMeta: (resolution: string, cost: string | null, drift: number) => string;
  takeLabel: (n: number) => string;
  finalCut: string;
  /** A re-shoot that the final cut splices in. */
  spliced: string;
  old: string;
  patchLabel: (a: number, b: number) => string;
  submitted: (seconds: number) => string;
  generating: string;
  failed: string;
  useTake: string;
  costTitle: string;
  costBoards: (n: number) => string;
  costPanels: (n: number) => string;
  costTakes: (n: number) => string;
  costPatches: (n: number) => string;
  costTotal: string;
  costNote: string;
  unpriced: (n: number) => string;
  /** A failed call's billing, beside its reason: `unknown` (counted) or `none` (provably never sent). */
  billingUnknown: string;
  billingNone: string;
  /** Calls that failed with billing unknown — craft's `uncertain` list. */
  uncertainTitle: (n: number) => string;
  uncertainNote: string;
  /** An earlier attempt of the same asset (craft's `id#n`). */
  attempt: (n: number) => string;
  nothingSpent: string;

  // strip
  stripTitle: string;
  stripHint: string;
  staleClip: string;
  staleBoard: string;
  /** Strip annotations: one or two words under a panel. */
  staleClipShort: string;
  staleBoardShort: string;
  redrawing: string;
  patching: (a: number, b: number) => string;
  patchSpanNote: (a: number, b: number, seconds: number, usd: string | null) => string;
  driftBadge: (name: string) => string;
  markedSpan: (from: string, to: string) => string;
  clearMark: string;
  dragRefused: (message: string) => string;

  // detail
  shotTitle: (n: number) => string;
  sfx: string;
  madeFrom: string;
  willUse: string;
  sheetStamp: (name: string, version: number | null) => string;
  boardStamp: (episode: string, n: number) => string;
  redoPanel: string;
  patchShot: string;
  detailHint: string;
  noSfx: string;
  checkTitle: string;
  checkFrames: (times: string) => string;
  checkNotYet: string;
  checkNoTake: string;
  compareSheet: (name: string) => string;
  compareFrames: (take: string, shot: number) => string;
  decide: string;
  acceptDrift: string;
  noShotSelected: string;

  // overlays
  gridTitle: string;
  gridNone: string;
  /** The whole-grid overlay when a part has more than one storyboard. */
  boardsTitle: (n: number) => string;
  wholeGridCount: (n: number) => string;
  boardRedraw: (shot: number, base: string) => string;
  boardNewest: string;
  promptsTitle: string;
  promptsSent: (asset: string) => string;
  promptsPreview: string;
  promptStoryboard: string;
  promptVideo: string;
  promptJimeng: string;
  copy: string;
  copied: string;
  promptsUnavailable: (message: string) => string;

  // overview
  overviewTitle: string;
  colEpisode: string;
  colPlace: string;
  colGoal: string;
  colAbility: string;
  colEnding: string;
  noLog: string;
  castStats: string;
  seasonSpend: string;
  sheetsSpend: string;
  lineupsSpend: string;
  compilationsSpend: string;
  /** Priced calls no sheet, lineup, compilation or episode claims. */
  otherSpend: string;

  // binge
  bingeEmpty: string;
  compileSeason: string;
  noEpisodesTitle: string;
  noEpisodesBody: string;
  bingeOf: (n: number, total: number) => string;
  next: string;
  previous: string;
}

const STAGE_EN: Record<EpisodeStage, string> = {
  draft: "To write",
  planned: "Your call",
  boarded: "Boarded",
  shot: "Shot · unchecked",
  reviewed: "Shot",
  done: "Finished",
};
const STAGE_BUSY_EN: Record<EpisodeStage, string> = {
  draft: "Generating",
  planned: "Boarding",
  boarded: "Shooting",
  shot: "Re-shooting",
  reviewed: "Re-shooting",
  done: "Re-shooting",
};
const STAGE_ZH: Record<EpisodeStage, string> = {
  draft: "待写",
  planned: "等你点头",
  boarded: "故事板好了",
  shot: "已拍 · 未查",
  reviewed: "已拍",
  done: "成片",
};
const STAGE_BUSY_ZH: Record<EpisodeStage, string> = {
  draft: "生成中",
  planned: "故事板中",
  boarded: "拍摄中",
  shot: "补拍中",
  reviewed: "补拍中",
  done: "补拍中",
};

const FIELD_EN: Record<string, string> = {
  look: "Look",
  ability: "Ability",
  personality: "Personality",
  palette: "Palette",
  name: "Name",
  sheet: "Sheet",
  expressions: "Expressions",
  poses: "Poses",
  style: "Style",
  sheetStyle: "Sheet style",
  ratio: "Ratio",
  dialogue: "Dialogue",
  "(removed)": "removed",
};
const FIELD_ZH: Record<string, string> = {
  look: "外形",
  ability: "能力",
  personality: "性格",
  palette: "色板",
  name: "名字",
  sheet: "设定图",
  expressions: "表情",
  poses: "动作",
  style: "风格",
  sheetStyle: "设定图风格",
  ratio: "画幅",
  dialogue: "对白",
  "(removed)": "已删除",
};

const EN: SeriesStrings = {
  loading: "Reading the series…",
  noBibleTitle: "No bible yet",
  noBibleBody:
    "Tell the agent who your leads are — a sentence or two each — or ask it to pitch three pairs. The cast goes on the wall, and every episode is shot against it.",
  bibleBroken: (e) => `bible.json cannot be read: ${e}`,
  projectBroken: (e) => `project.json cannot be read: ${e}`,
  episodeBroken: (id, e) => `${id}: episode.json cannot be read: ${e}`,
  readOnly: "Read only",

  untitled: "Untitled series",
  bibleLocked: (v, day) => `Bible v${v} · locked ${day}`,
  bibleEdited: (v) => `Bible v${v} · unlocked edits`,
  bibleUnlocked: "Bible not locked",
  episodeCount: (n) => `${n} episode${n === 1 ? "" : "s"}`,
  stage: (stage, busy) => (busy ? STAGE_BUSY_EN[stage] : STAGE_EN[stage]),
  stageUnchecked: (n) => `Shot · ${n} unchecked`,
  driftCount: (n) => `${n} drift`,
  newEpisode: "+ New episode",
  estimate: "estimate",
  inFlightIncluded: (usd) => `estimate · incl. ${usd} in flight`,
  binge: "Binge",
  backToDesk: "Back to the desk",
  seasonOverview: "Season",

  wallTitle: "The wall",
  wallHint: "every episode is shot against it",
  kindLabel: (k) => ({ character: "character", group: "group", scene: "scene" })[k],
  lockedChip: (v) => `v${v} locked`,
  editedChip: "unlocked edits",
  unlockedChip: "not locked",
  shotUnderChip: (v, ep, under) => `v${v} · ${ep} on v${under}`,
  fieldLabel: (f) => FIELD_EN[f] ?? f,
  appearances: (n) => `in ${n} episode${n === 1 ? "" : "s"}`,
  noDrift: "0 drift",
  driftAt: (n, ep, shot) => `${n} drift · ${ep} shot ${shot}`,
  textOnly: "text only",
  styleTitle: "Style lock",
  lineupTitle: "Lineup · one scale",
  lineupStale: "older sheets",
  logButton: "Episode log",
  logButtonHint: "place · goal · ability · ending",
  noSheet: "No design sheet yet",
  sheetGenerating: "Drawing sheets",
  sheetFailed: "Sheet failed",
  pickOne: (n) => `Pick one of ${n}`,
  useThis: "Use this one",
  inUse: "in use",
  twoMore: "Two more",
  makeSheets: "Make sheets",
  checkSheets: "Check sheets",
  outdated: "sheet predates the text",
  lockAs: (v) => `Lock v${v}`,
  lockHint: "New episodes are shot by the locked bible",
  editHint: "Click to edit",
  candidatesTitle: (name) => `${name} · sheet candidates`,
  close: "Close",

  verdictOk: "matches",
  verdictDrift: "drifted",
  verdictUnverified: "unchecked",
  verdictAccepted: "accepted",
  verdictAbsent: "not in shot",
  verdictLost: "named, but missing",

  shotsMeta: (s, n) => `${s} s · ${n} shots`,
  castMeta: (names) => `Cast: ${names}`,
  goalMeta: (goal) => `Goal: ${goal}`,
  partLabel: (id) => `Part ${id}`,
  wholeGrid: "Whole grid",
  prompts: "Prompts",
  review: "Check the frames",
  patchSpan: "Re-shoot this span",
  shootBoard: "Shoot the storyboard",
  shootVideo: "Shoot the video",
  needImagesKey: "No OpenRouter key — the prompts are still assembled and can be copied elsewhere",
  needVideoKey: "No fal key — the video prompt is still assembled and can be copied elsewhere",
  markSpanFirst: "Shift-click two shots on the strip to mark a span first",

  flagHead: (v) => `Shot under bible v${v}`,
  flagBody: (names, latest) => `${names} changed to v${latest} after this was shot`,
  reshootAll: "Re-shoot the episode",
  acknowledge: "Got it",
  acknowledged: (v) => `seen v${v}`,

  shotSpan: (shot, from, to) => `Shot ${shot} · ${from}–${to} s`,
  keysHint: "← → shot · space play · shift-click mark a span",
  driftHud: (shot, name) => `Shot ${shot} · ${name} drifted`,
  noClipTitle: "No clip yet",
  noClipBody: (stage) =>
    stage === "draft"
      ? "The shot list is still empty. Tell the agent the episode in one sentence."
      : stage === "planned"
        ? "The shot list is written. Read it, change words, drag seconds — then shoot the storyboard."
        : "The storyboard is ready. When it reads right, shoot the video.",
  boardOnScreen: "storyboard panel",
  laneBoard: "Board",
  laneClip: "Clip",
  play: "Play",
  pause: "Pause",

  takesTitle: "Takes",
  takeMeta: (res, cost, drift) => [res, cost, drift > 0 ? `${drift} drift` : null].filter(Boolean).join(" · "),
  takeLabel: (n) => `Take ${n}`,
  finalCut: "Final cut",
  spliced: "in the cut",
  old: "old",
  patchLabel: (a, b) => (a === b ? `Re-shoot ${a}` : `Re-shoot ${a}–${b}`),
  submitted: (s) => `submitted ${agoEn(s)} ago`,
  generating: "generating",
  failed: "failed",
  useTake: "Use",
  costTitle: "This episode's spend",
  costBoards: (n) => `Storyboard · ${n} candidate${n === 1 ? "" : "s"}`,
  costPanels: (n) => `Redrawn panels · ${n}`,
  costTakes: (n) => `Takes · ${n}`,
  costPatches: (n) => `Re-shoots · ${n}`,
  costTotal: "Total",
  costNote: "A submitted request is billed; cancelling it does not make it free.",
  unpriced: (n) => `${n} call${n === 1 ? "" : "s"} unpriced`,
  billingUnknown: "billing unknown, counted",
  billingNone: "never sent, not billed",
  uncertainTitle: (n) => `Billing uncertain · ${n} call${n === 1 ? "" : "s"}`,
  uncertainNote: "Failed after the request was sent: whether it was charged is not knowable from here, so it stays in the total.",
  attempt: (n) => `attempt ${n}`,
  nothingSpent: "Nothing generated yet.",

  stripTitle: "Shot strip · the storyboard is the timeline",
  stripHint: "width = seconds · click a panel · drag a border to move seconds",
  staleClip: "changed · not re-shot",
  staleBoard: "text changed · not redrawn",
  staleClipShort: "not re-shot",
  staleBoardShort: "not redrawn",
  redrawing: "redrawing",
  patching: (a, b) => (a === b ? `re-shooting ${a}` : `re-shooting ${a}–${b}`),
  patchSpanNote: (a, b, s, usd) =>
    `re-shooting ${a}–${b} · submitted ${agoEn(s)} ago${usd ? ` · ${usd}` : ""} · swapped into the clip when it lands`,
  driftBadge: (name) => `${name} drifted`,
  markedSpan: (from, to) => `Marked ${from}–${to} s`,
  clearMark: "Clear",
  dragRefused: (m) => `Not moved: ${m}`,

  shotTitle: (n) => `Shot ${n}`,
  sfx: "Sound",
  madeFrom: "Made from",
  willUse: "Will use",
  sheetStamp: (name, v) => `${name} sheet${v ? ` v${v}` : ""}`,
  boardStamp: (ep, n) => `Grid ${ep} · candidate ${n}`,
  redoPanel: "Redraw this panel",
  patchShot: "Re-shoot this shot",
  detailHint: "Edited words re-assemble the prompt; a span under 4 s takes its neighbour along",
  noSfx: "no sound cues",
  checkTitle: "Check",
  checkFrames: (times) => `frames ${times} s · the agent against the sheets`,
  checkNotYet: "This take has not been checked frame by frame yet — every shot is unchecked, not fine.",
  checkNoTake: "Nothing to check until there is a clip.",
  compareSheet: (name) => `Sheet · ${name}`,
  compareFrames: (take, shot) => `Frames · ${take} · shot ${shot}`,
  decide: "Your call:",
  acceptDrift: "Accept it as it is",
  noShotSelected: "Click a panel on the strip to see the shot.",

  gridTitle: "The whole grid — exactly what the model received",
  gridNone: "No storyboard yet.",
  boardsTitle: (n) => `Storyboards for this part · ${n} — the one in use is what the video is shot from`,
  wholeGridCount: (n) => `Whole grid · ${n}`,
  boardRedraw: (shot, base) => `shot ${shot} redrawn on ${base}`,
  boardNewest: "newest · not pinned",
  promptsTitle: "Prompts",
  promptsSent: (asset) => `sent · ${asset}`,
  promptsPreview: "preview · not sent yet",
  promptStoryboard: "Storyboard",
  promptVideo: "Video",
  promptJimeng: "Jimeng / Dreamina",
  copy: "Copy",
  copied: "Copied",
  promptsUnavailable: (m) => `The prompt cannot be assembled yet: ${m}`,

  overviewTitle: "The season",
  colEpisode: "Episode",
  colPlace: "Place",
  colGoal: "Goal",
  colAbility: "Ability",
  colEnding: "Ending",
  noLog: "No episode has a log yet.",
  castStats: "Cast",
  seasonSpend: "Season spend",
  sheetsSpend: "Design sheets",
  lineupsSpend: "Lineups",
  compilationsSpend: "Season compilations",
  otherSpend: "Other calls",

  bingeEmpty: "Nothing finished to binge yet.",
  compileSeason: "Export the season",
  noEpisodesTitle: "No episode yet",
  noEpisodesBody: "Tell the agent the next episode in one sentence — a place, a goal, whose ability saves the day. It reads what was already made so the idea is new.",
  bingeOf: (n, total) => `${n} / ${total}`,
  next: "Next",
  previous: "Previous",
};

const ZH: SeriesStrings = {
  loading: "正在读取这个系列…",
  noBibleTitle: "还没有设定集",
  noBibleBody: "跟 agent 说说你的主角是谁——每人一两句就行，或者让它先出三组。角色会钉在设定墙上，每一集都对着它拍。",
  bibleBroken: (e) => `bible.json 读不了：${e}`,
  projectBroken: (e) => `project.json 读不了：${e}`,
  episodeBroken: (id, e) => `${id}：episode.json 读不了：${e}`,
  readOnly: "只读",

  untitled: "未命名系列",
  bibleLocked: (v, day) => `设定 v${v} · 已锁 ${day}`,
  bibleEdited: (v) => `设定 v${v} · 有未锁改动`,
  bibleUnlocked: "设定未锁",
  episodeCount: (n) => `${n} 集`,
  stage: (stage, busy) => (busy ? STAGE_BUSY_ZH[stage] : STAGE_ZH[stage]),
  stageUnchecked: (n) => `已拍 · ${n} 处未查`,
  driftCount: (n) => `${n} 漂移`,
  newEpisode: "+ 新一集",
  estimate: "估算",
  inFlightIncluded: (usd) => `估算 · 含生成中 ${usd}`,
  binge: "连播",
  backToDesk: "回到桌面",
  seasonOverview: "整季",

  wallTitle: "设定墙",
  wallHint: "每集都对着它拍",
  kindLabel: (k) => ({ character: "角色", group: "群体", scene: "场景" })[k],
  lockedChip: (v) => `v${v} 已锁`,
  editedChip: "有未锁改动",
  unlockedChip: "未锁",
  shotUnderChip: (v, ep, under) => `v${v} · ${ep} 按 v${under} 拍`,
  fieldLabel: (f) => FIELD_ZH[f] ?? f,
  appearances: (n) => `出镜 ${n} 集`,
  noDrift: "0 漂移",
  driftAt: (n, ep, shot) => `${n} 漂移 · ${ep} 第 ${shot} 镜`,
  textOnly: "文字设定",
  styleTitle: "风格锁",
  lineupTitle: "同框比例",
  lineupStale: "用的是旧设定图",
  logButton: "已拍记录",
  logButtonHint: "地点 · 目标 · 能力 · 结尾",
  noSheet: "还没有设定图",
  sheetGenerating: "设定图绘制中",
  sheetFailed: "设定图没画出来",
  pickOne: (n) => `${n} 张里挑一张`,
  useThis: "用这张",
  inUse: "在用",
  twoMore: "再来 2 张",
  makeSheets: "出设定图",
  checkSheets: "检查设定图",
  outdated: "设定图早于文字",
  lockAs: (v) => `锁定 v${v}`,
  lockHint: "锁定后，新的一集才按新设定拍",
  editHint: "点一下就能改",
  candidatesTitle: (name) => `${name} · 设定图候选`,
  close: "关闭",

  verdictOk: "对上了",
  verdictDrift: "漂了",
  verdictUnverified: "未查",
  verdictAccepted: "已接受",
  verdictAbsent: "不在镜",
  verdictLost: "写了却没出现",

  shotsMeta: (s, n) => `${s}s · ${n} 格`,
  castMeta: (names) => `出镜：${names}`,
  goalMeta: (goal) => `目标：${goal}`,
  partLabel: (id) => `${id} 段`,
  wholeGrid: "看整张宫格",
  prompts: "提示词",
  review: "抽帧检查",
  patchSpan: "补拍这段",
  shootBoard: "开拍故事板",
  shootVideo: "开拍视频",
  needImagesKey: "没有 OpenRouter key：提示词照样拼好，可以复制到别处去画",
  needVideoKey: "没有 fal key：视频提示词照样拼好，可以复制到别处去拍",
  markSpanFirst: "先在镜头条上按住 Shift 点两格，圈出要补拍的一段",

  flagHead: (v) => `按设定 v${v} 拍`,
  flagBody: (names, latest) => `${names} 在这集拍完后改到了 v${latest}`,
  reshootAll: "整集重拍",
  acknowledge: "知道了",
  acknowledged: (v) => `已知悉 v${v}`,

  shotSpan: (shot, from, to) => `镜头 ${shot} · ${from}–${to}s`,
  keysHint: "← → 换镜 · 空格 播放 · Shift 点格子 选段",
  driftHud: (shot, name) => `镜头 ${shot} · ${name} 漂了`,
  noClipTitle: "还没有成片",
  noClipBody: (stage) =>
    stage === "draft"
      ? "镜头表还空着。用一句话跟 agent 说这一集讲什么。"
      : stage === "planned"
        ? "镜头表写好了。读一遍，改字、拖秒，满意了就开拍故事板。"
        : "故事板好了。看着顺了，就开拍视频。",
  boardOnScreen: "故事板格子",
  laneBoard: "故事板",
  laneClip: "成片",
  play: "播放",
  pause: "暂停",

  takesTitle: "Takes",
  takeMeta: (res, cost, drift) => [res, cost, drift > 0 ? `${drift} 漂移` : null].filter(Boolean).join(" · "),
  takeLabel: (n) => `第 ${n} 条`,
  finalCut: "成片",
  spliced: "已换进成片",
  old: "旧",
  patchLabel: (a, b) => (a === b ? `补拍 ${a}` : `补拍 ${a}–${b}`),
  submitted: (s) => `已提交 ${agoZh(s)}`,
  generating: "生成中",
  failed: "失败",
  useTake: "用这条",
  costTitle: "这一集的花费",
  costBoards: (n) => `故事板 · ${n} 张候选`,
  costPanels: (n) => `重画格子 · ${n} 格`,
  costTakes: (n) => `成片 · ${n} 条`,
  costPatches: (n) => `补拍 · ${n} 段`,
  costTotal: "合计",
  costNote: "已提交的请求照样计费，取消不等于没花钱。",
  unpriced: (n) => `${n} 次调用没有价格`,
  billingUnknown: "扣没扣费不确定，已算进花费",
  billingNone: "请求没发出去，没有扣费",
  uncertainTitle: (n) => `扣费不确定 · ${n} 次调用`,
  uncertainNote: "请求发出之后才失败，在这里没法知道有没有扣费，所以仍算进合计。",
  attempt: (n) => `第 ${n} 次尝试`,
  nothingSpent: "还没生成过东西。",

  stripTitle: "镜头条 · 故事板即时间轴",
  stripHint: "宽度 = 秒数 · 点格子选镜 · 拖格子边界匀秒",
  staleClip: "格子已改 · 未重拍",
  staleBoard: "字已改 · 未重画",
  staleClipShort: "未重拍",
  staleBoardShort: "未重画",
  redrawing: "重画中",
  patching: (a, b) => (a === b ? `补拍中 ${a}` : `补拍中 ${a}–${b}`),
  patchSpanNote: (a, b, s, usd) => `补拍中 ${a}–${b} · 已提交 ${agoZh(s)}${usd ? ` · ${usd}` : ""} · 完成后换进成片`,
  driftBadge: (name) => `${name} 漂了`,
  markedSpan: (from, to) => `已圈 ${from}–${to}s`,
  clearMark: "清除",
  dragRefused: (m) => `没动：${m}`,

  shotTitle: (n) => `镜头 ${n}`,
  sfx: "音效",
  madeFrom: "这一镜用了",
  willUse: "会用到",
  sheetStamp: (name, v) => `${name} 设定图${v ? ` v${v}` : ""}`,
  boardStamp: (ep, n) => `宫格 ${ep} · 候选 ${n}`,
  redoPanel: "重画这一格",
  patchShot: "补拍这一镜",
  detailHint: "改了字会自动重拼提示词；不到 4s 会带上相邻的镜头",
  noSfx: "没写音效",
  checkTitle: "检查",
  checkFrames: (times) => `抽帧 ${times}s · agent 对照设定图`,
  checkNotYet: "这条成片还没抽帧检查——每一镜都是「未查」，不是「没问题」。",
  checkNoTake: "有了成片才能检查。",
  compareSheet: (name) => `设定图 · ${name}`,
  compareFrames: (take, shot) => `成片抽帧 · ${take} · 镜头 ${shot}`,
  decide: "你来定：",
  acceptDrift: "接受，就这样",
  noShotSelected: "点镜头条上的一格，看这一镜。",

  gridTitle: "整张宫格——模型收到的就是这张",
  gridNone: "还没有故事板。",
  boardsTitle: (n) => `这一段的故事板 · ${n} 张——视频按在用的那张拍`,
  wholeGridCount: (n) => `看整张宫格 · ${n} 张`,
  boardRedraw: (shot, base) => `基于 ${base} 重画第 ${shot} 格`,
  boardNewest: "最新一张 · 未固定",
  promptsTitle: "提示词",
  promptsSent: (asset) => `已发出 · ${asset}`,
  promptsPreview: "预览 · 还没发出",
  promptStoryboard: "故事板",
  promptVideo: "视频",
  promptJimeng: "即梦版",
  copy: "复制",
  copied: "已复制",
  promptsUnavailable: (m) => `提示词还拼不出来：${m}`,

  overviewTitle: "整季",
  colEpisode: "集",
  colPlace: "地点",
  colGoal: "目标",
  colAbility: "能力",
  colEnding: "结尾",
  noLog: "还没有哪一集写了已拍记录。",
  castStats: "角色",
  seasonSpend: "整季花费",
  sheetsSpend: "设定图",
  lineupsSpend: "同框比例",
  compilationsSpend: "合集",
  otherSpend: "其他调用",

  bingeEmpty: "还没有拍完的集可以连播。",
  compileSeason: "导出合集",
  noEpisodesTitle: "还没有第一集",
  noEpisodesBody: "用一句话跟 agent 说下一集：在哪、想干嘛、靠谁的能力收场。它会先看已拍记录，避免重复。",
  bingeOf: (n, total) => `${n} / ${total}`,
  next: "下一集",
  previous: "上一集",
};

const TABLES: Record<SeriesLocale, SeriesStrings> = { en: EN, "zh-CN": ZH };

export function resolveLocale(locale: string | undefined): SeriesLocale {
  return locale && locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function seriesStrings(locale: string | undefined): SeriesStrings {
  return TABLES[resolveLocale(locale)];
}

export const SERIES_STRING_TABLES = TABLES;
