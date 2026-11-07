/**
 * One message of every code `sticker-state.mjs` can say, with parameters of
 * the shape its emitters produce. Keyed by code and typed against the
 * module's declaration, so a code added to the module without a sample here
 * fails the test that compares these keys with `MESSAGE_CODES` — and so does
 * one whose viewer strings are missing (strings.test.ts renders every sample
 * in every locale).
 *
 * Content values (words, listing text, ids) are Chinese or ids, so an
 * English word in a rendered Chinese or Japanese sample is the template's.
 */

import type { MessageCode, MessageParams, StateMessage } from "../skill/scripts/sticker-state.mjs";

type Samples = { [C in MessageCode]: MessageParams<C> };

const stale = { code: "stale.changed", params: { field: "caption" } } as const satisfies StateMessage;
const summary = { code: "summary.wechat", params: { width: 240, height: 240, bytes: 182_000, frames: 16, loops: true } } as const satisfies StateMessage;
const tooBig = { code: "file.bytes-over", params: { bytes: 612_000, max: 500_000 } } as const satisfies StateMessage;

export const SAMPLE_PARAMS: Samples = {
  "stale.sticker-gone": { sticker: "s09" },
  "stale.no-record": { take: "s01-take-3" },
  "stale.changed": { field: "description" },
  "stale.no-prompt": {},
  "stale.prompt": {},
  "stale.motion": { key: "frames", from: 16, to: 12 },
  "stale.anchor": { from: "character-1", to: "character-2" },
  "state.in-flight": { takes: ["s04-take-1", "s04-take-2"] },
  "state.unpicked": {},
  "state.pick-not-ready": { take: "s02-take-1", status: "failed" },
  "state.ready-takes": { takes: ["s02-take-1", "s02-take-2"] },
  "state.failed": { count: 2 },
  "anchor.unset": {},
  "anchor.not-ready": { anchor: "character-2", status: null },
  "source.no-sticker": {},
  "source.sticker": { sticker: "s02", status: "pick", why: [{ code: "state.unpicked", params: {} }, { code: "state.ready-takes", params: { takes: ["s02-take-1"] } }] },
  "source.art-unpicked": { art: "head" },
  "source.art-not-ready": { art: "banner", asset: "art-banner-2", status: "generating" },
  "export.not-exported": {},
  "export.from-other": { from: "s07-take-1", now: "s07-take-2" },
  "export.other-inputs": {},
  "export.again": { why: { code: "export.other-inputs", params: {} } },
  "export.optional-none": { why: { code: "source.art-unpicked", params: { art: "portrait" } }, platform: "telegram" },
  "export.measured": { problems: [tooBig, { code: "file.margin", params: { px: 6 } }], summary },
  "file.bytes-over": { bytes: 612_000, max: 500_000 },
  "file.format": { format: "png", expected: ["GIF"] },
  "file.size": { width: 240, height: 200, expectedWidth: 240, expectedHeight: 240 },
  "file.loop-none": {},
  "file.loop-count": { count: 3 },
  "file.still": {},
  "file.codec": { format: "webm", codec: "vp8" },
  "file.no-alpha": {},
  "file.telegram-edge": { width: 500, height: 480, edge: 512 },
  "file.duration-over": { ms: 3200, max: 3000 },
  "file.fps-over": { fps: 60, max: 30 },
  "file.audio": {},
  "file.outside": { width: 340, height: 270, maxWidth: 320, maxHeight: 270 },
  "file.min-side": { width: 200, height: 180, min: 270 },
  "file.frames-range": { frames: 24, min: 5, max: 20 },
  "file.loop-long": { ms: 4200, max: 4000 },
  "file.plays-range": { plays: 0, min: 1, max: 4 },
  "file.plays-total": { plays: 3, ms: 1920, max: 4000 },
  "file.main-plays": { plays: 3, ms: 1920, min: 1, max: 4, maxTotal: 4000 },
  "file.identical": {},
  "file.not-transparent": {},
  "file.margin": { px: 6 },
  "file.first-frame": { percent: 35 },
  "file.corner": {},
  "file.white-outline": { percent: 72 },
  "file.not-opaque": {},
  "file.white-background": { percent: 64 },
  "file.take-stale": { why: [stale] },
  "summary.wechat": { width: 240, height: 240, bytes: 182_000, frames: 16, loops: false },
  "summary.telegram": { width: 512, height: 512, alpha: true, bytes: 98_000, ms: 1920, fps: 30 },
  "summary.line": { width: 320, height: 270, bytes: 640_000, frames: 16, ms: 1920, plays: 2 },
  "summary.still": { width: 750, height: 400, format: "jpg", bytes: 120_000 },
  "summary.still-from-sticker": { width: 100, height: 100, format: "png", bytes: 9_000, sticker: "s01", frame: 3 },
  "rights.ok": { basis: "original", confirmedAt: "2026-11-06", note: "我们自己的吉祥物" },
  "rights.missing": {},
  "platform.unchosen": { platform: "line" },
  "count.allowed": { count: 12, platform: "line", allowed: [8, 16, 24] },
  "count.range": { count: 6, platform: "wechat", min: 8, max: 24, setMax: null },
  "animated.static": { stickers: ["s03", "s05"] },
  "animated.all": { count: 8 },
  "words.bad": { long: [{ sticker: "s02", word: "不想上班了" }], dupes: [{ sticker: "s05", word: "收到" }], max: 4 },
  "words.ok": { count: 8, max: 4 },
  "emoji.bad": { items: [{ sticker: "s03", emoji: "😩😩" }] },
  "emoji.ok": {},
  "listing.empty": { platform: "wechat", field: "intro" },
  "listing.unset": {},
  "listing.bad": { text: "打工牛马的日常！", problems: [{ code: "text.over", params: { length: 9, width: false, max: 8 } }, { code: "text.punctuation", params: {} }] },
  "listing.long": { text: "打工牛马日常", length: 6, width: false, best: 5 },
  "listing.ok": { text: "打工牛马", length: 4, width: false, max: 8, min: null },
  "text.over": { length: 44, width: true, max: 40 },
  "text.under": { length: 3, width: false, min: 5 },
  "text.punctuation": {},
  "zip.ok": { uri: "exports/line.zip", bytes: 61_000_000, files: 10, over: 60_000_000 },
  "zip.blocked": {},
  "zip.missing": { platform: "wechat" },
  "zip.stale": { platform: "telegram" },
  "unconfirmed.reward-thumb": {},
  "unconfirmed.zip-naming": {},
  "next.rights": {},
  "next.anchor": { candidates: ["character-1", "character-2"] },
  "next.describe": {},
  "next.character": {},
  "next.stickers": {},
  "next.generate": { stickers: ["s06", "s08"], uncertain: ["s05"] },
  "next.recover": { stickers: ["s01", "s03"] },
  "next.retry": { stickers: ["s05"] },
  "next.generating": { stickers: ["s04"] },
  "next.pick": { stickers: ["s02"] },
  "next.reroll": { stale: [{ sticker: "s03", why: [stale] }] },
  "next.export": { platform: "wechat" },
  "next.check": { platform: "wechat", rows: [{ id: "listing-intro", label: "表情介绍 intro" }, { id: "sticker-s02", label: "02 · s02" }] },
  "next.confirm": { rows: [{ platform: "line", id: "zip-naming", label: "ZIP file names" }, { platform: "wechat", id: "listing-name", label: "表情名称 name" }] },
  "next.done": {},
};

/** Every sample as a message; the commands the rules attach ride along where they do. */
export function sampleMessages(): StateMessage[] {
  return (Object.keys(SAMPLE_PARAMS) as MessageCode[]).map((code) => {
    const message = { code, params: SAMPLE_PARAMS[code] } as StateMessage;
    return code === "zip.missing" || code === "zip.stale" || code === "export.not-exported" ? { ...message, command: "sticker.mjs export --platform wechat" } : message;
  });
}

/** Every message inside a message, itself first (nested `why`, `problems`, `summary`, …). */
export function allMessages(message: StateMessage): StateMessage[] {
  const out: StateMessage[] = [message];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if (typeof v.code === "string" && v.params && typeof v.params === "object") out.push(...allMessages(v as unknown as StateMessage));
      else Object.values(v).forEach(visit);
    }
  };
  visit(message.params);
  return out;
}

/**
 * English left in Chinese or Japanese text once ids, file names and the
 * format, platform and browser names every language writes the same are
 * taken out.
 */
export function englishIn(text: string): string[] {
  const neutral = text
    .replace(/\b(?:s\d{2,3}(?:-take-\d+)?|character-\d+|art-[a-z]+(?:-[a-z]+)?-\d+|exports\/\w+\.zip|\w+\.png)\b/g, "")
    .replace(/\b(?:gif|apng|webm|vp9|vp8|png|jpg|wechat|telegram|line|chrome|firefox|safari|fps|emoji|kb|mb|zip|px)\b/gi, "");
  return neutral.match(/[A-Za-z]{3,}/g) ?? [];
}
