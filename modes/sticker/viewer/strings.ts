/**
 * Every word the sticker viewer says, in each language it says it in.
 *
 * Keyed by `props.locale` (the anime-series / sprite precedent): a Chinese
 * agent filling an English panel reads as two products. Deliberately NOT in
 * here:
 * - CONTENT the agent or the user wrote — words, captions, actions, listing
 *   text, the character description.
 * - RULE TEXT from `sticker-state.mjs` — a stale reason, a check row's
 *   detail, a failure reason. It is the same sentence `sticker.mjs` prints
 *   and the agent reads, shown verbatim so the two never disagree.
 * - PROPER NOUNS and ids — `s01`, `s01-take-2`, WeChat, Telegram, LINE.
 */

import type { ArtKind, CheckLevel, ExportItemState, NextStep, StickerStatus } from "../domain.js";
import type { Plate, View } from "./view-model.js";

export type StickerLocale = "en" | "zh-CN" | "ja";

export interface StickerStrings {
  // shell
  loading: string;
  noPackTitle: string;
  noPackBody: string;
  packInvalidTitle: string;
  packInvalidBody: string;
  projectBroken: (error: string) => string;
  readOnly: string;
  notSaved: (error: string) => string;

  // header
  untitled: string;
  stickerCount: (n: number, ready: number) => string;
  view: Record<View, string>;
  viewsLabel: string;
  plate: Record<Plate, string>;
  plateLabel: string;
  next: string;
  nextStep: (step: NextStep) => string;
  makeMissing: string;
  exportCheck: string;
  commandSent: string;

  // sidebar
  character: string;
  noCharacter: string;
  candidatesToPick: (n: number) => string;
  style: string;
  description: string;
  rights: string;
  rightsBasis: (basis: string) => string;
  rightsMissing: string;
  rightsMissingBody: string;
  confirmed: (date: string) => string;
  pack: string;
  platforms: string;
  motion: string;
  motionLine: (size: number, frames: number, ms: number) => string;
  spend: string;
  spendNote: string;
  inFlight: (n: number) => string;
  uncertain: (n: number) => string;
  unpriced: (n: number) => string;
  keys: string;
  falMissing: string;
  openrouterMissing: string;
  art: string;
  artKind: (kind: ArtKind) => string;
  notPicked: string;
  noneYet: string;
  exportsLabel: string;
  checksTally: (pass: number, warn: number, fail: number) => string;

  // cards
  status: (status: StickerStatus, n: number, elapsed: string) => string;
  statusUnknown: string;
  noCaption: string;
  mayBeBilled: string;
  notBilled: string;
  elapsed: (seconds: number) => string;
  openSticker: (number: string, word: string) => string;

  // inspector
  close: string;
  staleHeadline: string;
  pickHeadline: (n: number) => string;
  failedHeadline: string;
  generatingHeadline: (elapsed: string) => string;
  emptyHeadline: string;
  readyHeadline: string;
  billingUnknown: string;
  billingNone: string;
  frame: (i: number, n: number) => string;
  playLoop: string;
  frames: string;
  framesUnsupported: string;
  framesLoading: string;
  framesError: (message: string) => string;
  keepFrames: (kept: number, total: number) => string;
  cut: string;
  takes: string;
  take: (n: number) => string;
  inUse: string;
  useThisTake: string;
  uploaded: string;
  drawn: string;
  takeStale: string;
  text: string;
  field: Record<"word" | "caption" | "emoji" | "action", string>;
  fieldHint: Record<"word" | "caption" | "emoji" | "action", string>;
  emptyValue: string;
  useAsCharacter: string;
  isTheCharacter: string;
  candidates: string;
  sources: string;
  useThisArt: string;
  becomes: string;
  artUnused: string;

  // chat
  chatPreview: string;
  today: string;
  messagePlaceholder: string;
  stickerTray: string;
  trayHint: string;
  chatEmpty: string;

  // submit
  rulesRead: (date: string) => string;
  exportSummary: (counts: Record<ExportItemState, number>) => string;
  exportsStale: (n: number) => string;
  archive: string;
  archiveState: (state: ExportItemState) => string;
  download: string;
  checklist: string;
  needsAttention: (n: number) => string;
  passing: (n: number) => string;
  allPass: string;
  notExportedYet: (n: number) => string;
  shownAt: (percent: number) => string;
  level: Record<CheckLevel, string>;
  rowLabel: (id: string, fallback: string) => string;
  files: string;
  stickersFiles: string;
  platformArt: string;
  exportState: Record<ExportItemState, string>;
  noVp9: string;
  noAlpha: string;
  replay: string;
  plays: (n: number) => string;
  loops: string;
  listing: string;
  required: string;
  optional: string;
  asianWidth: string;
  noPlatforms: string;
}

const elapsedEn = (s: number) => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);
const elapsedZh = (s: number) => (s < 90 ? `${s} 秒` : `${Math.round(s / 60)} 分钟`);
const elapsedJa = (s: number) => (s < 90 ? `${s} 秒` : `${Math.round(s / 60)} 分`);

const ids = (step: NextStep, sep: string) => (step.stickers ?? []).join(sep);

const EN: StickerStrings = {
  loading: "Loading the pack…",
  noPackTitle: "No sticker pack yet",
  noPackBody:
    "Tell the agent whose sticker it is — a photo, your own character, your pet — and who will use it. It writes pack.json, and the stickers appear here on a chat background as they are drawn.",
  packInvalidTitle: "pack.json can't be drawn",
  packInvalidBody: "These fields need fixing first — the agent can do it:",
  projectBroken: (e) => `project.json can't be read (${e}). Statuses below leave it out until it is fixed; only the sticker scripts write that file.`,
  readOnly: "Read-only",
  notSaved: (e) => `Not saved: ${e}`,

  untitled: "Sticker pack",
  stickerCount: (n, ready) => `${n} sticker${n === 1 ? "" : "s"} · ${ready} ready`,
  view: { panel: "Panel", chat: "Chat", submit: "Submit" },
  viewsLabel: "View",
  plate: { light: "Light", dark: "Dark" },
  plateLabel: "Chat background",
  next: "Next",
  nextStep: (step) => {
    switch (step.id) {
      case "rights": return "Record the rights basis";
      case "anchor": return "Pick the character";
      case "character": return "Make the character";
      case "stickers": return "Write the stickers";
      case "generate": return `Make the missing stickers: ${ids(step, ", ")}`;
      case "generating": return `Waiting for ${ids(step, ", ")} to land`;
      case "pick": return `Pick a take for ${ids(step, ", ")}`;
      case "reroll": return `Re-roll the stale stickers: ${ids(step, ", ")}`;
      case "export": return "Export the files";
      case "check": return "Fix the failing checks";
      case "done": return "Ready to submit";
    }
  },
  makeMissing: "Make the missing stickers",
  exportCheck: "Export and check",
  commandSent: "Sent to the agent",

  character: "Character",
  noCharacter: "No character yet",
  candidatesToPick: (n) => `${n} candidate${n === 1 ? "" : "s"} — pick one`,
  style: "Style",
  description: "Description",
  rights: "Rights",
  rightsBasis: (b) =>
    ({ original: "Original character", "own-pet": "Own pet", self: "Self, as a cartoon", "consenting-adult": "Consenting adult", client: "Client's material" })[b] ?? b,
  rightsMissing: "Rights not recorded",
  rightsMissingBody: "Nothing paid runs until the rights basis is written in pack.json.",
  confirmed: (d) => `confirmed ${d}`,
  pack: "Pack",
  platforms: "Platforms",
  motion: "Motion",
  motionLine: (size, frames, ms) => `${size}² · ${frames} frames × ${ms} ms`,
  spend: "Spend",
  spendNote: "GIF prices are estimates — fal reports no usage",
  inFlight: (n) => `${n} in flight`,
  uncertain: (n) => `${n} failed call${n === 1 ? "" : "s"} may have been billed`,
  unpriced: (n) => `${n} unpriced`,
  keys: "Keys",
  falMissing: "No fal key: new takes can't be drawn here. Each prompt still works in ChatGPT, and a GIF you bring back is checked like a drawn one.",
  openrouterMissing: "No OpenRouter key: the character and art can't be drawn here — bring your own images.",
  art: "Art",
  artKind: (k) => ({ portrait: "Portrait", head: "Head", banner: "Banner", "reward-guide": "Reward guide", "reward-thanks": "Reward thanks" })[k],
  notPicked: "not picked",
  noneYet: "none yet",
  exportsLabel: "Exports",
  checksTally: (p, w, f) => [f ? `${f} fail` : null, w ? `${w} warn` : null, `${p} pass`].filter(Boolean).join(" · "),

  status: (status, n, elapsed) =>
    ({
      empty: "No take yet",
      generating: elapsed ? `Generating · ${elapsed}` : "Generating",
      failed: "Failed",
      pick: `${n} take${n === 1 ? "" : "s"} to pick`,
      stale: "Stale",
      ready: "Ready",
    })[status],
  statusUnknown: "Unknown",
  noCaption: "no caption",
  mayBeBilled: "may have been billed",
  notBilled: "not billed",
  elapsed: elapsedEn,
  openSticker: (number, word) => `Open sticker ${number} ${word}`,

  close: "Close",
  staleHeadline: "Stale — re-roll to apply",
  pickHeadline: (n) => `${n} ready take${n === 1 ? "" : "s"} — pick the one this sticker exports`,
  failedHeadline: "Every take failed",
  generatingHeadline: (e) => `Generating for ${e}`,
  emptyHeadline: "No take yet — “Make the missing stickers” asks the agent to draw it",
  readyHeadline: "Ready — matches pack.json",
  billingUnknown: "May have been billed: the provider never confirmed either way.",
  billingNone: "Not billed: the request never left this machine.",
  frame: (i, n) => `Frame ${i} (0–${n - 1})`,
  playLoop: "Play the loop",
  frames: "Frames",
  framesUnsupported: "This browser can't decode GIF frames (no ImageDecoder), so the frame strip is hidden. The take still plays above.",
  framesLoading: "Decoding frames…",
  framesError: (m) => `Couldn't decode the frames: ${m}`,
  keepFrames: (k, t) => `keepFrames keeps ${k} of ${t}`,
  cut: "cut",
  takes: "Takes",
  take: (n) => `Take ${n}`,
  inUse: "In use",
  useThisTake: "Use this take",
  uploaded: "uploaded",
  drawn: "drawn",
  takeStale: "stale",
  text: "Text",
  field: { word: "Word", caption: "Caption", emoji: "Emoji", action: "Action" },
  fieldHint: {
    word: "WeChat's meaning word — up to 4, unique in the set",
    caption: "Drawn into the sticker; empty means no text",
    emoji: "Telegram's emoji — exactly one",
    action: "The motion, in English",
  },
  emptyValue: "empty",
  useAsCharacter: "Use as the character",
  isTheCharacter: "The character",
  candidates: "Candidates",
  sources: "Drawn from",
  useThisArt: "Use this",
  becomes: "Becomes",
  artUnused: "No chosen platform uses this art.",

  chatPreview: "Chat preview",
  today: "Today",
  messagePlaceholder: "Message",
  stickerTray: "Stickers",
  trayHint: "Tap a sticker to send it",
  chatEmpty: "No sticker is ready to send yet.",

  rulesRead: (d) => `Rules read ${d}`,
  exportSummary: (c) =>
    [c.current ? `${c.current} current` : null, c.stale ? `${c.stale} stale` : null, c.missing ? `${c.missing} not exported` : null, c.blocked ? `${c.blocked} waiting` : null]
      .filter(Boolean)
      .join(" · ") || "nothing to export",
  exportsStale: (n) => `${n} file${n === 1 ? " is" : "s are"} stale or not exported — export again before submitting.`,
  archive: "Upload archive",
  archiveState: (s) => ({ current: "ready", stale: "stale", missing: "not made yet", blocked: "waits for every file" })[s],
  download: "Download",
  checklist: "Checklist",
  needsAttention: (n) => `Needs attention · ${n}`,
  passing: (n) => `Passing · ${n}`,
  allPass: "Every check passes — the archive is ready to upload.",
  notExportedYet: (n) => `Not exported yet · ${n}`,
  shownAt: (p) => `shown at ${p}%`,
  level: { pass: "pass", warn: "warning", fail: "fail" },
  rowLabel: (id, fallback) =>
    ({
      rights: "Rights",
      platform: "Platform",
      count: "Sticker count",
      "all-animated": "All animated",
      words: "Meaning words",
      emoji: "Emoji",
      zip: "Upload archive",
      "reward-thumb": "Reward thumbnail",
      "zip-naming": "ZIP file names",
    })[id] ?? fallback,
  files: "Files",
  stickersFiles: "Stickers",
  platformArt: "Platform art",
  exportState: { current: "current", stale: "stale", missing: "not exported", blocked: "waiting" },
  noVp9: "This browser can't play WebM VP9 — open the pack in Chrome, Firefox or Telegram.",
  noAlpha: "This browser drops the WebM's transparency and shows it on black. The file is transparent — Chrome and Telegram show it right.",
  replay: "Replay",
  plays: (n) => `plays ${n}×`,
  loops: "loops",
  listing: "Listing",
  required: "required",
  optional: "optional",
  asianWidth: "CJK characters count 2",
  noPlatforms: "The pack names no platform yet.",
};

const ZH: StickerStrings = {
  loading: "正在读取表情包…",
  noPackTitle: "还没有表情包",
  noPackBody: "跟 agent 说说这套表情画谁——一张照片、你自己的角色，或是家里的宠物——以及做给谁用。它会写好 pack.json，表情一张张画出来，就会出现在这里的聊天背景上。",
  packInvalidTitle: "pack.json 读不出来",
  packInvalidBody: "先把下面这些字段改对（可以让 agent 来改）：",
  projectBroken: (e) => `project.json 读不出来（${e}）。在修好之前，下面的状态都没算上它；这个文件只由表情脚本写入。`,
  readOnly: "只读",
  notSaved: (e) => `没有保存：${e}`,

  untitled: "表情包",
  stickerCount: (n, ready) => `${n} 张 · ${ready} 张就绪`,
  view: { panel: "面板", chat: "聊天", submit: "提交" },
  viewsLabel: "视图",
  plate: { light: "浅色", dark: "深色" },
  plateLabel: "聊天背景",
  next: "下一步",
  nextStep: (step) => {
    switch (step.id) {
      case "rights": return "先登记版权依据";
      case "anchor": return "选定角色";
      case "character": return "先画出角色";
      case "stickers": return "写好每张表情";
      case "generate": return `补齐还没出图的：${ids(step, "、")}`;
      case "generating": return `等 ${ids(step, "、")} 出图`;
      case "pick": return `给 ${ids(step, "、")} 选一版`;
      case "reroll": return `重画这几张：${ids(step, "、")}`;
      case "export": return "导出文件";
      case "check": return "处理没通过的检查项";
      case "done": return "可以提交了";
    }
  },
  makeMissing: "补齐没出图的表情",
  exportCheck: "导出并检查",
  commandSent: "已发给 agent",

  character: "角色",
  noCharacter: "还没有角色",
  candidatesToPick: (n) => `${n} 个候选，选一个`,
  style: "画风",
  description: "角色描述",
  rights: "版权",
  rightsBasis: (b) =>
    ({ original: "原创角色", "own-pet": "自家宠物", self: "本人的卡通形象", "consenting-adult": "已获本人同意", client: "客户授权素材" })[b] ?? b,
  rightsMissing: "版权依据还没登记",
  rightsMissingBody: "pack.json 里写好版权依据之前，任何付费步骤都不会运行。",
  confirmed: (d) => `${d} 确认`,
  pack: "整套",
  platforms: "平台",
  motion: "动画",
  motionLine: (size, frames, ms) => `${size}² · ${frames} 帧 × ${ms} 毫秒`,
  spend: "花费",
  spendNote: "GIF 的价格是估算——fal 不返回用量",
  inFlight: (n) => `${n} 个在生成`,
  uncertain: (n) => `${n} 次失败的调用可能已扣费`,
  unpriced: (n) => `${n} 次未计价`,
  keys: "密钥",
  falMissing: "没有 fal 密钥：这里画不了新的表情。每张的提示词照样能拿去 ChatGPT 用，带回来的 GIF 会和这里画的一样记录、检查。",
  openrouterMissing: "没有 OpenRouter 密钥：这里画不了角色和配图，可以用你自己的图。",
  art: "配图",
  artKind: (k) => ({ portrait: "半身像", head: "头像", banner: "横幅", "reward-guide": "赞赏引导图", "reward-thanks": "赞赏致谢图" })[k],
  notPicked: "还没选",
  noneYet: "还没有",
  exportsLabel: "导出",
  checksTally: (p, w, f) => [f ? `${f} 项未通过` : null, w ? `${w} 项提醒` : null, `${p} 项通过`].filter(Boolean).join(" · "),

  status: (status, n, elapsed) =>
    ({
      empty: "还没出图",
      generating: elapsed ? `生成中 · ${elapsed}` : "生成中",
      failed: "失败",
      pick: `${n} 版待选`,
      stale: "待重画",
      ready: "已就绪",
    })[status],
  statusUnknown: "状态未知",
  noCaption: "无配字",
  mayBeBilled: "可能已扣费",
  notBilled: "未扣费",
  elapsed: elapsedZh,
  openSticker: (number, word) => `打开第 ${number} 张 ${word}`,

  close: "关闭",
  staleHeadline: "已和 pack.json 对不上——重画后才会生效",
  pickHeadline: (n) => `有 ${n} 版可用——选一版作为导出用图`,
  failedHeadline: "每一版都失败了",
  generatingHeadline: (e) => `已生成 ${e}`,
  emptyHeadline: "还没出图——点“补齐没出图的表情”，agent 会去画",
  readyHeadline: "已就绪，和 pack.json 一致",
  billingUnknown: "可能已扣费：服务商没有确认是否收费。",
  billingNone: "未扣费：请求没有发出这台机器。",
  frame: (i, n) => `第 ${i} 帧（0–${n - 1}）`,
  playLoop: "播放整段",
  frames: "逐帧",
  framesUnsupported: "这个浏览器无法逐帧解码 GIF（没有 ImageDecoder），所以不显示逐帧条；上面的动画照常播放。",
  framesLoading: "正在解码…",
  framesError: (m) => `逐帧解码失败：${m}`,
  keepFrames: (k, t) => `keepFrames 保留 ${t} 帧中的 ${k} 帧`,
  cut: "剪掉",
  takes: "各版",
  take: (n) => `第 ${n} 版`,
  inUse: "在用",
  useThisTake: "用这一版",
  uploaded: "上传",
  drawn: "生成",
  takeStale: "待重画",
  text: "文字",
  field: { word: "含义词", caption: "配字", emoji: "Emoji", action: "动作" },
  fieldHint: {
    word: "微信的含义词，最多 4 个字，整套不能重复",
    caption: "会画进表情里；留空就是不带字",
    emoji: "Telegram 要求的 emoji，只能一个",
    action: "动作描述，用英文写",
  },
  emptyValue: "空",
  useAsCharacter: "用作角色",
  isTheCharacter: "当前角色",
  candidates: "候选",
  sources: "参考图",
  useThisArt: "用这张",
  becomes: "用于",
  artUnused: "选定的平台都用不到这张配图。",

  chatPreview: "聊天预览",
  today: "今天",
  messagePlaceholder: "发消息",
  stickerTray: "表情",
  trayHint: "点一下表情就能发出去",
  chatEmpty: "还没有能发的表情。",

  rulesRead: (d) => `规范读取于 ${d}`,
  exportSummary: (c) =>
    [c.current ? `${c.current} 个已是最新` : null, c.stale ? `${c.stale} 个已过期` : null, c.missing ? `${c.missing} 个未导出` : null, c.blocked ? `${c.blocked} 个在等素材` : null]
      .filter(Boolean)
      .join(" · ") || "没有要导出的",
  exportsStale: (n) => `${n} 个文件过期或还没导出——提交前请重新导出。`,
  archive: "上传压缩包",
  archiveState: (s) => ({ current: "已就绪", stale: "已过期", missing: "还没生成", blocked: "等所有文件就绪" })[s],
  download: "下载",
  checklist: "检查清单",
  needsAttention: (n) => `需要处理 · ${n}`,
  passing: (n) => `已通过 · ${n}`,
  allPass: "所有检查都通过了，压缩包可以直接上传。",
  notExportedYet: (n) => `还没导出 · ${n}`,
  shownAt: (p) => `按 ${p}% 显示`,
  level: { pass: "通过", warn: "提醒", fail: "未通过" },
  rowLabel: (id, fallback) =>
    ({
      rights: "版权",
      platform: "平台",
      count: "表情数量",
      "all-animated": "全部为动图",
      words: "含义词",
      emoji: "Emoji",
      zip: "上传压缩包",
      "reward-thumb": "赞赏缩略图",
      "zip-naming": "压缩包内文件名",
    })[id] ?? fallback,
  files: "导出文件",
  stickersFiles: "表情",
  platformArt: "平台配图",
  exportState: { current: "最新", stale: "已过期", missing: "未导出", blocked: "等素材" },
  noVp9: "这个浏览器播放不了 WebM VP9——请用 Chrome、Firefox 或 Telegram 打开。",
  noAlpha: "这个浏览器会丢掉 WebM 的透明通道，显示成黑底。文件本身是透明的，Chrome 和 Telegram 里显示正常。",
  replay: "重播",
  plays: (n) => `播放 ${n} 次`,
  loops: "循环播放",
  listing: "上架文案",
  required: "必填",
  optional: "选填",
  asianWidth: "中日韩文字按 2 个字符计",
  noPlatforms: "这套表情还没有指定平台。",
};

const JA: StickerStrings = {
  loading: "スタンプを読み込み中…",
  noPackTitle: "スタンプはまだありません",
  noPackBody: "誰のスタンプか —— 写真、自分のキャラクター、ペット —— と、誰が使うのかを agent に伝えてください。pack.json が書かれ、描けたスタンプから順にここのチャット背景に並びます。",
  packInvalidTitle: "pack.json を表示できません",
  packInvalidBody: "先に次の項目を直してください（agent に頼めます）：",
  projectBroken: (e) => `project.json を読めません（${e}）。直るまで、下の状態はこのファイルを除いて計算しています。このファイルを書くのはスタンプのスクリプトだけです。`,
  readOnly: "閲覧のみ",
  notSaved: (e) => `保存されませんでした：${e}`,

  untitled: "スタンプ",
  stickerCount: (n, ready) => `${n} 枚 · 完成 ${ready} 枚`,
  view: { panel: "パネル", chat: "チャット", submit: "申請" },
  viewsLabel: "表示",
  plate: { light: "ライト", dark: "ダーク" },
  plateLabel: "チャット背景",
  next: "次",
  nextStep: (step) => {
    switch (step.id) {
      case "rights": return "権利の根拠を記録する";
      case "anchor": return "キャラクターを選ぶ";
      case "character": return "キャラクターを作る";
      case "stickers": return "スタンプの内容を書く";
      case "generate": return `足りないスタンプを作る：${ids(step, "、")}`;
      case "generating": return `${ids(step, "、")} の完成待ち`;
      case "pick": return `${ids(step, "、")} のテイクを選ぶ`;
      case "reroll": return `描き直しが必要：${ids(step, "、")}`;
      case "export": return "ファイルを書き出す";
      case "check": return "通らなかったチェックを直す";
      case "done": return "申請できます";
    }
  },
  makeMissing: "足りないスタンプを作る",
  exportCheck: "書き出してチェック",
  commandSent: "agent に送りました",

  character: "キャラクター",
  noCharacter: "キャラクターはまだありません",
  candidatesToPick: (n) => `候補 ${n} 件 —— 1 つ選んでください`,
  style: "スタイル",
  description: "説明",
  rights: "権利",
  rightsBasis: (b) =>
    ({ original: "オリジナルキャラクター", "own-pet": "自分のペット", self: "本人のキャラクター化", "consenting-adult": "本人の同意あり", client: "クライアント提供素材" })[b] ?? b,
  rightsMissing: "権利の根拠が未記録",
  rightsMissingBody: "pack.json に権利の根拠を書くまで、有料の処理は一切動きません。",
  confirmed: (d) => `${d} 確認`,
  pack: "セット",
  platforms: "プラットフォーム",
  motion: "アニメーション",
  motionLine: (size, frames, ms) => `${size}² · ${frames} フレーム × ${ms} ms`,
  spend: "費用",
  spendNote: "GIF の価格は見積もり（fal は使用量を返しません）",
  inFlight: (n) => `${n} 件生成中`,
  uncertain: (n) => `失敗した ${n} 件は課金された可能性あり`,
  unpriced: (n) => `${n} 件は価格不明`,
  keys: "キー",
  falMissing: "fal のキーがありません：ここでは新しいテイクを描けません。プロンプトは ChatGPT でそのまま使え、持ち帰った GIF も同じように記録・チェックされます。",
  openrouterMissing: "OpenRouter のキーがありません：キャラクターとアートはここでは描けないので、手持ちの画像を使ってください。",
  art: "アート",
  artKind: (k) => ({ portrait: "バストアップ", head: "顔アップ", banner: "バナー", "reward-guide": "投げ銭の案内画像", "reward-thanks": "投げ銭のお礼画像" })[k],
  notPicked: "未選択",
  noneYet: "まだありません",
  exportsLabel: "書き出し",
  checksTally: (p, w, f) => [f ? `不合格 ${f}` : null, w ? `注意 ${w}` : null, `合格 ${p}`].filter(Boolean).join(" · "),

  status: (status, n, elapsed) =>
    ({
      empty: "テイクなし",
      generating: elapsed ? `生成中 · ${elapsed}` : "生成中",
      failed: "失敗",
      pick: `${n} テイクから選択`,
      stale: "要描き直し",
      ready: "完成",
    })[status],
  statusUnknown: "状態不明",
  noCaption: "文字なし",
  mayBeBilled: "課金された可能性あり",
  notBilled: "課金なし",
  elapsed: elapsedJa,
  openSticker: (number, word) => `スタンプ ${number} ${word} を開く`,

  close: "閉じる",
  staleHeadline: "pack.json と合っていません —— 描き直すと反映されます",
  pickHeadline: (n) => `使えるテイクが ${n} 件 —— 書き出しに使う 1 件を選んでください`,
  failedHeadline: "すべてのテイクが失敗しました",
  generatingHeadline: (e) => `生成を始めて ${e}`,
  emptyHeadline: "テイクはまだありません ——「足りないスタンプを作る」で agent が描きます",
  readyHeadline: "完成 —— pack.json と一致しています",
  billingUnknown: "課金された可能性あり：プロバイダーからどちらとも確認できていません。",
  billingNone: "課金なし：リクエストはこのマシンから出ていません。",
  frame: (i, n) => `フレーム ${i}（0–${n - 1}）`,
  playLoop: "ループ再生",
  frames: "フレーム",
  framesUnsupported: "このブラウザは GIF をフレームごとに展開できない（ImageDecoder なし）ため、フレーム一覧は表示しません。上のアニメーションはそのまま再生されます。",
  framesLoading: "フレームを展開中…",
  framesError: (m) => `フレームを展開できませんでした：${m}`,
  keepFrames: (k, t) => `keepFrames：${t} フレーム中 ${k} を使用`,
  cut: "カット",
  takes: "テイク",
  take: (n) => `テイク ${n}`,
  inUse: "使用中",
  useThisTake: "このテイクを使う",
  uploaded: "アップロード",
  drawn: "生成",
  takeStale: "要描き直し",
  text: "テキスト",
  field: { word: "意味語", caption: "文字", emoji: "絵文字", action: "動き" },
  fieldHint: {
    word: "WeChat の意味語 —— 4 文字まで、セット内で重複なし",
    caption: "スタンプに描き込まれます。空なら文字なし",
    emoji: "Telegram の絵文字 —— 1 つだけ",
    action: "動きの説明（英語）",
  },
  emptyValue: "空",
  useAsCharacter: "キャラクターにする",
  isTheCharacter: "現在のキャラクター",
  candidates: "候補",
  sources: "元画像",
  useThisArt: "これを使う",
  becomes: "使われる先",
  artUnused: "選んだプラットフォームではこのアートを使いません。",

  chatPreview: "チャットプレビュー",
  today: "今日",
  messagePlaceholder: "メッセージ",
  stickerTray: "スタンプ",
  trayHint: "タップすると送信します",
  chatEmpty: "送れるスタンプはまだありません。",

  rulesRead: (d) => `規定の確認日 ${d}`,
  exportSummary: (c) =>
    [c.current ? `最新 ${c.current}` : null, c.stale ? `古い ${c.stale}` : null, c.missing ? `未書き出し ${c.missing}` : null, c.blocked ? `素材待ち ${c.blocked}` : null]
      .filter(Boolean)
      .join(" · ") || "書き出すものはありません",
  exportsStale: (n) => `${n} 件のファイルが古いか未書き出しです —— 申請前に書き出し直してください。`,
  archive: "アップロード用 ZIP",
  archiveState: (s) => ({ current: "準備完了", stale: "古い", missing: "未作成", blocked: "全ファイル待ち" })[s],
  download: "ダウンロード",
  checklist: "チェックリスト",
  needsAttention: (n) => `対応が必要 · ${n}`,
  passing: (n) => `合格 · ${n}`,
  allPass: "すべてのチェックに合格しました。ZIP はそのままアップロードできます。",
  notExportedYet: (n) => `未書き出し · ${n}`,
  shownAt: (p) => `${p}% で表示`,
  level: { pass: "合格", warn: "注意", fail: "不合格" },
  rowLabel: (id, fallback) =>
    ({
      rights: "権利",
      platform: "プラットフォーム",
      count: "スタンプ数",
      "all-animated": "すべてアニメーション",
      words: "意味語",
      emoji: "絵文字",
      zip: "アップロード用 ZIP",
      "reward-thumb": "投げ銭のサムネイル",
      "zip-naming": "ZIP 内のファイル名",
    })[id] ?? fallback,
  files: "書き出しファイル",
  stickersFiles: "スタンプ",
  platformArt: "プラットフォーム用アート",
  exportState: { current: "最新", stale: "古い", missing: "未書き出し", blocked: "素材待ち" },
  noVp9: "このブラウザは WebM VP9 を再生できません —— Chrome、Firefox、Telegram で開いてください。",
  noAlpha: "このブラウザは WebM の透過を無視して黒背景で表示します。ファイル自体は透過で、Chrome や Telegram では正しく表示されます。",
  replay: "もう一度",
  plays: (n) => `${n} 回再生`,
  loops: "ループ",
  listing: "登録テキスト",
  required: "必須",
  optional: "任意",
  asianWidth: "全角文字は 2 文字として数えます",
  noPlatforms: "プラットフォームがまだ指定されていません。",
};

const TABLES: Record<StickerLocale, StickerStrings> = { en: EN, "zh-CN": ZH, ja: JA };

export function resolveLocale(locale: string | undefined): StickerLocale {
  const l = (locale ?? "").toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("ja")) return "ja";
  return "en";
}

export function stickerStrings(locale: string | undefined): StickerStrings {
  return TABLES[resolveLocale(locale)];
}

export const STICKER_STRING_TABLES = TABLES;
