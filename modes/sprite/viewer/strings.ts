/**
 * Every word the sprite viewer says, in every language it says it in.
 *
 * The mode description, the agent and the seed templates all speak the user's
 * language; the stage did not, and a tester watching a Chinese agent fill an
 * English UI called the mix jarring enough to log. So the viewer's copy lives
 * here, keyed by `props.locale`, and the components take a `SpriteStrings`
 * rather than holding literals — `modes/sprite/__tests__/viewer-logic.test.ts`
 * scans the TSX and fails on any visible literal that did not come through
 * this table.
 *
 * Three kinds of text are deliberately NOT in here:
 *
 * - CONTENT the agent wrote (motion labels, prompts, notes, inspect warnings,
 *   the acknowledgement reason). It is already in the user's language because
 *   the agent is; translating it would mean rewriting the pipeline's own
 *   sentences, and a mistranslated warning is worse than an English one.
 * - PROPER NOUNS: `GIF`, `Seedance 2.5`, `i2v`, `atlas.json`, `preview.gif`.
 *   A file name that is translated cannot be found on disk.
 * - The English command hints, which come from `manifest.viewerApi.commands`
 *   so that English has ONE source. `commandHint` covers the other locales
 *   and returns null where the manifest is already right.
 */

import type { Motion, MotionStatus } from "../domain.js";
import type { AtlasNote } from "./atlas.js";
import type { SizeLine } from "./metrics.js";

export type SpriteLocale = "en" | "zh-CN";

export interface SpriteStrings {
  // ── Shell / header ──────────────────────────────────────────────────────
  railShow: string;
  railHide: string;
  noCharacterTitle: string;
  noCharacterBody: string;
  /** `declared 256 · measured 186×252 · packed ×0.5` */
  sizeLine: (line: SizeLine) => string;
  facing: (direction: "left" | "right") => string;
  refCount: (count: number) => string;
  motionCount: (count: number) => string;
  /** The header's word for a motion sampled out of a video clip. */
  fromVideo: string;
  /** The rail's chip for the same thing. */
  videoSource: string;
  videoSourceTitle: string;
  renderingVideo: string;
  renderingVideoTitle: (motions: string[]) => string;
  showingReference: string;
  backToMotion: (label: string) => string;

  // ── Selection reported to the agent ──────────────────────────────────────
  selectionFrame: (motionLabel: string, frame: string) => string;
  selectionMotion: (motionLabel: string, status: MotionStatus) => string;

  // ── Stage ───────────────────────────────────────────────────────────────
  stageBackground: string;
  background: Record<"checker" | "dark" | "light", string>;
  zoom: string;
  zoomOption: Record<"fit" | "1x" | "2x", string>;
  onionTitle: string;
  pivotMeasured: (anchor: "bottom" | "center") => string;
  pivotAssumed: (anchor: "bottom" | "center") => string;
  anchor: Record<"bottom" | "center", string>;
  referenceTag: string;
  pickAMotion: string;
  drawingSheet: string;
  slicingAligning: string;
  motionFailed: string;
  plannedNoSheet: string;
  sheetPreview: string;
  sheetPreviewTitle: (keyed: boolean, cols: number, rows: number) => string;
  framesMissing: (count: number) => string;
  decoding: string;

  // ── Transport ───────────────────────────────────────────────────────────
  play: string;
  pause: string;
  previousFrame: string;
  nextFrame: string;
  playbackFps: string;
  slower: string;
  faster: string;
  fps: (value: number) => string;
  looping: string;
  playsOnce: string;
  loopShort: string;
  onceShort: string;
  storedPlayback: (fps: number, loop: boolean) => string;
  storedPlaybackTitle: string;
  framesList: string;
  noFramesYet: string;
  frameTitle: (frame: string) => string;
  noAsset: string;

  // ── Rail ────────────────────────────────────────────────────────────────
  references: string;
  motions: string;
  noReferences: string;
  noMotions: string;
  referenceTitle: (label: string, role: string) => string;
  refRole: Record<"turnaround" | "portrait" | "expression" | "custom", string>;
  missingAsset: string;
  motionMeta: (m: {
    cols: number;
    rows: number;
    frames: number;
    fps: number;
    loop: boolean;
  }) => string;
  status: Record<MotionStatus, string>;
  acknowledgedTitle: (reason: string) => string;

  // ── Preview panel ───────────────────────────────────────────────────────
  tab: Record<"gif" | "video" | "atlas", string>;
  selectMotionForPanel: string;
  noPreviewYet: string;
  previewMeta: (m: { fps: number; loop: boolean; frames: number }) => string;
  noVideoYet: (renderCommand: string) => string;
  videoStatus: Record<"generating" | "ready" | "failed", string>;
  renderFailed: string;
  clipFileMissing: string;
  downloadClip: string;
  noAtlasYet: string;
  atlasNote: (note: AtlasNote) => string;
  factSheet: string;
  factGrid: string;
  factCell: string;
  factPivot: string;
  factScale: string;
  pivotMeasuredTitle: string;
  pivotAssumedTitle: (anchor: "bottom" | "center") => string;
  assumed: string;
  inspect: string;
  factFrames: string;
  factAnchorDrift: string;
  factMaxJump: string;
  factScaleDrift: string;
  factBodyDrift: string;
  factEmpty: string;
  none: string;
  /** The bar a value is judged against, said beside it. */
  limit: (text: string) => string;
  acknowledged: (reason: string) => string;

  // ── Commands ────────────────────────────────────────────────────────────
  /** The button's own word, when this locale has one. `null` defers to the
   *  manifest's `label`, which is the English source. */
  commandLabel: (commandId: string) => string | null;
  commandHint: (commandId: string) => string | null;
  selectMotionFirst: string;
  renderClipFor: string;
  fieldModel: string;
  fieldMode: string;
  modelHint: Record<"seedance-2.5" | "h3-max", string>;
  modeHint: Record<"i2v" | "first-last" | "r2v", string>;
  notePlaceholder: Record<"emphasis" | "change" | "misalignment", string>;
  cancel: string;
  askTheAgent: string;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** `×0.5`, and `×2` rather than `×2.0000`. */
const scaleText = (scale: number): string =>
  `×${Number(scale.toFixed(4))}`;

const en: SpriteStrings = {
  railShow: "Show the rail",
  railHide: "Hide the rail",
  noCharacterTitle: "No character yet",
  noCharacterBody:
    "Sprite starts with a character — a name, a look, a style. Describe one in the chat and the agent will draw its references, then you can ask for motions: idle, walk, attack.",
  sizeLine: (line) =>
    [
      line.declared ? `declared ${line.declared}` : null,
      line.measured ? `measured ${line.measured}` : null,
      line.packedScale !== null ? `packed ${scaleText(line.packedScale)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  facing: (direction) => `facing ${direction}`,
  refCount: (count) => `${count} reference${count === 1 ? "" : "s"}`,
  motionCount: (count) => `${count} motion${count === 1 ? "" : "s"}`,
  fromVideo: "from video",
  videoSource: "video",
  videoSourceTitle: "Frames sampled from a video clip",
  renderingVideo: "rendering video",
  renderingVideoTitle: (motions) =>
    `A video clip is still rendering: ${motions.join(", ")}`,
  showingReference: "Showing the reference",
  backToMotion: (label) => `Back to ${label}`,

  selectionFrame: (motionLabel, frame) => `${motionLabel} · frame ${frame}`,
  selectionMotion: (motionLabel, status) => `${motionLabel} · ${status}`,

  stageBackground: "Stage background",
  background: { checker: "checker", dark: "dark", light: "light" },
  zoom: "Zoom",
  zoomOption: { fit: "fit", "1x": "1x", "2x": "2x" },
  onionTitle: "Onion skin — previous frame in blue, next in red",
  anchor: { bottom: "bottom", center: "center" },
  pivotMeasured: (anchor) =>
    `Pivot guides — the anchor point the pipeline measured (${anchor})`,
  pivotAssumed: (anchor) =>
    `Pivot guides — the ${anchor} of the cell; this motion carries no measured anchor point`,
  referenceTag: "reference",
  pickAMotion: "Pick a motion on the left, or ask for a new one.",
  drawingSheet: "Drawing the sheet…",
  slicingAligning: "Slicing and aligning…",
  motionFailed: "This motion failed.",
  plannedNoSheet: "Planned — no sheet has been generated yet.",
  sheetPreview: "sheet preview",
  sheetPreviewTitle: (keyed, cols, rows) =>
    `No aligned frames yet — this is the ${keyed ? "keyed" : "raw"} sheet sliced ${cols}×${rows} in the browser.`,
  framesMissing: (count) => `${count} frame${count === 1 ? "" : "s"} missing`,
  decoding: "decoding…",

  play: "Play",
  pause: "Pause",
  previousFrame: "Previous frame",
  nextFrame: "Next frame",
  playbackFps: "Playback fps (this session only)",
  slower: "Slower",
  faster: "Faster",
  fps: (value) => `${value} fps`,
  looping: "Looping",
  playsOnce: "Plays once",
  loopShort: "loop",
  onceShort: "once",
  storedPlayback: (fps, loop) =>
    `file: ${fps} fps · ${loop ? "loop" : "once"} — reset`,
  storedPlaybackTitle: "Playback settings differ from the motion's stored values",
  framesList: "Frames",
  noFramesYet: "No frames to step through yet.",
  frameTitle: (frame) => `Frame ${frame}`,
  noAsset: "no asset",

  references: "References",
  motions: "Motions",
  noReferences:
    "No identity references yet. They are what keeps every motion sheet on model.",
  noMotions: "No motions yet. Ask for one — idle, walk, attack.",
  referenceTitle: (label, role) => `${label} — ${role}`,
  refRole: {
    turnaround: "turnaround",
    portrait: "portrait",
    expression: "expression",
    custom: "custom",
  },
  missingAsset: "missing",
  motionMeta: (m) =>
    `${m.cols}×${m.rows} · ${m.frames} frame${m.frames === 1 ? "" : "s"} · ${m.fps} fps · ${m.loop ? "loop" : "once"}`,
  status: {
    planned: "planned",
    generating: "generating",
    processing: "processing",
    ready: "ready",
    failed: "failed",
  },
  acknowledgedTitle: (reason) => `Warnings accepted — ${reason}`,

  tab: { gif: "GIF", video: "Video", atlas: "Atlas" },
  selectMotionForPanel: "Select a motion to see what it produced.",
  noPreviewYet:
    "No preview rendered yet. The GIF and WebP land with the pipeline run.",
  previewMeta: (m) =>
    `${m.fps} fps · ${m.loop ? "loops" : "plays once"} · ${m.frames} frames`,
  noVideoYet: (renderCommand) =>
    `No video preview yet. Use “${renderCommand}” to ask for one from Seedance 2.5 or MiniMax H3 Max.`,
  videoStatus: { generating: "generating", ready: "ready", failed: "failed" },
  renderFailed: "This render failed.",
  clipFileMissing: "The clip is registered but its file is missing.",
  downloadClip: "Download clip",
  noAtlasYet: "No packed atlas yet. It lands with the pipeline's pack step.",
  atlasNote: (note) => {
    switch (note.kind) {
      case "unmeasured":
        return "sheet.png has no recorded size, so its grid cannot be checked — atlas.json has the real cells.";
      case "not-whole-cells":
        return `The packed sheet is ${note.width}×${note.height}, which is not ${note.cols}×${note.rows} whole cells — the pack chose its own columns. Read atlas.json for the layout.`;
      default:
        return `A ${note.cols}×${note.rows} grid would make ${note.cellWidth}×${note.cellHeight} cells, but the frames are ${note.frameWidth}×${note.frameHeight} — read atlas.json for the layout.`;
    }
  },
  factSheet: "Sheet",
  factGrid: "Grid",
  factCell: "Cell",
  factPivot: "Pivot",
  factScale: "Packed",
  pivotMeasuredTitle:
    "The anchor point the pipeline measured, normalized by the cell — what atlas.json declares.",
  pivotAssumedTitle: (anchor) =>
    `No measured anchor point for this motion; atlas.json falls back to the ${anchor} of the cell.`,
  assumed: "assumed",
  inspect: "Inspect",
  factFrames: "Frames",
  factAnchorDrift: "Anchor drift",
  factMaxJump: "Max jump",
  factScaleDrift: "Scale drift",
  factBodyDrift: "Body drift",
  factEmpty: "Empty",
  none: "none",
  limit: (text) => `max ${text}`,
  acknowledged: (reason) => `Accepted — ${reason}`,

  // English comes from the manifest — label and hint both — so this table
  // has nothing to add for it.
  commandLabel: () => null,
  commandHint: () => null,
  selectMotionFirst: "Select a motion first",
  renderClipFor: "Render a clip of",
  fieldModel: "Model",
  fieldMode: "Mode",
  modelHint: {
    "seedance-2.5": "cheap and quick at 480p",
    "h3-max": "stronger motion, slower, min 5 s",
  },
  modeHint: {
    i2v: "from the first frame",
    "first-last": "from the first and last frames",
    r2v: "frames as references, new footage",
  },
  notePlaceholder: {
    emphasis: "Anything the clip should emphasise? (optional)",
    change: "Anything to change? (optional)",
    misalignment: "What looks wrong? (e.g. the feet slide on frames 3-5)",
  },
  cancel: "Cancel",
  askTheAgent: "Ask the agent",
};

/** Named apart from the table because `selectionMotion` says a status inside
 *  a phrase, and the two must not be allowed to drift into two vocabularies. */
const zhStatus: Record<MotionStatus, string> = {
  planned: "已计划",
  generating: "生成中",
  processing: "处理中",
  ready: "就绪",
  failed: "失败",
};

/** zh-CN copy for the three stage commands. English is not here: the
 *  manifest's `label`/`description` are already the user-facing pair, and
 *  copying them would give English two sources that can disagree. */
const zhCommandLabels: Record<string, string> = {
  "render-video": "渲染视频预览",
  "regenerate-motion": "重画这个动作",
  "fix-alignment": "帧对不齐",
};

const zhCommandHints: Record<string, string> = {
  "render-video": "让助手把这个动作渲成一段视频，可以挑模型和生成方式。",
  "regenerate-motion": "让助手重画这个动作的雪碧图，可以附一句要改什么。",
  "fix-alignment": "帧与帧之间人物在滑或在跳时，让助手重新对齐。",
};

const zhCN: SpriteStrings = {
  railShow: "显示侧栏",
  railHide: "收起侧栏",
  noCharacterTitle: "还没有角色",
  noCharacterBody:
    "精灵图从一个角色开始——名字、长相、画风。在对话里描述一个，助手会先画出它的参考图，之后你就可以要动作了：待机、行走、攻击。",
  sizeLine: (line) =>
    [
      line.declared ? `声明 ${line.declared}` : null,
      line.measured ? `实测 ${line.measured}` : null,
      line.packedScale !== null ? `打包 ${scaleText(line.packedScale)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  facing: (direction) => (direction === "left" ? "朝左" : "朝右"),
  refCount: (count) => `${count} 张参考图`,
  motionCount: (count) => `${count} 个动作`,
  fromVideo: "来自视频",
  videoSource: "视频",
  videoSourceTitle: "帧来自一段视频",
  renderingVideo: "视频渲染中",
  renderingVideoTitle: (motions) => `还有视频在渲染：${motions.join("、")}`,
  showingReference: "正在看参考图",
  backToMotion: (label) => `回到 ${label}`,

  selectionFrame: (motionLabel, frame) => `${motionLabel} · 第 ${frame} 帧`,
  selectionMotion: (motionLabel, status) =>
    `${motionLabel} · ${zhStatus[status]}`,

  stageBackground: "舞台背景",
  background: { checker: "棋盘", dark: "深色", light: "浅色" },
  zoom: "缩放",
  zoomOption: { fit: "适应", "1x": "1x", "2x": "2x" },
  onionTitle: "洋葱皮——上一帧显蓝色，下一帧显红色",
  anchor: { bottom: "底边", center: "中心" },
  pivotMeasured: (anchor) =>
    `轴心参考线——流水线实测的锚点（${anchor === "bottom" ? "底边" : "中心"}）`,
  pivotAssumed: (anchor) =>
    `轴心参考线——取格子的${anchor === "bottom" ? "底边" : "中心"}；这个动作没有实测锚点`,
  referenceTag: "参考图",
  pickAMotion: "在左边挑一个动作，或者让助手做一个新的。",
  drawingSheet: "正在画雪碧图…",
  slicingAligning: "正在切帧对齐…",
  motionFailed: "这个动作失败了。",
  plannedNoSheet: "已计划——还没有生成雪碧图。",
  sheetPreview: "雪碧图预览",
  sheetPreviewTitle: (keyed, cols, rows) =>
    `还没有对齐好的帧——这是${keyed ? "抠好背景" : "原始"}的雪碧图，在浏览器里按 ${cols}×${rows} 切开的。`,
  framesMissing: (count) => `缺 ${count} 帧`,
  decoding: "解码中…",

  play: "播放",
  pause: "暂停",
  previousFrame: "上一帧",
  nextFrame: "下一帧",
  playbackFps: "播放帧率（只对本次会话生效）",
  slower: "调慢",
  faster: "调快",
  fps: (value) => `${value} fps`,
  looping: "循环播放",
  playsOnce: "只播一次",
  loopShort: "循环",
  onceShort: "一次",
  storedPlayback: (fps, loop) =>
    `文件里是 ${fps} fps · ${loop ? "循环" : "一次"} —— 恢复`,
  storedPlaybackTitle: "当前播放设置和动作存在文件里的值不一样",
  framesList: "帧",
  noFramesYet: "还没有可以逐帧看的内容。",
  frameTitle: (frame) => `第 ${frame} 帧`,
  noAsset: "缺文件",

  references: "参考图",
  motions: "动作",
  noReferences: "还没有身份参考图。它们是每张动作图不跑形的依据。",
  noMotions: "还没有动作。让助手做一个吧——待机、行走、攻击。",
  referenceTitle: (label, role) => `${label} — ${role}`,
  refRole: {
    turnaround: "三视图",
    portrait: "头像",
    expression: "表情",
    custom: "自定义",
  },
  missingAsset: "缺文件",
  motionMeta: (m) =>
    `${m.cols}×${m.rows} · ${m.frames} 帧 · ${m.fps} fps · ${m.loop ? "循环" : "一次"}`,
  status: zhStatus,
  acknowledgedTitle: (reason) => `已确认保留 —— ${reason}`,

  tab: { gif: "GIF", video: "视频", atlas: "图集" },
  selectMotionForPanel: "选一个动作，看它产出了什么。",
  noPreviewYet: "还没有预览。GIF 和 WebP 会随流水线一起产出。",
  previewMeta: (m) =>
    `${m.fps} fps · ${m.loop ? "循环" : "只播一次"} · ${m.frames} 帧`,
  noVideoYet: (renderCommand) =>
    `还没有视频预览。点「${renderCommand}」可以让助手用 Seedance 2.5 或 MiniMax H3 Max 渲一段。`,
  videoStatus: { generating: "渲染中", ready: "就绪", failed: "失败" },
  renderFailed: "这次渲染失败了。",
  clipFileMissing: "视频已登记，但文件不在。",
  downloadClip: "下载视频",
  noAtlasYet: "还没有打包好的图集。它会随流水线的打包步骤产出。",
  atlasNote: (note) => {
    switch (note.kind) {
      case "unmeasured":
        return "sheet.png 没有记录尺寸，网格无从校验——真正的格子以 atlas.json 为准。";
      case "not-whole-cells":
        return `打包出来的图是 ${note.width}×${note.height}，切不成 ${note.cols}×${note.rows} 个整格——打包时用的是它自己算的列数。布局以 atlas.json 为准。`;
      default:
        return `按 ${note.cols}×${note.rows} 切出来的格子是 ${note.cellWidth}×${note.cellHeight}，但帧是 ${note.frameWidth}×${note.frameHeight}——布局以 atlas.json 为准。`;
    }
  },
  factSheet: "整图",
  factGrid: "网格",
  factCell: "格子",
  factPivot: "轴心",
  factScale: "打包",
  pivotMeasuredTitle: "流水线实测的锚点，按格子归一化——也就是 atlas.json 里写的值。",
  pivotAssumedTitle: (anchor) =>
    `这个动作没有实测锚点；atlas.json 退回到格子的${anchor === "bottom" ? "底边" : "中心"}。`,
  assumed: "推定",
  inspect: "体检",
  factFrames: "帧数",
  factAnchorDrift: "锚点抖动",
  factMaxJump: "最大跳变",
  factScaleDrift: "缩放漂移",
  factBodyDrift: "身体漂移",
  factEmpty: "空帧",
  none: "无",
  limit: (text) => `上限 ${text}`,
  acknowledged: (reason) => `已确认保留 —— ${reason}`,

  commandLabel: (commandId) => zhCommandLabels[commandId] ?? null,
  commandHint: (commandId) => zhCommandHints[commandId] ?? null,
  selectMotionFirst: "先选一个动作",
  renderClipFor: "渲染一段视频：",
  fieldModel: "模型",
  fieldMode: "方式",
  modelHint: {
    "seedance-2.5": "480p，便宜也快",
    "h3-max": "动作更强，更慢更贵，最短 5 秒",
  },
  modeHint: {
    i2v: "从第一帧生成",
    "first-last": "给首尾两帧，中间补出来",
    r2v: "把帧当参考，重新拍一段",
  },
  notePlaceholder: {
    emphasis: "这段视频要突出什么？（可不填）",
    change: "有什么要改的？（可不填）",
    misalignment: "哪里不对？（比如：第 3-5 帧脚在滑）",
  },
  cancel: "取消",
  askTheAgent: "交给助手",
};

const TABLES: Record<SpriteLocale, SpriteStrings> = { en, "zh-CN": zhCN };

/**
 * The table for a locale.
 *
 * `props.locale` is language-only and lowercase (`"zh"`, `"en"`, `"ja"`) —
 * the runtime folds the region out before viewers see it — so the match is on
 * the language, and a full tag (`"zh-CN"`, `"zh-Hant"`) is accepted too for
 * anyone reading `useSystemPreferences()` directly. Everything else falls
 * back to English rather than to a half-translated screen.
 */
export function resolveLocale(locale: string | undefined): SpriteLocale {
  const language = (locale ?? "").toLowerCase().split("-")[0];
  return language === "zh" ? "zh-CN" : "en";
}

export function spriteStrings(locale: string | undefined): SpriteStrings {
  return TABLES[resolveLocale(locale)];
}

export const SPRITE_STRING_TABLES = TABLES;
export { pad2 as padFrame };

/**
 * What the composer's chip says about the current selection.
 *
 * The chip is built from the selection's `content`, and `content` used to be
 * the motion's PROMPT — so clicking frame 7 of an attack put the character's
 * style paragraph in front of the user, with no mention of either the motion
 * or the frame. It names the thing now; the prompt is still one `<viewer-
 * context>` away for the agent, which is who it was ever for.
 */
export function selectionLabel(
  t: SpriteStrings,
  motion: Motion,
  frame: number | null,
): string {
  return frame === null
    ? t.selectionMotion(motion.label, motion.status)
    : t.selectionFrame(motion.label, pad2(frame));
}
