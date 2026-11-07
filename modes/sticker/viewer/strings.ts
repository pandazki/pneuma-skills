/**
 * Every word the sticker viewer says, in each language it says it in.
 *
 * Keyed by `props.locale` (the anime-series / sprite precedent): a Chinese
 * agent filling an English panel reads as two products.
 *
 * RULES SPEAK IN CODES. A stale reason, a sticker's or export's reason, a
 * checklist row's detail and the next step arrive from `sticker-state.mjs`
 * as `{ code, params, command? }`; `say` formats one here, in the user's
 * language. Formatting only: which rule applies, and with what numbers, is
 * the module's answer — nothing here decides a status or a level. `say`
 * gives the meaning; a `command` (`sticker.mjs export …`) is the caller's to
 * show, and only where someone can act on it (never read-only).
 *
 * Deliberately NOT in here:
 * - CONTENT the agent or the user wrote — words, captions, actions, listing
 *   text, the character description.
 * - EXTERNAL TEXT — a provider's failure reason, a parser error naming a
 *   pack.json field: shown as they came.
 * - PROPER NOUNS and ids — `s01`, `s01-take-2`, WeChat, Telegram, LINE.
 */

import type { ArtKind, CheckLevel, ExportItemState, MessageCode, MessageParams, Platform, StateMessage, StickerStatus } from "../domain.js";
import { PLATFORM_PROFILES } from "../skill/scripts/sticker-state.mjs";
import type { Plate, View } from "./view-model.js";

export type StickerLocale = "en" | "zh-CN" | "ja";

/** Formats a rule's message — its meaning, in this language. */
export type Say = (message: StateMessage) => string;

export interface StickerStrings {
  /** A message from sticker-state.mjs in this language (the command, if any, is not included). */
  say: Say;

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
  /** `ready` is null while project.json cannot be read. */
  stickerCount: (n: number, ready: number | null) => string;
  view: Record<View, string>;
  viewsLabel: string;
  plate: Record<Plate, string>;
  plateLabel: string;
  next: string;
  makeMissing: string;
  exportCheck: string;
  commandSent: string;

  // sidebar
  character: string;
  noCharacter: string;
  /** project.json cannot be read: the sidebar, art rows and submit checks say so instead of guessing. */
  unread: string;
  unreadSpend: string;
  unreadChecksTitle: string;
  unreadChecksBody: string;
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
  /** Read-only: no command to point at. */
  emptyHeadlineQuiet: string;
  /** A failed sticker a plain gen leaves: its last call may have been billed. Names no command (read-only shows it too). */
  genLeftUncertain: string;
  /** A failed sticker a plain gen retries: its last call never left. */
  genRetries: string;
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
  archiveFiles: (n: number) => string;
  archiveState: (state: ExportItemState) => string;
  download: string;
  downloadFailed: (error: string) => string;
  checklist: string;
  needsAttention: (n: number) => string;
  passing: (n: number) => string;
  allPass: string;
  notExportedYet: (n: number) => string;
  shownAt: (percent: number) => string;
  level: Record<CheckLevel, string>;
  /** A checklist row's name: the platform's own term for a deliverable or listing field; a sticker row keeps its number. */
  rowLabel: (platform: Platform, row: { id: string; label: string }) => string;
  /** An exported file other than a sticker (cover, icon, banner, thumb, main, tab, reward art). */
  deliverableLabel: (platform: Platform, deliverable: string) => string;
  /** A listing text field. */
  listingLabel: (platform: Platform, field: string) => string;
  noStickers: string;
  /** The link text for one of a platform's official pages. */
  sourceLabel: (source: { url: string; what: string }) => string;
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

// ── Platform terms ─────────────────────────────────────────────────────────
//
// Checklist rows, exported files and listing fields named the way each
// language's user meets them. WeChat's console is Chinese, so its terms keep
// the Chinese name beside the English or Japanese one; the keys are the
// profiles' own (PLATFORM_PROFILES deliverables and text fields).

type Chrome = Omit<StickerStrings, "say">;
type PlatformTerms = Record<Platform, Record<string, string>>;

/** Rows that are neither a sticker, a deliverable nor a listing field. */
const ROW_IDS = ["rights", "platform", "count", "all-animated", "words", "emoji", "zip", "reward-thumb", "zip-naming"] as const;
type RowTerms = Record<(typeof ROW_IDS)[number], string>;

/**
 * The official pages each profile cites, by URL. English keeps the
 * profile's own description; a long one shows the host.
 */
type SourceTerms = Record<string, string>;
const SOURCES_ZH: SourceTerms = {
  "https://sticker.weixin.qq.com/": "微信表情开放平台",
  "https://core.telegram.org/stickers": "贴纸要求",
  "https://core.telegram.org/stickers/webm-vp9-encoding": "视频贴纸编码",
  "https://core.telegram.org/stickers/import-stickers": "套组限制",
  "https://core.telegram.org/bots/api": "Bot API 10.3",
  "https://creator.line.me/en/guideline/animationsticker/": "动态贴图规范",
  "https://creator.line.me/en/guideline/sticker/": "贴图文字与套组规范",
};
const SOURCES_JA: SourceTerms = {
  "https://sticker.weixin.qq.com/": "WeChat スタンプ公式サイト",
  "https://core.telegram.org/stickers": "スタンプの要件",
  "https://core.telegram.org/stickers/webm-vp9-encoding": "動画スタンプのエンコード",
  "https://core.telegram.org/stickers/import-stickers": "セットの上限",
  "https://core.telegram.org/bots/api": "Bot API 10.3",
  "https://creator.line.me/en/guideline/animationsticker/": "アニメーションスタンプのガイドライン",
  "https://creator.line.me/en/guideline/sticker/": "スタンプの文字とセットのガイドライン",
};
const sourceIn = (terms: SourceTerms | null) => (source: { url: string; what: string }) =>
  terms?.[source.url] ?? (source.what.length > 48 ? new URL(source.url).host : source.what);

function labels(rows: RowTerms, deliverables: PlatformTerms, listing: PlatformTerms): Pick<Chrome, "rowLabel" | "deliverableLabel" | "listingLabel"> {
  const deliverableLabel = (platform: Platform, name: string) => deliverables[platform]?.[name] ?? PLATFORM_PROFILES[platform]?.deliverables[name]?.label ?? name;
  const listingLabel = (platform: Platform, field: string) => listing[platform]?.[field] ?? PLATFORM_PROFILES[platform]?.text[field]?.label ?? field;
  return {
    deliverableLabel,
    listingLabel,
    rowLabel: (platform, row) => {
      if (row.id.startsWith("sticker-")) return row.label;
      if (row.id.startsWith("listing-")) return listingLabel(platform, row.id.slice("listing-".length));
      if (row.id in (PLATFORM_PROFILES[platform]?.deliverables ?? {})) return deliverableLabel(platform, row.id);
      return (rows as Record<string, string>)[row.id] ?? row.label;
    },
  };
}

const ROW_EN: RowTerms = {
  rights: "Rights",
  platform: "Platform",
  count: "Sticker count",
  "all-animated": "All animated",
  words: "Meaning words",
  emoji: "Emoji",
  zip: "Upload archive",
  "reward-thumb": "Reward thumbnail",
  "zip-naming": "ZIP file names",
};
const ROW_ZH: RowTerms = {
  rights: "版权",
  platform: "平台",
  count: "表情数量",
  "all-animated": "全部为动图",
  words: "含义词",
  emoji: "Emoji",
  zip: "上传压缩包",
  "reward-thumb": "赞赏缩略图",
  "zip-naming": "压缩包内文件名",
};
const ROW_JA: RowTerms = {
  rights: "権利",
  platform: "プラットフォーム",
  count: "スタンプ数",
  "all-animated": "すべてアニメーション",
  words: "意味語",
  emoji: "絵文字",
  zip: "アップロード用 ZIP",
  "reward-thumb": "投げ銭のサムネイル",
  "zip-naming": "ZIP 内のファイル名",
};

const DELIVERABLES_EN: PlatformTerms = {
  wechat: { cover: "表情封面图 cover", icon: "聊天页图标 chat icon", banner: "详情页横幅 banner", "reward-guide": "赞赏引导图 reward guide", "reward-thanks": "赞赏致谢图 reward thanks" },
  telegram: { thumb: "Set thumbnail" },
  line: { main: "Main image", tab: "Chat tab image" },
};
const DELIVERABLES_ZH: PlatformTerms = {
  wechat: { cover: "表情封面图", icon: "聊天页图标", banner: "详情页横幅", "reward-guide": "赞赏引导图", "reward-thanks": "赞赏致谢图" },
  telegram: { thumb: "贴纸包缩略图" },
  line: { main: "主图", tab: "聊天室标签图" },
};
const DELIVERABLES_JA: PlatformTerms = {
  wechat: { cover: "カバー画像（表情封面图）", icon: "チャットアイコン（聊天页图标）", banner: "詳細バナー（详情页横幅）", "reward-guide": "投げ銭の案内画像（赞赏引导图）", "reward-thanks": "投げ銭のお礼画像（赞赏致谢图）" },
  telegram: { thumb: "セットのサムネイル" },
  line: { main: "メイン画像", tab: "トークルームタブ画像" },
};

const LISTING_EN: PlatformTerms = {
  wechat: { name: "表情名称 name", intro: "表情介绍 intro", copyright: "版权 copyright", rewardLine: "赞赏引导语 reward line" },
  telegram: { title: "Set title", shortName: "Short name (link)" },
  line: { title: "Title", creator: "Creator", description: "Description", copyright: "Copyright" },
};
const LISTING_ZH: PlatformTerms = {
  wechat: { name: "表情名称", intro: "表情介绍", copyright: "版权", rewardLine: "赞赏引导语" },
  telegram: { title: "贴纸包标题", shortName: "短名称（链接用）" },
  line: { title: "标题", creator: "创作者", description: "简介", copyright: "版权" },
};
const LISTING_JA: PlatformTerms = {
  wechat: { name: "スタンプ名（表情名称）", intro: "紹介文（表情介绍）", copyright: "著作権表示（版权）", rewardLine: "投げ銭の案内文（赞赏引导语）" },
  telegram: { title: "セットのタイトル", shortName: "短縮名（リンク用）" },
  line: { title: "タイトル", creator: "クリエイター名", description: "説明文", copyright: "コピーライト" },
};

const EN: Chrome = {
  loading: "Loading the pack…",
  noPackTitle: "No sticker pack yet",
  noPackBody:
    "Tell the agent whose sticker it is — a photo, your own character, your pet — and who will use it. It writes pack.json, and the stickers appear here on a chat background as they are drawn.",
  packInvalidTitle: "pack.json can't be drawn",
  packInvalidBody: "These fields need fixing first — the agent can do it:",
  projectBroken: (e) => `project.json can't be read (${e}). Statuses, spend and checks are unknown until it is fixed; only the sticker scripts write that file.`,
  readOnly: "Read-only",
  notSaved: (e) => `Not saved: ${e}`,

  untitled: "Sticker pack",
  stickerCount: (n, ready) => `${n} sticker${n === 1 ? "" : "s"}${ready === null ? "" : ` · ${ready} ready`}`,
  view: { panel: "Panel", chat: "Chat", submit: "Submit" },
  viewsLabel: "View",
  plate: { light: "Light", dark: "Dark" },
  plateLabel: "Chat background",
  next: "Next",
  makeMissing: "Make the missing stickers",
  exportCheck: "Export and check",
  commandSent: "Sent to the agent",

  character: "Character",
  noCharacter: "No character yet",
  unread: "Unknown — project.json can't be read",
  unreadSpend: "unknown until project.json can be read",
  unreadChecksTitle: "Checks wait for project.json",
  unreadChecksBody: "Every take and exported file is recorded in project.json, which can't be read right now. The listing lives in pack.json and is shown below.",
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
  emptyHeadlineQuiet: "No take yet",
  genLeftUncertain: "Not redrawn automatically: the last try may already have been billed, so a retry needs an explicit yes.",
  genRetries: "The request never left, so it is drawn again with the other missing stickers.",
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
  archiveFiles: (n) => `${n} file${n === 1 ? "" : "s"}`,
  archiveState: (s) => ({ current: "ready", stale: "stale", missing: "not made yet", blocked: "waits for every file" })[s],
  download: "Download",
  downloadFailed: (e) => `Download failed: ${e}`,
  checklist: "Checklist",
  needsAttention: (n) => `Needs attention · ${n}`,
  passing: (n) => `Passing · ${n}`,
  allPass: "Every check passes — the archive is ready to upload.",
  notExportedYet: (n) => `Not exported yet · ${n}`,
  shownAt: (p) => `shown at ${p}%`,
  level: { pass: "pass", warn: "warning", fail: "fail" },
  ...labels(ROW_EN, DELIVERABLES_EN, LISTING_EN),
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
  noStickers: "No stickers yet",
  sourceLabel: sourceIn(null),
};

const ZH: Chrome = {
  loading: "正在读取表情包…",
  noPackTitle: "还没有表情包",
  noPackBody: "跟 agent 说说这套表情画谁——一张照片、你自己的角色，或是家里的宠物——以及做给谁用。它会写好 pack.json，表情一张张画出来，就会出现在这里的聊天背景上。",
  packInvalidTitle: "pack.json 读不出来",
  packInvalidBody: "先把下面这些字段改对（可以让 agent 来改）：",
  projectBroken: (e) => `project.json 读不出来（${e}）。修好之前，状态、花费和检查结果都无从得知；这个文件只由表情脚本写入。`,
  readOnly: "只读",
  notSaved: (e) => `没有保存：${e}`,

  untitled: "表情包",
  stickerCount: (n, ready) => (ready === null ? `${n} 张` : `${n} 张 · ${ready} 张就绪`),
  view: { panel: "面板", chat: "聊天", submit: "提交" },
  viewsLabel: "视图",
  plate: { light: "浅色", dark: "深色" },
  plateLabel: "聊天背景",
  next: "下一步",
  makeMissing: "补齐没出图的表情",
  exportCheck: "导出并检查",
  commandSent: "已发给 agent",

  character: "角色",
  noCharacter: "还没有角色",
  unread: "不清楚——project.json 读不出来",
  unreadSpend: "project.json 修好后才能算",
  unreadChecksTitle: "检查要等 project.json 修好",
  unreadChecksBody: "每一版生成和每个导出文件都记在 project.json 里，它现在读不出来。上架信息在 pack.json 里，照常显示在下面。",
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
  emptyHeadlineQuiet: "还没出图",
  genLeftUncertain: "不会自动重画：上一次可能已经扣过费，要重画得另外明确确认。",
  genRetries: "请求没发出去，补齐缺图时会再画这一张。",
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
  archiveFiles: (n) => `${n} 个文件`,
  archiveState: (s) => ({ current: "已就绪", stale: "已过期", missing: "还没生成", blocked: "等所有文件就绪" })[s],
  download: "下载",
  downloadFailed: (e) => `下载失败：${e}`,
  checklist: "检查清单",
  needsAttention: (n) => `需要处理 · ${n}`,
  passing: (n) => `已通过 · ${n}`,
  allPass: "所有检查都通过了，压缩包可以直接上传。",
  notExportedYet: (n) => `还没导出 · ${n}`,
  shownAt: (p) => `按 ${p}% 显示`,
  level: { pass: "通过", warn: "提醒", fail: "未通过" },
  ...labels(ROW_ZH, DELIVERABLES_ZH, LISTING_ZH),
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
  noStickers: "还没有表情",
  sourceLabel: sourceIn(SOURCES_ZH),
};

const JA: Chrome = {
  loading: "スタンプを読み込み中…",
  noPackTitle: "スタンプはまだありません",
  noPackBody: "誰のスタンプか —— 写真、自分のキャラクター、ペット —— と、誰が使うのかを agent に伝えてください。pack.json が書かれ、描けたスタンプから順にここのチャット背景に並びます。",
  packInvalidTitle: "pack.json を表示できません",
  packInvalidBody: "先に次の項目を直してください（agent に頼めます）：",
  projectBroken: (e) => `project.json を読めません（${e}）。直るまで、状態・費用・チェック結果は不明です。このファイルを書くのはスタンプのスクリプトだけです。`,
  readOnly: "閲覧のみ",
  notSaved: (e) => `保存されませんでした：${e}`,

  untitled: "スタンプ",
  stickerCount: (n, ready) => (ready === null ? `${n} 枚` : `${n} 枚 · 完成 ${ready} 枚`),
  view: { panel: "パネル", chat: "チャット", submit: "申請" },
  viewsLabel: "表示",
  plate: { light: "ライト", dark: "ダーク" },
  plateLabel: "チャット背景",
  next: "次",
  makeMissing: "足りないスタンプを作る",
  exportCheck: "書き出してチェック",
  commandSent: "agent に送りました",

  character: "キャラクター",
  noCharacter: "キャラクターはまだありません",
  unread: "不明（project.json を読めません）",
  unreadSpend: "project.json を読めるまで不明",
  unreadChecksTitle: "チェックは project.json の修復待ち",
  unreadChecksBody: "すべての生成結果と書き出しファイルは project.json に記録されていますが、今は読めません。ストア情報は pack.json にあるので、下に表示しています。",
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
  emptyHeadlineQuiet: "テイクはまだありません",
  genLeftUncertain: "自動では描き直しません。前回すでに課金された可能性があるため、描き直すには改めて確認が必要です。",
  genRetries: "リクエストは送信されていないので、足りないスタンプを作るときにもう一度描きます。",
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
  archiveFiles: (n) => `${n} ファイル`,
  archiveState: (s) => ({ current: "準備完了", stale: "古い", missing: "未作成", blocked: "全ファイル待ち" })[s],
  download: "ダウンロード",
  downloadFailed: (e) => `ダウンロードできませんでした：${e}`,
  checklist: "チェックリスト",
  needsAttention: (n) => `対応が必要 · ${n}`,
  passing: (n) => `合格 · ${n}`,
  allPass: "すべてのチェックに合格しました。ZIP はそのままアップロードできます。",
  notExportedYet: (n) => `未書き出し · ${n}`,
  shownAt: (p) => `${p}% で表示`,
  level: { pass: "合格", warn: "注意", fail: "不合格" },
  ...labels(ROW_JA, DELIVERABLES_JA, LISTING_JA),
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
  noStickers: "スタンプはまだありません",
  sourceLabel: sourceIn(SOURCES_JA),
};

// ── Rule messages ──────────────────────────────────────────────────────────
//
// One template per code `sticker-state.mjs` can say (`MESSAGE_CODES`); the
// type makes a missing code a compile error, and strings.test.ts renders a
// sample of every code in every language. Templates take the code's
// parameters and `say` for a nested message (a stale row's reason, a file's
// problems). Meaning only — no CLI command, no pack.json path.

type MessageTable = { [C in MessageCode]: (p: MessageParams<C>, say: Say) => string };

function sayWith(table: MessageTable): Say {
  const say: Say = (message) => (table[message.code] as (p: unknown, s: Say) => string)(message.params, say);
  return say;
}

function bytes(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}
const secs = (ms: number) => (ms / 1000).toFixed(2).replace(/\.?0+$/, "");
const upper = (format: string) => String(format).toUpperCase();
const label = (platform: Platform) => PLATFORM_PROFILES[platform]?.label ?? platform;

type AssetWords = Record<"pending" | "generating" | "ready" | "failed" | "missing", string>;
const assetWord = (words: AssetWords, status: string | null) => words[(status ?? "missing") as keyof AssetWords] ?? status ?? words.missing;

function enMessages(c: Chrome): MessageTable {
  const list = (items: readonly (string | number)[]) => items.join(", ");
  const s = (ms: number) => `${secs(ms)} s`;
  const asset: AssetWords = { pending: "waiting to be drawn", generating: "still being drawn", ready: "ready", failed: "failed", missing: "missing from the record" };
  const status: Record<StickerStatus, string> = { empty: "no take yet", failed: "every take failed", generating: "still generating", pick: "no take picked", ready: "ready", stale: "stale" };
  const field = { description: "character description", style: "character style", word: "word", caption: "caption", action: "action" };
  const motion = { frames: "frame count", frameMs: "frame duration", size: "size" };
  /** A text length, with the limit beside it; LINE counts CJK characters as 2. */
  const len = (length: number, width: boolean, limit?: string) =>
    width ? `${length} units (CJK characters count 2${limit ? `; ${limit}` : ""})` : `${length} characters${limit ? ` (${limit})` : ""}`;
  const words = (items: { sticker: string; word: string }[]) => items.map((w) => `${w.sticker} “${w.word}”`).join(", ");
  return {
    "stale.sticker-gone": (p) => `${p.sticker} is no longer in the pack`,
    "stale.no-record": (p) => `${p.take} has no record of how it was made`,
    "stale.changed": (p) => `${field[p.field] ?? p.field} changed`,
    "stale.no-prompt": () => "no prompt was recorded for it",
    "stale.prompt": () => "the prompt wording changed",
    "stale.motion": (p) => `${motion[p.key] ?? p.key} changed (${p.from ?? "none"} → ${p.to})`,
    "stale.anchor": (p) => `the character changed (${p.from ?? "none"} → ${p.to ?? "none"})`,
    "state.in-flight": (p) => `${list(p.takes)} in flight`,
    "state.unpicked": () => "no take picked",
    "state.pick-not-ready": (p) => `the picked ${p.take} is ${assetWord(asset, p.status)}`,
    "state.ready-takes": (p) => `ready: ${list(p.takes)}`,
    "state.failed": (p) => `${p.count} take${p.count === 1 ? "" : "s"} failed`,
    "anchor.unset": () => "no character picked yet",
    "anchor.not-ready": (p) => `the picked character ${p.anchor} is ${assetWord(asset, p.status)}`,
    "source.no-sticker": () => "the pack has no sticker",
    "source.sticker": (p, say) => {
      const why = p.why.filter((m) => m.code !== "state.unpicked").map(say);
      return `${p.sticker}: ${status[p.status] ?? p.status}${why.length ? ` (${why.join("; ")})` : ""}`;
    },
    "source.art-unpicked": (p) => `no ${c.artKind(p.art).toLowerCase()} art picked`,
    "source.art-not-ready": (p) => `the picked ${c.artKind(p.art).toLowerCase()} ${p.asset} is ${assetWord(asset, p.status)}`,
    "export.not-exported": () => "not exported yet",
    "export.from-other": (p) => `made from ${p.from}; the pick is now ${p.now}`,
    "export.other-inputs": () => "made from other inputs (kept frames, order, art or the exporter changed)",
    "export.again": (p, say) => `${say(p.why)} — export again`,
    "export.optional-none": (p, say) => `none — ${say(p.why)}; optional${p.platform === "telegram" ? " (Telegram uses the first sticker)" : ""}`,
    "export.measured": (p, say) => (p.problems.length ? `${p.problems.map(say).join("; ")} (${say(p.summary)})` : say(p.summary)),
    "file.bytes-over": (p) => `${bytes(p.bytes)} is over ${bytes(p.max)}`,
    "file.format": (p) => `format ${upper(p.format)}, not ${p.expected.map(upper).join(" or ")}`,
    "file.size": (p) => `${p.width}×${p.height}, not ${p.expectedWidth}×${p.expectedHeight}`,
    "file.loop-none": () => "does not loop",
    "file.loop-count": (p) => `loops ${p.count} time${p.count === 1 ? "" : "s"}, not forever`,
    "file.still": () => "is not animated",
    "file.codec": (p) => `${upper(p.format)}/${p.codec ?? "?"}, not WebM VP9`,
    "file.no-alpha": () => "has no transparency",
    "file.telegram-edge": (p) => `${p.width}×${p.height}: one side must be exactly ${p.edge}, the other at most ${p.edge}`,
    "file.duration-over": (p) => `${s(p.ms)} long, over ${s(p.max)}`,
    "file.fps-over": (p) => `${p.fps} fps, over ${p.max}`,
    "file.audio": () => "has a sound track",
    "file.outside": (p) => `${p.width}×${p.height} is larger than ${p.maxWidth}×${p.maxHeight}`,
    "file.min-side": (p) => `${p.width}×${p.height}: width or height must be at least ${p.min}`,
    "file.frames-range": (p) => `${p.frames} frames, not ${p.min}–${p.max}`,
    "file.loop-long": (p) => `one loop is ${s(p.ms)}, over ${s(p.max)}`,
    "file.plays-range": (p) => `plays ${p.plays === 0 ? "forever" : `${p.plays} times`}, not ${p.min}–${p.max}`,
    "file.plays-total": (p) => `${p.plays} plays × ${s(p.ms)} is over ${s(p.max)}`,
    "file.main-plays": (p) => `${p.plays} plays × ${s(p.ms)}: LINE allows ${p.min}–${p.max} plays within ${s(p.maxTotal)}`,
    "file.identical": () => "every frame is the same",
    "file.not-transparent": () => "is not transparent",
    "file.margin": (p) => `${p.px} px of empty margin left`,
    "file.first-frame": (p) => `the first frame (the store's still) shows only ${p.percent}% of the figure`,
    "file.corner": () => "a corner is not transparent (a square frame or background)",
    "file.white-outline": (p) => `${p.percent}% of the outline is near-white — the platform asks for no white outline`,
    "file.not-opaque": () => "has transparent pixels; it must be opaque",
    "file.white-background": (p) => `${p.percent}% near-white — the background must not be white`,
    "file.take-stale": (p, say) => `its take is stale (${p.why.map(say).join("; ")}) — re-roll to apply`,
    "summary.wechat": (p) => `${p.width}×${p.height} GIF · ${bytes(p.bytes)} · ${p.frames} frames · ${p.loops ? "loops forever" : "does not loop"}`,
    "summary.telegram": (p) => `${p.width}×${p.height} WebM VP9${p.alpha ? " with transparency" : ""} · ${bytes(p.bytes)} · ${s(p.ms)} at ${p.fps} fps`,
    "summary.line": (p) => `${p.width}×${p.height} APNG · ${bytes(p.bytes)} · ${p.frames} frames · ${s(p.ms)} × ${p.plays} play${p.plays === 1 ? "" : "s"}`,
    "summary.still": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)}`,
    "summary.still-from-sticker": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)} · made from ${p.sticker}, frame ${p.frame} (no ${c.artKind("portrait").toLowerCase()} art picked)`,
    "rights.ok": (p) => `${c.rightsBasis(p.basis)}, confirmed ${p.confirmedAt}${p.note ? ` — ${p.note}` : ""}`,
    "rights.missing": () => "not recorded — needed before anything paid and before submitting",
    "platform.unchosen": (p) => `${label(p.platform)} is not one of this pack's platforms`,
    "count.allowed": (p) => `${p.count} sticker${p.count === 1 ? "" : "s"}; ${label(p.platform)} takes ${p.allowed.slice(0, -1).join(", ")} or ${p.allowed.at(-1)}`,
    "count.range": (p) => `${p.count} sticker${p.count === 1 ? "" : "s"}; ${label(p.platform)} takes ${p.min}–${p.max}${p.setMax ? ` when the set is created, ${p.setMax} per set` : ""}`,
    "animated.static": (p) => `${list(p.stickers)} ${p.stickers.length === 1 ? "is a still" : "are stills"}; a set is all animated or all still`,
    "animated.all": (p) => `all ${p.count} exported stickers are animated`,
    "words.bad": (p) =>
      [p.long.length ? `${words(p.long)}: 1–${p.max} characters` : null, p.dupes.length ? `${words(p.dupes)}: used twice` : null].filter(Boolean).join("; "),
    "words.ok": (p) => `${p.count} words, each 1–${p.max} characters and unique`,
    "emoji.bad": (p) => `${p.items.map((i) => `${i.sticker} ${i.emoji || "(none)"}`).join(", ")}: each sticker needs exactly one emoji`,
    "emoji.ok": () => "one emoji per sticker",
    "listing.empty": () => "empty — required",
    "listing.unset": () => "not set (optional)",
    "listing.bad": (p, say) => `“${p.text}”: ${p.problems.map(say).join("; ")}`,
    "listing.long": (p) => `“${p.text}”: ${len(p.length, p.width)} — up to ${p.best} shows best`,
    "listing.ok": (p) => `“${p.text}” — ${len(p.length, p.width, p.max !== null ? `max ${p.max}${p.min !== null ? `, min ${p.min}` : ""}` : undefined)}`,
    "text.over": (p) => `${len(p.length, p.width)}, over ${p.max}`,
    "text.under": (p) => `${len(p.length, p.width)}, under ${p.min}`,
    "text.punctuation": () => "no punctuation allowed",
    "zip.ok": (p) => `${p.uri} · ${bytes(p.bytes)} · ${p.files} files${p.over !== null ? ` — over ${bytes(p.over)}` : ""}`,
    "zip.blocked": () => "waits until every file is exported and current",
    "zip.missing": () => "not made yet",
    "zip.stale": () => "out of date — export again",
    "unconfirmed.reward-thumb": () => "unconfirmed: the reward section asks for it but never gives its size or format — not exported; prepare it by hand",
    "unconfirmed.zip-naming": () => "unconfirmed: the names 01.png…, main.png, tab.png come only from third-party guides — check them on the upload page",
    "next.rights": () => "Record the rights basis — nothing paid runs before it",
    "next.anchor": (p) => `Pick the character from ${p.candidates.length} candidate${p.candidates.length === 1 ? "" : "s"}`,
    "next.describe": () => "Describe the character",
    "next.character": () => "Make the character from a photo or image",
    "next.stickers": () => "Write the stickers",
    "next.generate": (p) => `Make the missing stickers: ${list(p.stickers)}${p.uncertain.length ? ` · retry ${list(p.uncertain)} only on purpose` : ""}`,
    "next.recover": (p) => `Fetch ${list(p.stickers)} — the image service already took these jobs, so fetching them costs nothing more`,
    "next.retry": (p) => `Retry ${list(p.stickers)} only on purpose — the last take may already have been billed`,
    "next.generating": (p) => `Waiting for ${list(p.stickers)} to land`,
    "next.pick": (p) => `Pick a take for ${list(p.stickers)}`,
    "next.reroll": (p, say) => `Re-roll the stale stickers: ${p.stale.map((x) => `${x.sticker} (${x.why.map(say).join("; ")})`).join("; ")}`,
    "next.export": (p) => `Export the ${label(p.platform)} files`,
    "next.check": (p) => `${label(p.platform)}: ${p.rows.length} check${p.rows.length === 1 ? "" : "s"} to fix — ${p.rows.map((r) => c.rowLabel(p.platform, r)).join(", ")}`,
    "next.confirm": (p) => `Nothing fails — ${p.rows.length} item${p.rows.length === 1 ? "" : "s"} to confirm by hand: ${p.rows.map((r) => `${label(r.platform)} ${c.rowLabel(r.platform, r)}`).join(", ")}`,
    "next.done": () => "Every checklist passes — ready to submit",
  };
}

function zhMessages(c: Chrome): MessageTable {
  const list = (items: readonly (string | number)[]) => items.join("、");
  const s = (ms: number) => `${secs(ms)} 秒`;
  const asset: AssetWords = { pending: "还在排队", generating: "还在生成", ready: "已就绪", failed: "生成失败了", missing: "不在记录里" };
  const status: Record<StickerStatus, string> = { empty: "还没出图", failed: "每一版都失败了", generating: "还在生成", pick: "还没选用哪一版", ready: "已就绪", stale: "已过期" };
  const field = { description: "角色描述", style: "画风", word: "含义词", caption: "配字", action: "动作" };
  const motion = { frames: "帧数", frameMs: "每帧时长", size: "尺寸" };
  /** 文字长度，限制写在同一个括号里；LINE 的中日韩文字按 2 计。 */
  const len = (length: number, width: boolean, limit?: string) =>
    width ? `长度 ${length}（中日韩文字按 2 计${limit ? `，${limit}` : ""}）` : `${length} 个字${limit ? `（${limit}）` : ""}`;
  const words = (items: { sticker: string; word: string }[]) => items.map((w) => `${w.sticker}「${w.word}」`).join("、");
  return {
    "stale.sticker-gone": (p) => `${p.sticker} 已经不在这套表情里了`,
    "stale.no-record": (p) => `${p.take} 没有生成记录`,
    "stale.changed": (p) => `${field[p.field] ?? p.field}改了`,
    "stale.no-prompt": () => "没有记下它用的提示词",
    "stale.prompt": () => "提示词的写法改了",
    "stale.motion": (p) => `${motion[p.key] ?? p.key}改了（${p.from ?? "无"} → ${p.to}）`,
    "stale.anchor": (p) => `角色换了（${p.from ?? "无"} → ${p.to ?? "无"}）`,
    "state.in-flight": (p) => `${list(p.takes)} 正在生成`,
    "state.unpicked": () => "还没选用哪一版",
    "state.pick-not-ready": (p) => `选用的 ${p.take} ${assetWord(asset, p.status)}`,
    "state.ready-takes": (p) => `可选：${list(p.takes)}`,
    "state.failed": (p) => `${p.count} 版都失败了`,
    "anchor.unset": () => "还没选定角色",
    "anchor.not-ready": (p) => `选定的角色 ${p.anchor} ${assetWord(asset, p.status)}`,
    "source.no-sticker": () => "这套表情里一张都还没有",
    "source.sticker": (p, say) => {
      const why = p.why.filter((m) => m.code !== "state.unpicked").map(say);
      return `${p.sticker}：${status[p.status] ?? p.status}${why.length ? `（${why.join("；")}）` : ""}`;
    },
    "source.art-unpicked": (p) => `还没选${c.artKind(p.art)}`,
    "source.art-not-ready": (p) => `选定的${c.artKind(p.art)} ${p.asset} ${assetWord(asset, p.status)}`,
    "export.not-exported": () => "还没导出",
    "export.from-other": (p) => `导出时用的是 ${p.from}，现在选的是 ${p.now}`,
    "export.other-inputs": () => "导出之后素材变了（保留的帧、顺序、配图或导出方式有改动）",
    "export.again": (p, say) => `${say(p.why)}——需要重新导出`,
    "export.optional-none": (p, say) => `没有——${say(p.why)}；这一项可以不交${p.platform === "telegram" ? "（Telegram 会用第一张表情）" : ""}`,
    "export.measured": (p, say) => (p.problems.length ? `${p.problems.map(say).join("；")}（${say(p.summary)}）` : say(p.summary)),
    "file.bytes-over": (p) => `${bytes(p.bytes)}，超过了 ${bytes(p.max)}`,
    "file.format": (p) => `格式是 ${upper(p.format)}，要求 ${p.expected.map(upper).join(" 或 ")}`,
    "file.size": (p) => `${p.width}×${p.height}，应为 ${p.expectedWidth}×${p.expectedHeight}`,
    "file.loop-none": () => "不会循环播放",
    "file.loop-count": (p) => `只循环 ${p.count} 次，应为无限循环`,
    "file.still": () => "不是动图",
    "file.codec": (p) => `${upper(p.format)}/${p.codec ?? "?"}，要求 WebM VP9`,
    "file.no-alpha": () => "没有透明通道",
    "file.telegram-edge": (p) => `${p.width}×${p.height}：一边必须正好 ${p.edge}，另一边不超过 ${p.edge}`,
    "file.duration-over": (p) => `时长 ${s(p.ms)}，超过了 ${s(p.max)}`,
    "file.fps-over": (p) => `${p.fps} fps，超过了 ${p.max}`,
    "file.audio": () => "带着音轨",
    "file.outside": (p) => `${p.width}×${p.height}，超出了 ${p.maxWidth}×${p.maxHeight}`,
    "file.min-side": (p) => `${p.width}×${p.height}：宽或高至少要有 ${p.min}`,
    "file.frames-range": (p) => `${p.frames} 帧，要求 ${p.min}–${p.max} 帧`,
    "file.loop-long": (p) => `播一遍要 ${s(p.ms)}，超过了 ${s(p.max)}`,
    "file.plays-range": (p) => `${p.plays === 0 ? "无限循环" : `播放 ${p.plays} 遍`}，要求 ${p.min}–${p.max} 遍`,
    "file.plays-total": (p) => `${p.plays} 遍 × ${s(p.ms)}，总时长超过 ${s(p.max)}`,
    "file.main-plays": (p) => `${p.plays} 遍 × ${s(p.ms)}：LINE 要求在 ${s(p.maxTotal)} 内播放 ${p.min}–${p.max} 遍`,
    "file.identical": () => "每一帧都一模一样",
    "file.not-transparent": () => "不是透明底",
    "file.margin": (p) => `四周还留着 ${p.px} px 空白`,
    "file.first-frame": (p) => `第一帧（商店里展示的静态图）只露出角色的 ${p.percent}%`,
    "file.corner": () => "有个角不透明（像是带了方框或底色）",
    "file.white-outline": (p) => `轮廓有 ${p.percent}% 接近白色——平台要求不要白边`,
    "file.not-opaque": () => "有透明像素，这张必须完全不透明",
    "file.white-background": (p) => `${p.percent}% 接近白色——背景不能是白色`,
    "file.take-stale": (p, say) => `用的那一版已过期（${p.why.map(say).join("；")}）——重画后才会生效`,
    "summary.wechat": (p) => `${p.width}×${p.height} GIF · ${bytes(p.bytes)} · ${p.frames} 帧 · ${p.loops ? "无限循环" : "不循环"}`,
    "summary.telegram": (p) => `${p.width}×${p.height} WebM VP9${p.alpha ? "（透明）" : ""} · ${bytes(p.bytes)} · ${s(p.ms)} · ${p.fps} fps`,
    "summary.line": (p) => `${p.width}×${p.height} APNG · ${bytes(p.bytes)} · ${p.frames} 帧 · ${s(p.ms)} × ${p.plays} 遍`,
    "summary.still": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)}`,
    "summary.still-from-sticker": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)} · 用 ${p.sticker} 的第 ${p.frame} 帧做的（没有选${c.artKind("portrait")}）`,
    "rights.ok": (p) => `${c.rightsBasis(p.basis)}，${p.confirmedAt} 确认${p.note ? `——${p.note}` : ""}`,
    "rights.missing": () => "还没登记——付费生成和提交之前都得先登记",
    "platform.unchosen": (p) => `这套表情没有选 ${label(p.platform)}`,
    "count.allowed": (p) => `共 ${p.count} 张；${label(p.platform)} 只收 ${p.allowed.slice(0, -1).join("、")} 或 ${p.allowed.at(-1)} 张`,
    "count.range": (p) => `共 ${p.count} 张；${label(p.platform)} 要求 ${p.min}–${p.max} 张${p.setMax ? `（创建时；整套最多 ${p.setMax} 张）` : ""}`,
    "animated.static": (p) => `${list(p.stickers)} 是静图；一套表情要么全是动图，要么全是静图`,
    "animated.all": (p) => `导出的 ${p.count} 张都是动图`,
    "words.bad": (p) => [p.long.length ? `${words(p.long)}：要 1–${p.max} 个字` : null, p.dupes.length ? `${words(p.dupes)}：重复了` : null].filter(Boolean).join("；"),
    "words.ok": (p) => `${p.count} 个含义词，都在 1–${p.max} 个字之内，没有重复`,
    "emoji.bad": (p) => `${p.items.map((i) => `${i.sticker} ${i.emoji || "（空）"}`).join("、")}：每张表情只能配一个 emoji`,
    "emoji.ok": () => "每张一个 emoji",
    "listing.empty": () => "还没填——必填",
    "listing.unset": () => "没填（选填）",
    "listing.bad": (p, say) => `“${p.text}”：${p.problems.map(say).join("；")}`,
    "listing.long": (p) => `“${p.text}”：${len(p.length, p.width)}——${p.best} 个字以内显示效果最好`,
    "listing.ok": (p) => `“${p.text}”——${len(p.length, p.width, p.max !== null ? `最多 ${p.max}${p.min !== null ? `，最少 ${p.min}` : ""}` : undefined)}`,
    "text.over": (p) => `${len(p.length, p.width)}，超过了 ${p.max}`,
    "text.under": (p) => `${len(p.length, p.width)}，少于 ${p.min}`,
    "text.punctuation": () => "不能带标点",
    "zip.ok": (p) => `${p.uri} · ${bytes(p.bytes)} · ${p.files} 个文件${p.over !== null ? `——超过了 ${bytes(p.over)}` : ""}`,
    "zip.blocked": () => "要等所有文件都导出、并且是最新的",
    "zip.missing": () => "还没打包",
    "zip.stale": () => "已过期——需要重新导出",
    "unconfirmed.reward-thumb": () => "未确认：赞赏功能要求提供，却没写尺寸和格式——不会导出，需要自己准备",
    "unconfirmed.zip-naming": () => "未确认：01.png…、main.png、tab.png 这些文件名只见于第三方教程——上传时请对照页面核实",
    "next.rights": () => "先登记版权依据——登记前不会运行任何付费步骤",
    "next.anchor": (p) => `从 ${p.candidates.length} 个候选里选定角色`,
    "next.describe": () => "先写好角色描述",
    "next.character": () => "用照片或图片画出角色",
    "next.stickers": () => "写好每张表情",
    "next.generate": (p) => `补齐还没出图的：${list(p.stickers)}${p.uncertain.length ? `；${list(p.uncertain)} 要重画得另外确认` : ""}`,
    "next.recover": (p) => `先把 ${list(p.stickers)} 取回来——生成服务已经接下这几张，取回不会再扣费`,
    "next.retry": (p) => `${list(p.stickers)} 要不要重画由你决定——上一次可能已经扣费了`,
    "next.generating": (p) => `等 ${list(p.stickers)} 出图`,
    "next.pick": (p) => `给 ${list(p.stickers)} 选一版`,
    "next.reroll": (p, say) => `重画这几张：${p.stale.map((x) => `${x.sticker}（${x.why.map(say).join("；")}）`).join("；")}`,
    "next.export": (p) => `导出 ${label(p.platform)} 的文件`,
    "next.check": (p) => `${label(p.platform)}：还有 ${p.rows.length} 项没通过——${p.rows.map((r) => c.rowLabel(p.platform, r)).join("、")}`,
    "next.confirm": (p) => `没有不合格项，还有 ${p.rows.length} 项要你亲自确认：${p.rows.map((r) => `${label(r.platform)} ${c.rowLabel(r.platform, r)}`).join("、")}`,
    "next.done": () => "所有检查都通过了，可以提交",
  };
}

function jaMessages(c: Chrome): MessageTable {
  const list = (items: readonly (string | number)[]) => items.join("、");
  const s = (ms: number) => `${secs(ms)} 秒`;
  const asset: AssetWords = { pending: "生成待ちです", generating: "生成中です", ready: "完成しています", failed: "生成に失敗しています", missing: "記録にありません" };
  const status: Record<StickerStatus, string> = { empty: "テイクなし", failed: "すべてのテイクが失敗", generating: "生成中", pick: "テイク未選択", ready: "完成", stale: "古いテイク" };
  const field = { description: "キャラクターの説明", style: "スタイル", word: "意味語", caption: "文字", action: "動き" };
  const motion = { frames: "フレーム数", frameMs: "1 フレームの長さ", size: "サイズ" };
  /** 文字数と上限をひとつの括弧に。LINE は全角 2・半角 1 で数えます。 */
  const len = (length: number, width: boolean, limit?: string) =>
    width ? `長さ ${length}（全角 2・半角 1 で計算${limit ? `、${limit}` : ""}）` : `${length} 文字${limit ? `（${limit}）` : ""}`;
  const words = (items: { sticker: string; word: string }[]) => items.map((w) => `${w.sticker}「${w.word}」`).join("、");
  return {
    "stale.sticker-gone": (p) => `${p.sticker} はもうセットにありません`,
    "stale.no-record": (p) => `${p.take} には生成の記録がありません`,
    "stale.changed": (p) => `${field[p.field] ?? p.field}が変わりました`,
    "stale.no-prompt": () => "使ったプロンプトが記録されていません",
    "stale.prompt": () => "プロンプトの書き方が変わりました",
    "stale.motion": (p) => `${motion[p.key] ?? p.key}が変わりました（${p.from ?? "なし"} → ${p.to}）`,
    "stale.anchor": (p) => `キャラクターが変わりました（${p.from ?? "なし"} → ${p.to ?? "なし"}）`,
    "state.in-flight": (p) => `${list(p.takes)} を生成中`,
    "state.unpicked": () => "テイクが選ばれていません",
    "state.pick-not-ready": (p) => `選んだ ${p.take} は${assetWord(asset, p.status)}`,
    "state.ready-takes": (p) => `使えるテイク：${list(p.takes)}`,
    "state.failed": (p) => `${p.count} テイクとも失敗`,
    "anchor.unset": () => "キャラクターがまだ選ばれていません",
    "anchor.not-ready": (p) => `選んだキャラクター ${p.anchor} は${assetWord(asset, p.status)}`,
    "source.no-sticker": () => "セットにスタンプがありません",
    "source.sticker": (p, say) => {
      const why = p.why.filter((m) => m.code !== "state.unpicked").map(say);
      return `${p.sticker}：${status[p.status] ?? p.status}${why.length ? `（${why.join("／")}）` : ""}`;
    },
    "source.art-unpicked": (p) => `${c.artKind(p.art)}が選ばれていません`,
    "source.art-not-ready": (p) => `選んだ${c.artKind(p.art)} ${p.asset} は${assetWord(asset, p.status)}`,
    "export.not-exported": () => "まだ書き出していません",
    "export.from-other": (p) => `${p.from} から書き出しましたが、今は ${p.now} を選んでいます`,
    "export.other-inputs": () => "書き出し後に素材が変わりました（残すフレーム・順番・アート・書き出し方法のいずれか）",
    "export.again": (p, say) => `${say(p.why)} —— 書き出し直しが必要です`,
    "export.optional-none": (p, say) => `なし —— ${say(p.why)}。この項目は任意です${p.platform === "telegram" ? "（Telegram は最初のスタンプを使います）" : ""}`,
    "export.measured": (p, say) => (p.problems.length ? `${p.problems.map(say).join("／")}（${say(p.summary)}）` : say(p.summary)),
    "file.bytes-over": (p) => `${bytes(p.bytes)}（上限 ${bytes(p.max)} を超えています）`,
    "file.format": (p) => `形式が ${upper(p.format)} です（${p.expected.map(upper).join(" か ")} が必要）`,
    "file.size": (p) => `${p.width}×${p.height}（${p.expectedWidth}×${p.expectedHeight} が必要）`,
    "file.loop-none": () => "ループしません",
    "file.loop-count": (p) => `${p.count} 回で止まります（無限ループが必要）`,
    "file.still": () => "アニメーションになっていません",
    "file.codec": (p) => `${upper(p.format)}/${p.codec ?? "?"}（WebM VP9 が必要）`,
    "file.no-alpha": () => "透過チャンネルがありません",
    "file.telegram-edge": (p) => `${p.width}×${p.height}：一辺をちょうど ${p.edge}、もう一辺を ${p.edge} 以下にする必要があります`,
    "file.duration-over": (p) => `長さ ${s(p.ms)}（上限 ${s(p.max)} を超えています）`,
    "file.fps-over": (p) => `${p.fps} fps（上限 ${p.max} を超えています）`,
    "file.audio": () => "音声トラックが入っています",
    "file.outside": (p) => `${p.width}×${p.height}（${p.maxWidth}×${p.maxHeight} を超えています）`,
    "file.min-side": (p) => `${p.width}×${p.height}：幅か高さのどちらかを ${p.min} 以上にする必要があります`,
    "file.frames-range": (p) => `${p.frames} フレーム（${p.min}〜${p.max} が必要）`,
    "file.loop-long": (p) => `1 ループ ${s(p.ms)}（上限 ${s(p.max)} を超えています）`,
    "file.plays-range": (p) => `${p.plays === 0 ? "無限に再生" : `${p.plays} 回再生`}（${p.min}〜${p.max} 回が必要）`,
    "file.plays-total": (p) => `${p.plays} 回 × ${s(p.ms)} で合計 ${s(p.max)} を超えます`,
    "file.main-plays": (p) => `${p.plays} 回 × ${s(p.ms)}：LINE は合計 ${s(p.maxTotal)} 以内で ${p.min}〜${p.max} 回まで`,
    "file.identical": () => "すべてのフレームが同じです",
    "file.not-transparent": () => "背景が透過されていません",
    "file.margin": (p) => `余白が ${p.px} px 残っています`,
    "file.first-frame": (p) => `1 フレーム目（ストアに出る静止画）にキャラクターが ${p.percent}% しか写っていません`,
    "file.corner": () => "角が透過されていません（四角い枠か背景が残っています）",
    "file.white-outline": (p) => `輪郭の ${p.percent}% がほぼ白です —— 白いふちは付けないよう求められています`,
    "file.not-opaque": () => "透過ピクセルがあります（不透明にする必要があります）",
    "file.white-background": (p) => `${p.percent}% がほぼ白です —— 背景を白にはできません`,
    "file.take-stale": (p, say) => `使っているテイクが古くなっています（${p.why.map(say).join("／")}）—— 描き直すと反映されます`,
    "summary.wechat": (p) => `${p.width}×${p.height} GIF · ${bytes(p.bytes)} · ${p.frames} フレーム · ${p.loops ? "無限ループ" : "ループなし"}`,
    "summary.telegram": (p) => `${p.width}×${p.height} WebM VP9${p.alpha ? "（透過）" : ""} · ${bytes(p.bytes)} · ${s(p.ms)} · ${p.fps} fps`,
    "summary.line": (p) => `${p.width}×${p.height} APNG · ${bytes(p.bytes)} · ${p.frames} フレーム · ${s(p.ms)} × ${p.plays} 回`,
    "summary.still": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)}`,
    "summary.still-from-sticker": (p) => `${p.width}×${p.height} ${upper(p.format)} · ${bytes(p.bytes)} · ${p.sticker} の ${p.frame} フレーム目から作成（${c.artKind("portrait")}は未選択）`,
    "rights.ok": (p) => `${c.rightsBasis(p.basis)}（${p.confirmedAt} 確認）${p.note ? ` —— ${p.note}` : ""}`,
    "rights.missing": () => "未記録です —— 有料の処理にも申請にも、先に記録が必要です",
    "platform.unchosen": (p) => `このセットのプラットフォームに ${label(p.platform)} は入っていません`,
    "count.allowed": (p) => `${p.count} 枚（${label(p.platform)} は ${p.allowed.join("・")} 枚のいずれか）`,
    "count.range": (p) => `${p.count} 枚（${label(p.platform)} は ${p.min}〜${p.max} 枚${p.setMax ? `。これは作成時の枚数で、セット全体では ${p.setMax} 枚まで` : ""}）`,
    "animated.static": (p) => `${list(p.stickers)} が静止画です。セットはすべてアニメーションか、すべて静止画にそろえます`,
    "animated.all": (p) => `書き出した ${p.count} 枚はすべてアニメーションです`,
    "words.bad": (p) => [p.long.length ? `${words(p.long)}：1〜${p.max} 文字にしてください` : null, p.dupes.length ? `${words(p.dupes)}：重複しています` : null].filter(Boolean).join("／"),
    "words.ok": (p) => `意味語 ${p.count} 個、どれも 1〜${p.max} 文字で重複なし`,
    "emoji.bad": (p) => `${p.items.map((i) => `${i.sticker} ${i.emoji || "（なし）"}`).join("、")}：絵文字は 1 枚につき 1 つだけです`,
    "emoji.ok": () => "1 枚に絵文字 1 つ",
    "listing.empty": () => "未入力です（必須）",
    "listing.unset": () => "未入力（任意）",
    "listing.bad": (p, say) => `「${p.text}」：${p.problems.map(say).join("／")}`,
    "listing.long": (p) => `「${p.text}」：${len(p.length, p.width)} —— ${p.best} 文字以内だときれいに表示されます`,
    "listing.ok": (p) => `「${p.text}」—— ${len(p.length, p.width, p.max !== null ? `上限 ${p.max}${p.min !== null ? `、下限 ${p.min}` : ""}` : undefined)}`,
    "text.over": (p) => `${len(p.length, p.width)}：上限 ${p.max} を超えています`,
    "text.under": (p) => `${len(p.length, p.width)}：${p.min} 以上が必要です`,
    "text.punctuation": () => "句読点・記号は使えません",
    "zip.ok": (p) => `${p.uri} · ${bytes(p.bytes)} · ${p.files} ファイル${p.over !== null ? ` —— 上限 ${bytes(p.over)} を超えています` : ""}`,
    "zip.blocked": () => "すべてのファイルを最新の状態で書き出すまで作れません",
    "zip.missing": () => "まだ作っていません",
    "zip.stale": () => "古くなっています —— 書き出し直しが必要です",
    "unconfirmed.reward-thumb": () => "未確認：投げ銭の説明で求められていますが、サイズと形式の記載がありません —— 書き出されないので手で用意してください",
    "unconfirmed.zip-naming": () => "未確認：01.png…、main.png、tab.png というファイル名は第三者のガイドにしか載っていません —— アップロード画面で確認してください",
    "next.rights": () => "権利の根拠を記録する（記録するまで有料の処理は動きません）",
    "next.anchor": (p) => `${p.candidates.length} 件の候補からキャラクターを選ぶ`,
    "next.describe": () => "キャラクターの説明を書く",
    "next.character": () => "写真や画像からキャラクターを作る",
    "next.stickers": () => "スタンプの内容を書く",
    "next.generate": (p) => `足りないスタンプを作る：${list(p.stickers)}${p.uncertain.length ? `（${list(p.uncertain)} の描き直しは別に確認）` : ""}`,
    "next.recover": (p) => `${list(p.stickers)} を受け取り直す —— 生成サービスは受付済みなので、追加の課金はありません`,
    "next.retry": (p) => `${list(p.stickers)} の描き直しは確認してから —— 前回すでに課金された可能性があります`,
    "next.generating": (p) => `${list(p.stickers)} の完成待ち`,
    "next.pick": (p) => `${list(p.stickers)} のテイクを選ぶ`,
    "next.reroll": (p, say) => `描き直しが必要：${p.stale.map((x) => `${x.sticker}（${x.why.map(say).join("／")}）`).join("、")}`,
    "next.export": (p) => `${label(p.platform)} 用に書き出す`,
    "next.check": (p) => `${label(p.platform)}：不合格が ${p.rows.length} 件 —— ${p.rows.map((r) => c.rowLabel(p.platform, r)).join("、")}`,
    "next.confirm": (p) => `不合格はありません。手で確認する項目が ${p.rows.length} 件：${p.rows.map((r) => `${label(r.platform)} ${c.rowLabel(r.platform, r)}`).join("、")}`,
    "next.done": () => "すべてのチェックに合格。申請できます",
  };
}

export const STICKER_MESSAGE_TABLES: Record<StickerLocale, MessageTable> = { en: enMessages(EN), "zh-CN": zhMessages(ZH), ja: jaMessages(JA) };

const TABLES: Record<StickerLocale, StickerStrings> = {
  en: { ...EN, say: sayWith(STICKER_MESSAGE_TABLES.en) },
  "zh-CN": { ...ZH, say: sayWith(STICKER_MESSAGE_TABLES["zh-CN"]) },
  ja: { ...JA, say: sayWith(STICKER_MESSAGE_TABLES.ja) },
};

/** The platform terms each table must name (keys of PLATFORM_PROFILES), for the strings test. */
export const STICKER_TERM_TABLES = {
  rows: { en: ROW_EN, "zh-CN": ROW_ZH, ja: ROW_JA },
  deliverables: { en: DELIVERABLES_EN, "zh-CN": DELIVERABLES_ZH, ja: DELIVERABLES_JA },
  listing: { en: LISTING_EN, "zh-CN": LISTING_ZH, ja: LISTING_JA },
  sources: { "zh-CN": SOURCES_ZH, ja: SOURCES_JA },
} as const;

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
