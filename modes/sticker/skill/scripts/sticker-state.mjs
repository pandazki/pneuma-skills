/**
 * sticker state rules — ONE algorithm for two runtimes.
 *
 * The viewer (`domain.ts`, in a browser bundle) and the CLI (`sticker.mjs`)
 * must never disagree about what a sticker's prompt is, whether a take is
 * stale, whether an export is current, or whether a pack passes a platform's
 * rules. Every such rule lives here, once: pure, no `node:*` imports, no I/O,
 * deterministic (the anime-series `series-state.mjs` precedent).
 *
 * Two files feed it (shapes in `sticker-state.d.mts`):
 *   pack.json                   the pack: text and human decisions
 *                               (agent Edit + viewer Source.write)
 *   project.json → "sticker"    craft project + the measurements the
 *                               checks read (sticker.mjs is its only writer)
 *
 * Asset status follows craft's rule (`craft-project.mjs::statusOf`: an
 * absent status is `ready`). This module cannot import that file — in an
 * installed skill it sits beside this one, in the source tree it does not —
 * so `assetStatus` restates the one-line rule and a test pins the two equal.
 *
 * Platform rules are data (`PLATFORM_PROFILES`), read from the official
 * pages on 2026-11-06 (docs/proposals/2026-11-06-sticker-mode.md). A rule
 * with no official source is flagged `unconfirmed` and its checklist row is
 * a warning, never a pass. Byte limits read "KB" as 1000 bytes and "MB" as
 * 1,000,000 — the stricter reading, so a file that passes here passes either.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PACK_VERSION = 1;
export const SIDECAR_KEY = "sticker";
export const SIDECAR_SCHEMA = 1;
export const PLATFORMS = Object.freeze(["wechat", "telegram", "line"]);
export const RIGHTS_BASES = Object.freeze(["original", "own-pet", "self", "consenting-adult", "client"]);
export const ART_KINDS = Object.freeze(["portrait", "head", "banner", "reward-guide", "reward-thanks"]);
export const STICKER_STATUSES = Object.freeze(["empty", "generating", "failed", "pick", "ready", "stale"]);
export const STICKER_ID_RE = /^s[0-9]{2,3}$/;
/** craft-project.mjs ASSET_ID_PATTERN. */
export const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_STYLE = "thick clean dark outlines, flat colors";
/** 512 is Telegram's edge; 16 × 120 ms is the brief's default loop (1.92 s). */
export const DEFAULT_MOTION = Object.freeze({ frames: 16, frameMs: 120, size: 512 });
/** Sent with every take: transparent 1-bit GIF, medium quality, Flare (the 2026-11-06 probes). */
export const TAKE_REQUEST_DEFAULTS = Object.freeze({ quality: "medium", background: "transparent", model: "flare" });

/**
 * The exporter's recipe version per platform. It is part of every export
 * key: bump it whenever `sticker-media.mjs` changes what a deliverable's
 * bytes would be, and every export of that platform turns stale.
 */
export const EXPORT_RECIPES = Object.freeze({ wechat: 2, telegram: 2, line: 2 });

/** Planning figures said before a paid step. fal reports no usage for GIF jobs. */
export const ESTIMATES = Object.freeze({
  gifUsd: 0.10,
  gifRangeUsd: Object.freeze([0.05, 0.20]),
  /** 26–28 s at 240² / 480² (6 probes); 37.6 s at the 512² × 16 default (1 paid smoke, 2026-11-06). */
  gifSeconds: 38,
  imageUsd: 0.055,
  imageSeconds: Object.freeze([10, 30]),
  note: "2026-11-06: 26–28 s per GIF at 240²/480², 37.6 s at 512²×16; fal reports no usage, so a GIF's price is a planning estimate, never an invoice",
});

const KB = 1000;
const MB = 1000 * 1000;

const WECHAT_SOURCE = Object.freeze({
  url: "https://sticker.weixin.qq.com/",
  what: "制作规范 + 赞赏功能规范, read from the guide page's own JS bundle (build 26052800)",
});
const TELEGRAM_SOURCES = Object.freeze([
  Object.freeze({ url: "https://core.telegram.org/stickers", what: "sticker requirements" }),
  Object.freeze({ url: "https://core.telegram.org/stickers/webm-vp9-encoding", what: "video sticker encoding" }),
  Object.freeze({ url: "https://core.telegram.org/stickers/import-stickers", what: "set limits" }),
  Object.freeze({ url: "https://core.telegram.org/bots/api", what: "Bot API 10.3" }),
]);
const LINE_SOURCES = Object.freeze([
  Object.freeze({ url: "https://creator.line.me/en/guideline/animationsticker/", what: "animation stickers" }),
  Object.freeze({ url: "https://creator.line.me/en/guideline/sticker/", what: "sticker text and set rules" }),
]);

/**
 * Every platform rule, as data. `deliverables` lists what an export makes
 * besides the stickers; `from` names the art kind (or `sticker` for LINE's
 * main image) it is derived from. `when: "reward"` deliverables exist only
 * when the WeChat listing has a `rewardLine`.
 */
export const PLATFORM_PROFILES = Object.freeze({
  wechat: Object.freeze({
    id: "wechat",
    label: "WeChat",
    checked: "2026-11-06",
    sources: Object.freeze([WECHAT_SOURCE]),
    count: Object.freeze({ min: 8, max: 24 }),
    sticker: Object.freeze({ format: "gif", ext: "gif", width: 240, height: 240, maxBytes: 500 * KB, loopForever: true, animated: true }),
    deliverables: Object.freeze({
      cover: Object.freeze({ label: "表情封面图 cover", from: "portrait", formats: Object.freeze(["png"]), width: 240, height: 240, maxBytes: 500 * KB, alpha: "transparent", noWhiteOutline: true, fit: "pad" }),
      icon: Object.freeze({ label: "聊天页图标 icon", from: "head", formats: Object.freeze(["png"]), width: 50, height: 50, maxBytes: 100 * KB, alpha: "transparent", fit: "pad" }),
      banner: Object.freeze({ label: "详情页横幅 banner", from: "banner", formats: Object.freeze(["png", "jpg"]), width: 750, height: 400, maxBytes: 500 * KB, alpha: "opaque", fit: "cover", notWhite: true }),
      "reward-guide": Object.freeze({ label: "赞赏引导图 reward guide", from: "reward-guide", formats: Object.freeze(["png"]), width: 750, height: 560, maxBytes: 500 * KB, alpha: "opaque", fit: "cover", when: "reward" }),
      "reward-thanks": Object.freeze({ label: "赞赏致谢图 reward thanks", from: "reward-thanks", formats: Object.freeze(["png"]), width: 750, height: 750, maxBytes: 500 * KB, alpha: "opaque", fit: "cover", when: "reward" }),
    }),
    text: Object.freeze({
      name: Object.freeze({ label: "表情名称 name", max: 8, best: 5, noPunctuation: true, required: true }),
      intro: Object.freeze({ label: "表情介绍 intro", max: 80, required: true }),
      copyright: Object.freeze({ label: "版权 copyright", max: 10, required: true }),
      rewardLine: Object.freeze({ label: "赞赏引导语 reward line", min: 5, max: 15, required: false }),
    }),
    word: Object.freeze({ max: 4, unique: true }),
    listingFile: "上架文案.md",
    unconfirmed: Object.freeze([
      Object.freeze({ id: "reward-thumb", label: "赞赏缩略图 reward thumbnail", when: "reward", detail: "the reward section requires it but never gives its size or format — not exported; prepare it by hand" }),
    ]),
  }),
  telegram: Object.freeze({
    id: "telegram",
    label: "Telegram",
    checked: "2026-11-06",
    sources: TELEGRAM_SOURCES,
    count: Object.freeze({ min: 1, max: 50, setMax: 120 }),
    sticker: Object.freeze({ format: "webm", ext: "webm", codec: "vp9", edge: 512, maxDurationMs: 3000, fps: 30, maxBytes: 256 * KB, audio: false }),
    deliverables: Object.freeze({
      thumb: Object.freeze({ label: "set thumbnail", from: "portrait", formats: Object.freeze(["png"]), width: 100, height: 100, maxBytes: 128 * KB, alpha: "transparent", fit: "pad", optional: true }),
    }),
    text: Object.freeze({
      title: Object.freeze({ label: "set title", required: true }),
      shortName: Object.freeze({ label: "short name (link)", required: true }),
    }),
    emoji: Object.freeze({ min: 1, max: 20, exported: 1 }),
    listingFile: "listing.md",
    unconfirmed: Object.freeze([]),
  }),
  line: Object.freeze({
    id: "line",
    label: "LINE",
    checked: "2026-11-06",
    sources: LINE_SOURCES,
    count: Object.freeze({ allowed: Object.freeze([8, 16, 24]) }),
    sticker: Object.freeze({
      format: "apng", ext: "png", maxWidth: 320, maxHeight: 270, minLongSide: 270, cropMargins: true,
      minFrames: 5, maxFrames: 20, maxLoopMs: 4000, minPlays: 1, maxPlays: 4, maxTotalMs: 4000, maxBytes: 1 * MB,
    }),
    deliverables: Object.freeze({
      main: Object.freeze({ label: "main image", from: "sticker", formats: Object.freeze(["apng"]), width: 240, height: 240, maxBytes: 1 * MB, alpha: "transparent", fit: "pad", animated: true }),
      tab: Object.freeze({ label: "tab image", from: "head", formats: Object.freeze(["png"]), width: 96, height: 74, maxBytes: 1 * MB, alpha: "transparent", fit: "pad" }),
    }),
    text: Object.freeze({
      title: Object.freeze({ label: "title", max: 40, asianWidth: true, required: true }),
      creator: Object.freeze({ label: "creator", max: 50, asianWidth: true, required: false }),
      description: Object.freeze({ label: "description", max: 160, asianWidth: true, required: true }),
      copyright: Object.freeze({ label: "copyright", max: 50, asianWidth: true, required: true }),
    }),
    zip: Object.freeze({ maxBytes: 60 * MB }),
    listingFile: "listing.md",
    unconfirmed: Object.freeze([
      Object.freeze({ id: "zip-naming", label: "ZIP file names", detail: "01.png…, main.png, tab.png come from third-party guides only — confirm on the upload page" }),
    ]),
  }),
});

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** FNV-1a 32-bit over UTF-16 code units, 8 lowercase hex digits. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function hashValue(value) {
  return fnv1a(canonicalJson(value));
}

/** craft's rule (`craft-project.mjs::statusOf`): an absent status is `ready`. */
export function assetStatus(asset) {
  return asset ? asset.status ?? "ready" : undefined;
}

/** Characters as a person counts them (code points). */
export function charLength(text) {
  return [...String(text ?? "")].length;
}

const ASIAN_WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠￠-￦]/u;

/** LINE's count: an Asian (full-width) character counts 2, anything else 1. */
export function asianWidthLength(text) {
  let n = 0;
  for (const ch of String(text ?? "")) n += ASIAN_WIDE.test(ch) ? 2 : 1;
  return n;
}

export function hasPunctuation(text) {
  return /[\p{P}\p{S}]/u.test(String(text ?? ""));
}

function graphemes(text) {
  const value = String(text ?? "");
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(value)].map((s) => s.segment);
  }
  return [...value];
}

/** Exactly one emoji (one grapheme that is pictographic, a flag or a keycap). */
export function isSingleEmoji(text) {
  const parts = graphemes(String(text ?? "").trim());
  if (parts.length !== 1) return false;
  const g = parts[0];
  return /\p{Extended_Pictographic}/u.test(g) || /^\p{Regional_Indicator}{2}$/u.test(g) || /^[0-9#*]️?⃣$/u.test(g);
}

/** The caption's script, as one word the prompt can use ("" for Latin or none). */
export function captionLanguage(caption) {
  const text = String(caption ?? "");
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "Japanese";
  if (/\p{Script=Hangul}/u.test(text)) return "Korean";
  if (/\p{Script=Han}/u.test(text)) return "Chinese";
  return "";
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "? B";
  if (n >= MB) return `${(n / MB).toFixed(2)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} B`;
}

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
}

// ---------------------------------------------------------------------------
// pack.json — parse and validate with named errors
// ---------------------------------------------------------------------------

function issue(list, path, message) {
  list.push({ path, message: `${path}: ${message}` });
}

function optionalString(value, path, errors) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    issue(errors, path, `must be a string (got ${typeof value})`);
    return "";
  }
  return value;
}

function positiveInteger(value, path, errors, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    issue(errors, path, `must be a positive integer (got ${JSON.stringify(value)})`);
    return fallback;
  }
  return value;
}

/**
 * Validate a parsed pack.json value. Never throws. Errors name the field
 * (`stickers[2].caption: …`). `pack` is the normalised pack (defaults
 * applied); the file itself is never rewritten by this function.
 */
export function validatePack(value) {
  const errors = [];
  const warnings = [];
  if (!isRecord(value)) {
    issue(errors, "pack.json", "must be a JSON object");
    return { ok: false, errors, warnings };
  }
  if (value.version !== PACK_VERSION) issue(errors, "version", `must be ${PACK_VERSION} (got ${JSON.stringify(value.version)})`);

  // rights — may be absent before the gate; paid steps refuse without it.
  let rights = null;
  if (value.rights !== undefined && value.rights !== null) {
    if (!isRecord(value.rights)) issue(errors, "rights", "must be an object { basis, note?, confirmedAt }");
    else {
      const { basis, note, confirmedAt } = value.rights;
      if (!RIGHTS_BASES.includes(basis)) issue(errors, "rights.basis", `must be one of ${RIGHTS_BASES.join(", ")} (got ${JSON.stringify(basis)})`);
      if (typeof confirmedAt !== "string" || !DATE_RE.test(confirmedAt)) issue(errors, "rights.confirmedAt", `must be a YYYY-MM-DD date (got ${JSON.stringify(confirmedAt)})`);
      rights = { basis, note: optionalString(note, "rights.note", errors), confirmedAt };
    }
  }

  // platforms
  let platforms = [];
  if (!Array.isArray(value.platforms) || !value.platforms.length) {
    issue(errors, "platforms", `must be a non-empty list of ${PLATFORMS.join(", ")}`);
  } else {
    value.platforms.forEach((p, i) => {
      if (!PLATFORMS.includes(p)) issue(errors, `platforms[${i}]`, `must be one of ${PLATFORMS.join(", ")} (got ${JSON.stringify(p)})`);
      else if (platforms.includes(p)) issue(errors, `platforms[${i}]`, `'${p}' is listed twice`);
      else platforms.push(p);
    });
  }

  // character
  const characterRaw = value.character ?? {};
  if (!isRecord(characterRaw)) issue(errors, "character", "must be an object { description, style, anchor }");
  const character = {
    description: optionalString(characterRaw.description, "character.description", errors),
    style: optionalString(characterRaw.style, "character.style", errors) || DEFAULT_STYLE,
    anchor: null,
  };
  if (characterRaw.anchor !== undefined && characterRaw.anchor !== null) {
    if (typeof characterRaw.anchor !== "string" || !ASSET_ID_RE.test(characterRaw.anchor)) issue(errors, "character.anchor", `must be an asset id such as character-1, or null (got ${JSON.stringify(characterRaw.anchor)})`);
    else character.anchor = characterRaw.anchor;
  }

  // motion
  const motionRaw = value.motion ?? {};
  if (!isRecord(motionRaw)) issue(errors, "motion", "must be an object { frames, frameMs, size }");
  const motion = {
    frames: positiveInteger(motionRaw.frames, "motion.frames", errors, DEFAULT_MOTION.frames),
    frameMs: positiveInteger(motionRaw.frameMs, "motion.frameMs", errors, DEFAULT_MOTION.frameMs),
    size: positiveInteger(motionRaw.size, "motion.size", errors, DEFAULT_MOTION.size),
  };
  if (motion.frames < 2) issue(errors, "motion.frames", "an animation needs at least 2 frames");
  if (motion.size % 16) issue(errors, "motion.size", `must be a multiple of 16 (fal's frame rule; got ${motion.size})`);
  if (motion.size < PLATFORM_PROFILES.telegram.sticker.edge) {
    warnings.push(`motion.size ${motion.size} is under Telegram's ${PLATFORM_PROFILES.telegram.sticker.edge} px edge — Telegram exports are scaled up`);
  }

  // listing
  const listingRaw = value.listing ?? {};
  const listing = {};
  if (!isRecord(listingRaw)) issue(errors, "listing", "must be an object keyed by platform");
  else {
    for (const [platform, fields] of Object.entries(listingRaw)) {
      if (!PLATFORMS.includes(platform)) {
        issue(errors, `listing.${platform}`, `is not a platform (${PLATFORMS.join(", ")})`);
        continue;
      }
      if (!isRecord(fields)) {
        issue(errors, `listing.${platform}`, "must be an object of text fields");
        continue;
      }
      if (!platforms.includes(platform)) warnings.push(`listing.${platform} is ignored: '${platform}' is not in platforms`);
      const known = Object.keys(PLATFORM_PROFILES[platform].text);
      const out = {};
      for (const [field, text] of Object.entries(fields)) {
        if (!known.includes(field)) {
          warnings.push(`listing.${platform}.${field} is not a ${PLATFORM_PROFILES[platform].label} listing field (${known.join(", ")})`);
          continue;
        }
        out[field] = optionalString(text, `listing.${platform}.${field}`, errors);
      }
      listing[platform] = out;
    }
  }

  // stickers
  const stickers = [];
  if (!Array.isArray(value.stickers)) issue(errors, "stickers", "must be a list (it may be empty)");
  else {
    const seen = new Set();
    value.stickers.forEach((raw, i) => {
      const at = `stickers[${i}]`;
      if (!isRecord(raw)) {
        issue(errors, at, "must be an object { id, word, caption, emoji, action, take, keepFrames }");
        return;
      }
      const sticker = {
        id: raw.id,
        word: optionalString(raw.word, `${at}.word`, errors),
        caption: optionalString(raw.caption, `${at}.caption`, errors),
        emoji: optionalString(raw.emoji, `${at}.emoji`, errors),
        action: optionalString(raw.action, `${at}.action`, errors),
        take: null,
        keepFrames: null,
      };
      if (typeof raw.id !== "string" || !STICKER_ID_RE.test(raw.id)) issue(errors, `${at}.id`, `must look like s01 (got ${JSON.stringify(raw.id)})`);
      else if (seen.has(raw.id)) issue(errors, `${at}.id`, `'${raw.id}' is used twice`);
      else seen.add(raw.id);
      if (raw.take !== undefined && raw.take !== null) {
        if (typeof raw.take !== "string" || !ASSET_ID_RE.test(raw.take)) issue(errors, `${at}.take`, `must be a take asset id such as ${raw.id ?? "s01"}-take-1, or null (got ${JSON.stringify(raw.take)})`);
        else if (typeof raw.id === "string" && !raw.take.startsWith(`${raw.id}-take-`)) issue(errors, `${at}.take`, `'${raw.take}' is not a take of ${raw.id} (${raw.id}-take-<n>)`);
        else sticker.take = raw.take;
      }
      if (raw.keepFrames !== undefined && raw.keepFrames !== null) {
        const k = raw.keepFrames;
        const valid = Array.isArray(k) && k.length >= 2 && k.every((n, j) => Number.isInteger(n) && n >= 0 && (j === 0 || n > k[j - 1]));
        if (!valid) issue(errors, `${at}.keepFrames`, "must be null or at least 2 frame indices (0-based), strictly increasing");
        else sticker.keepFrames = [...k];
      }
      stickers.push(sticker);
    });
  }

  // art
  const artRaw = value.art ?? {};
  const art = {};
  if (!isRecord(artRaw)) issue(errors, "art", `must be an object keyed by art kind (${ART_KINDS.join(", ")}) and lineMain`);
  else {
    for (const [key, id] of Object.entries(artRaw)) {
      if (key === "lineMain") {
        if (id === null || id === undefined) continue;
        if (typeof id !== "string" || !stickers.some((s) => s.id === id)) issue(errors, "art.lineMain", `must be a sticker id from stickers[] (got ${JSON.stringify(id)})`);
        else art.lineMain = id;
        continue;
      }
      if (!ART_KINDS.includes(key)) {
        issue(errors, `art.${key}`, `is not an art kind (${ART_KINDS.join(", ")}, lineMain)`);
        continue;
      }
      if (id === null || id === undefined) continue;
      if (typeof id !== "string" || !id.startsWith(`art-${key}-`) || !ASSET_ID_RE.test(id)) issue(errors, `art.${key}`, `must be an asset id such as art-${key}-1, or null (got ${JSON.stringify(id)})`);
      else art[key] = id;
    }
  }

  const knownTop = ["version", "rights", "platforms", "character", "motion", "listing", "stickers", "art"];
  for (const key of Object.keys(value)) {
    if (!knownTop.includes(key)) warnings.push(`'${key}' is not a pack.json field; it is kept but nothing reads it`);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, pack: { version: PACK_VERSION, rights, platforms, character, motion, listing, stickers, art }, warnings };
}

/** `JSON.parse` + `validatePack`. Never throws. */
export function parsePack(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ path: "pack.json", message: `pack.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }], warnings: [] };
  }
  return validatePack(value);
}

// ---------------------------------------------------------------------------
// Asset ids
// ---------------------------------------------------------------------------

export const ids = Object.freeze({
  characterSource: (n) => `character-source-${n}`,
  character: (n) => `character-${n}`,
  take: (sid, n) => `${sid}-take-${n}`,
  art: (kind, n) => `art-${kind}-${n}`,
  exported: (platform, deliverable) => `${platform}-${deliverable}`,
});

/** Workspace paths, relative to the pack's directory. */
export const paths = Object.freeze({
  characterSource: (n, ext) => `character/source-${n}${ext}`,
  character: (n, ext = ".png") => `character/anchor-${n}${ext}`,
  take: (sid, n) => `stickers/${sid}/take-${n}.gif`,
  art: (kind, n, ext = ".png") => `art/${kind}-${n}${ext}`,
  exportDir: (platform) => `exports/${platform}`,
  archive: (platform) => `exports/${platform}.zip`,
  listing: (platform) => `exports/${platform}/${PLATFORM_PROFILES[platform].listingFile}`,
  inspect: (takeId) => `inspect/${takeId}-contact.png`,
});

function numbered(project, re) {
  const out = [];
  for (const asset of project?.assets ?? []) {
    const m = re.exec(asset.id);
    if (m) out.push({ n: Number(m[1]), asset });
  }
  return out.sort((a, b) => a.n - b.n);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** The next free number for an id family (failed and pending ids are never reused). */
export function nextNumber(project, prefix) {
  const found = numbered(project, new RegExp(`^${escapeRe(prefix)}(\\d+)$`));
  return found.length ? found[found.length - 1].n + 1 : 1;
}

function edgeOf(project, id) {
  return (project?.provenance ?? []).find((e) => e.toAssetId === id) ?? null;
}

function assetOf(project, id) {
  return (project?.assets ?? []).find((a) => a.id === id) ?? null;
}

/** Character candidates (`character-<n>`) and sources (`character-source-<n>`). */
export function characterAssets(project) {
  return {
    candidates: numbered(project, /^character-(\d+)$/).map(({ asset }) => asset),
    sources: numbered(project, /^character-source-(\d+)$/).map(({ asset }) => asset),
  };
}

/** Art candidates of one kind, in number order. */
export function artAssets(project, kind) {
  return numbered(project, new RegExp(`^art-${escapeRe(kind)}-(\\d+)$`)).map(({ asset }) => asset);
}

// ---------------------------------------------------------------------------
// Prompts — the one authority
// ---------------------------------------------------------------------------

/** The settings every take of this pack is requested with (recorded as `params.request`). */
export function stickerRequest(pack) {
  return {
    frames: pack.motion.frames,
    frameMs: pack.motion.frameMs,
    size: pack.motion.size,
    quality: TAKE_REQUEST_DEFAULTS.quality,
    background: TAKE_REQUEST_DEFAULTS.background,
    model: TAKE_REQUEST_DEFAULTS.model,
  };
}

/** The pack text a sticker prompt reads (recorded as `params.promptInputs` for stale reasons). */
export function stickerPromptInputs(pack, sticker) {
  return {
    description: pack.character.description,
    style: pack.character.style,
    word: sticker.word,
    caption: sticker.caption,
    action: sticker.action,
  };
}

/**
 * The white die-cut border every take asks for. Without it a dark-outlined
 * character melts into a dark chat background: in the 2026-11-06 outline
 * experiment (2 stickers × 2 takes per variant, 512² × 16, the seed's anchor)
 * the outline, the dark hooves and the motion marks vanished on the #111
 * plate in 4 of 4 takes without the clause and read in 4 of 4 with it;
 * identity and captions held in all 8 (record: skill/references/prompting.md).
 */
export const STICKER_BORDER = "Surround the whole character with a thick white sticker border, like a die-cut sticker, so it stands out on a dark chat background.";

/**
 * The prompt for a take of `sticker`, assembled from pack.json alone. The CLI
 * sends exactly this and records it on the take's edge; the viewer runs the
 * same function to tell whether a take is stale. The wording is the
 * 2026-11-06 probe prompt that held identity and drew captions without a
 * typo (5 GIFs, 64 frames), plus the character's written identity and the
 * white sticker border (`STICKER_BORDER`).
 */
export function stickerPrompt(pack, sticker) {
  const { description, style } = pack.character;
  const parts = [
    "Use the character in the input image exactly: same face, body shape, colors, markings and line style.",
  ];
  if (description.trim()) parts.push(`The character: ${description.trim().replace(/\.?$/, ".")}`);
  parts.push(`Style: ${style.trim().replace(/\.?$/, ".")}`);
  parts.push("A short looping animated chat sticker.");
  if (!sticker.caption && sticker.word.trim()) parts.push(`It expresses "${sticker.word.trim()}" through pose and face only.`);
  parts.push(
    "Same character size and same ground line in every frame, the whole character always fully inside the frame with a clear margin.",
    "Exaggerated facial expression that reads at a tiny size.",
    "All shapes solid and crisp: no motion blur, no dust, no semi-transparent effects.",
    STICKER_BORDER,
    "Fully transparent background.",
    "The last frame flows smoothly back into the first.",
  );
  if (sticker.action.trim()) parts.push(`Action: ${sticker.action.trim().replace(/\.?$/, ".")}`);
  if (sticker.caption) {
    const lang = captionLanguage(sticker.caption);
    parts.push(
      `Add one big bold hand-lettered ${lang ? `${lang} ` : ""}caption at the bottom, identical and in the same place in every frame, reading exactly: "${sticker.caption}".`,
      "Give the caption a thick white outline. No other text.",
    );
  } else {
    parts.push("No text, letters or symbols anywhere.");
  }
  return parts.join(" ");
}

/**
 * The character redraw. `fromImage`: a source photo or image goes along as
 * the reference; without it the character is designed from the description.
 */
export function characterPrompt(pack, { fromImage = true } = {}) {
  const { description, style } = pack.character;
  const who = description.trim() ? description.trim().replace(/\.?$/, ".") : "";
  return [
    fromImage
      ? `Redraw the subject of the input image as an original chat-sticker character.${who ? ` Keep who it is: ${who}` : ""}`
      : `Design an original chat-sticker character: ${who || "a friendly mascot."}`,
    `Style: ${style.trim().replace(/\.?$/, ".")}`,
    "Full body, front view, standing, centered, with a clear margin on every side.",
    "Simple bold shapes that still read at 240 pixels, and a friendly neutral expression.",
    "Fully transparent background. No text, no ground shadow, no frame.",
  ].join(" ");
}

/**
 * What each art kind is: prompt body, OpenRouter aspect ratio and background.
 * `themed` kinds are scenes: `artPrompt` puts the pack's theme in front of
 * the body, so the scene belongs to this pack and not to the character's
 * species (the 2026-11-06 smoke drew an office ox's banner as a farm).
 * The head prompt names what to leave out: with a full-body anchor attached,
 * "only the head" alone came back as the whole figure (seed run, 2026-11-06).
 */
export const ART_SPECS = Object.freeze({
  portrait: Object.freeze({ aspectRatio: "1:1", background: "transparent", themed: false, body: "Front half-body portrait facing the viewer with a happy expression, centered with a small margin. Fully transparent background. No text, no frame, no white outline around the character." }),
  head: Object.freeze({ aspectRatio: "1:1", background: "transparent", themed: false, body: "A close-up of the head only, front view, cut off just below the chin: no body, no legs, no hooves in the picture. Bold and simple, the head filling most of the square with a small margin. Fully transparent background. No text, no frame, no white outline around the character." }),
  banner: Object.freeze({ aspectRatio: "16:9", background: "opaque", themed: true, body: "A wide banner scene set in that world: the character in the middle of one of its typical moments, with a few props that belong there. Full-bleed, colorful, not a white background, nothing important near the edges." }),
  "reward-guide": Object.freeze({ aspectRatio: "4:3", background: "opaque", themed: true, body: "A cheerful full-bleed scene set in that world: the character happily holding out a small cup, inviting a tip. Colorful, not a white background." }),
  "reward-thanks": Object.freeze({ aspectRatio: "1:1", background: "opaque", themed: true, body: "A warm full-bleed scene set in that world: the character bowing to say thank you, small hearts around it. Colorful, not a white background." }),
});

/**
 * What the pack is about, from its own text: the name and blurb of the
 * first chosen platform's listing that has them, else the stickers' words.
 * Empty when the pack says nothing yet.
 */
export function packTheme(pack) {
  const listing = pack.listing ?? {};
  const pick = (fields) => {
    for (const platform of pack.platforms) {
      for (const [p, field] of fields) {
        const text = p === platform ? listing[p]?.[field]?.trim() : "";
        if (text) return text;
      }
    }
    return "";
  };
  const name = pick([["wechat", "name"], ["telegram", "title"], ["line", "title"]]);
  const about = pick([["wechat", "intro"], ["line", "description"]]);
  const words = pack.stickers.map((s) => s.word.trim()).filter(Boolean);
  return { name, about, words };
}

function themeSentence(pack) {
  const { name, about, words } = packTheme(pack);
  const said = [
    name ? `The sticker pack is called "${name}".` : null,
    about ? `What it is about: ${about.replace(/[.。]?$/, ".")}` : words.length ? `Its stickers say: ${words.join(", ")}.` : null,
  ].filter(Boolean);
  if (!said.length) return "Set the scene in a lively everyday world that suits the character.";
  return `${said.join(" ")} Set the scene in the world this pack is about, not in a place the character's species suggests.`;
}

/** An art kind's request: the anchor goes along as the reference. */
export function artPrompt(pack, kind) {
  const spec = ART_SPECS[kind];
  if (!spec) throw new Error(`unknown art kind '${kind}' (${ART_KINDS.join(", ")})`);
  const { description, style } = pack.character;
  const prompt = [
    "Use the character in the input image exactly: same face, body shape, colors, markings and line style.",
    description.trim() ? `The character: ${description.trim().replace(/\.?$/, ".")}` : null,
    `Style: ${style.trim().replace(/\.?$/, ".")}`,
    spec.themed ? themeSentence(pack) : null,
    spec.body,
    spec.themed ? "The pack's name and words are context only: do not write them or any other words in the picture. No text, no letters, no logos." : null,
  ].filter(Boolean).join(" ");
  return { prompt, aspectRatio: spec.aspectRatio, background: spec.background };
}

// ---------------------------------------------------------------------------
// Takes and per-sticker status
// ---------------------------------------------------------------------------

/** A sticker's takes (`<sid>-take-<n>`), in number order, with their edges. */
export function takesOf(project, sid) {
  return numbered(project, new RegExp(`^${escapeRe(sid)}-take-(\\d+)$`)).map(({ n, asset }) => {
    const edge = edgeOf(project, asset.id);
    return { id: asset.id, n, status: assetStatus(asset), asset, edge, actor: edge?.operation?.actor ?? null, op: edge?.operation?.type ?? null };
  });
}

function findSticker(pack, sid) {
  return pack.stickers.find((s) => s.id === sid) ?? null;
}

/**
 * Whether a take still matches pack.json: its recorded prompt and request
 * against the ones the pack makes now, its recorded input against the
 * current anchor. `reasons` say what changed, in words.
 */
export function takeStaleness(pack, project, takeId) {
  const sid = takeId.replace(/-take-\d+$/, "");
  const sticker = findSticker(pack, sid);
  const edge = edgeOf(project, takeId);
  if (!sticker) return { stale: true, reasons: [`${sid} is no longer in pack.json`] };
  if (!edge) return { stale: true, reasons: [`${takeId} has no provenance record`] };
  const params = edge.operation?.params ?? {};
  const reasons = [];
  const recordedPrompt = params.prompt ?? null;
  const prompt = stickerPrompt(pack, sticker);
  if (recordedPrompt !== prompt) {
    const before = isRecord(params.promptInputs) ? params.promptInputs : null;
    const now = stickerPromptInputs(pack, sticker);
    // The word reaches the prompt only for a sticker without a caption.
    const wordCounts = !now.caption || !(before?.caption ?? "");
    const changed = before ? Object.keys(now).filter((k) => (k !== "word" || wordCounts) && (before[k] ?? "") !== now[k]) : [];
    if (changed.length) reasons.push(...changed.map((k) => (k === "description" ? "character description changed" : k === "style" ? "character style changed" : `${k} changed`)));
    else reasons.push(recordedPrompt === null ? "no prompt was recorded for it" : "the prompt wording changed");
  }
  const request = isRecord(params.request) ? params.request : null;
  const current = stickerRequest(pack);
  for (const k of ["frames", "frameMs", "size"]) {
    if (request && request[k] !== current[k]) reasons.push(`motion.${k} changed (${request[k]} → ${current[k]})`);
  }
  const from = edge.fromAssetId ?? null;
  if (from !== pack.character.anchor) reasons.push(`the character anchor changed (${from ?? "none"} → ${pack.character.anchor ?? "none"})`);
  return { stale: reasons.length > 0, reasons };
}

/**
 * One sticker's status — derived, never hand-maintained:
 *   generating  a take is pending or generating
 *   ready       the picked take is ready and matches pack.json
 *   stale       the picked take is ready but pack.json moved on (`reason`)
 *   pick        a ready take exists and none is (validly) picked
 *   failed      takes exist and every one failed
 *   empty       no take at all
 */
export function stickerState(pack, project, sid) {
  const sticker = findSticker(pack, sid);
  if (!sticker) throw new Error(`no sticker '${sid}' in pack.json`);
  const takes = takesOf(project, sid);
  const inFlight = takes.filter((t) => t.status === "pending" || t.status === "generating").map((t) => t.id);
  const ready = takes.filter((t) => t.status === "ready").map((t) => t.id);
  const failed = takes.filter((t) => t.status === "failed").map((t) => t.id);
  const picked = sticker.take;
  const pickedReady = picked !== null && ready.includes(picked);
  const base = { id: sid, takes: takes.map((t) => t.id), ready, failed, inFlight, picked, effective: pickedReady ? picked : null };
  if (inFlight.length) return { ...base, status: "generating", reason: `${inFlight.join(", ")} in flight` };
  if (pickedReady) {
    const { stale, reasons } = takeStaleness(pack, project, picked);
    return stale ? { ...base, status: "stale", reason: reasons.join("; "), reasons } : { ...base, status: "ready", reason: null };
  }
  if (ready.length) {
    const why = picked === null ? "no take picked" : `picked ${picked} is ${assetStatus(assetOf(project, picked)) ?? "not in project.json"}`;
    return { ...base, status: "pick", reason: `${why}; ready: ${ready.join(", ")}` };
  }
  if (failed.length) return { ...base, status: "failed", reason: `${failed.length} take(s) failed` };
  return { ...base, status: "empty", reason: null };
}

/** Every sticker's state, in pack order. */
export function stickerStates(pack, project) {
  return pack.stickers.map((s) => stickerState(pack, project, s.id));
}

/**
 * What `sticker.mjs gen` makes — the one rule gen, quote and `nextStep` read.
 *
 *   default    every sticker with no take, and every sticker whose takes all
 *              failed when the latest failure provably never left (billing
 *              `none`). A sticker whose latest take failed with billing
 *              `unknown` may already have been charged: it goes to
 *              `uncertain`, and a plain gen does not send it again.
 *   only       the named stickers that are empty or failed. Naming an
 *              uncertain sticker is the explicit retry.
 *   redo       every chosen sticker gets a new take, whatever its state.
 *
 * Returns `{ targets: [{ id, status }], skipped: [{ id, status }],
 * uncertain: [{ id, take, reason }] }` in pack order. An unknown `only` id
 * throws.
 */
export function genTargets(pack, project, { only = [], redo = false } = {}) {
  for (const id of only) {
    if (!findSticker(pack, id)) throw new Error(`--only: no sticker '${id}' in pack.json (${pack.stickers.map((s) => s.id).join(", ") || "none"})`);
  }
  const targets = [];
  const skipped = [];
  const uncertain = [];
  for (const sticker of pack.stickers) {
    if (only.length && !only.includes(sticker.id)) continue;
    const state = stickerState(pack, project, sticker.id);
    if (redo || state.status === "empty") {
      targets.push({ id: sticker.id, status: state.status });
      continue;
    }
    if (state.status !== "failed") {
      skipped.push({ id: sticker.id, status: state.status });
      continue;
    }
    const latest = takesOf(project, sticker.id).at(-1);
    const failure = latest?.edge?.operation?.params?.failure ?? null;
    if (failure?.billing === "none" || only.length) targets.push({ id: sticker.id, status: state.status });
    else uncertain.push({ id: sticker.id, take: latest?.id ?? null, reason: failure?.reason ?? "no failure recorded" });
  }
  return { targets, skipped, uncertain };
}

/** The picked anchor if it is a ready character asset, else null with why. */
export function anchorState(pack, project) {
  const anchor = pack.character.anchor;
  if (!anchor) return { anchor: null, ready: false, reason: "character.anchor is not set" };
  const asset = assetOf(project, anchor);
  const status = assetStatus(asset);
  if (status !== "ready") return { anchor, ready: false, reason: `character.anchor '${anchor}' is ${status ?? "not in project.json"}` };
  return { anchor, ready: true, reason: null };
}

// ---------------------------------------------------------------------------
// Exports — deliverables, keys, staleness
// ---------------------------------------------------------------------------

/** Two-digit position in pack order: 01, 02, … (three digits past 99). */
export function exportNumber(index, total) {
  return String(index + 1).padStart(total > 99 ? 3 : 2, "0");
}

function rewardOn(pack) {
  return Boolean(pack.listing?.wechat?.rewardLine?.trim());
}

/** The LINE main image's sticker: `art.lineMain`, else the first sticker. */
export function lineMainSticker(pack) {
  return pack.art.lineMain ?? pack.stickers[0]?.id ?? null;
}

/**
 * Everything an export of `platform` makes, in order: one entry per sticker
 * (pack order), then the platform's other deliverables that apply.
 * `name` is the file name without extension inside `exports/<platform>/`.
 */
export function platformDeliverables(pack, platform) {
  const profile = PLATFORM_PROFILES[platform];
  if (!profile) throw new Error(`unknown platform '${platform}'`);
  const out = pack.stickers.map((s, i) => ({
    deliverable: s.id,
    kind: "sticker",
    assetId: ids.exported(platform, s.id),
    name: exportNumber(i, pack.stickers.length),
    ext: profile.sticker.ext,
    sticker: s.id,
    art: null,
  }));
  for (const [name, spec] of Object.entries(profile.deliverables)) {
    if (spec.when === "reward" && !rewardOn(pack)) continue;
    if (spec.from === "sticker") {
      out.push({ deliverable: name, kind: "main", assetId: ids.exported(platform, name), name, ext: "png", sticker: lineMainSticker(pack), art: null });
    } else {
      out.push({ deliverable: name, kind: "art", assetId: ids.exported(platform, name), name, ext: null, sticker: null, art: spec.from, optional: Boolean(spec.optional) });
    }
  }
  return out;
}

const STATUS_WORDS = Object.freeze({ empty: "no take yet", failed: "every take failed", generating: "still generating", pick: "no take picked" });

/** The source asset an export derives from, or null with why not. */
export function deliverableSource(pack, project, item) {
  if (item.kind === "sticker" || item.kind === "main") {
    if (!item.sticker) return { asset: null, reason: "the pack has no sticker" };
    const state = stickerState(pack, project, item.sticker);
    if (!state.effective) return { asset: null, reason: `${item.sticker}: ${STATUS_WORDS[state.status] ?? state.status}${state.reason && state.status === "pick" ? ` (${state.reason})` : ""}` };
    return { asset: assetOf(project, state.effective), reason: null };
  }
  const picked = pack.art[item.art] ?? null;
  if (!picked) return { asset: null, reason: `art.${item.art} is not picked` };
  const asset = assetOf(project, picked);
  if (assetStatus(asset) !== "ready") return { asset: null, reason: `art.${item.art} '${picked}' is ${assetStatus(asset) ?? "not in project.json"}` };
  return { asset, reason: null };
}

/**
 * The export key: a hash of everything the deliverable's bytes are a
 * function of — the source asset (and its landing time), keepFrames, the
 * file name, the platform's rules and the recipe version. Same key, same
 * file; the exporter skips a deliverable whose recorded key matches.
 */
export function exportKey(pack, project, platform, item) {
  const source = deliverableSource(pack, project, item);
  if (!source.asset) return null;
  const sticker = item.sticker ? findSticker(pack, item.sticker) : null;
  const profile = PLATFORM_PROFILES[platform];
  return hashValue({
    recipe: EXPORT_RECIPES[platform],
    platform,
    deliverable: item.deliverable,
    name: item.name,
    source: source.asset.id,
    sourceAt: source.asset.createdAt ?? null,
    keepFrames: sticker?.keepFrames ?? null,
    rules: item.kind === "sticker" ? profile.sticker : profile.deliverables[item.deliverable],
  });
}

/** The sidecar with its containers present (a missing sidecar reads as empty). */
export function sidecarOf(project) {
  const s = isRecord(project?.[SIDECAR_KEY]) ? project[SIDECAR_KEY] : {};
  return { schema: s.schema ?? SIDECAR_SCHEMA, measures: isRecord(s.measures) ? s.measures : {}, archives: isRecord(s.archives) ? s.archives : {} };
}

/**
 * The sidecar with only the records that still describe something, for
 * `sticker.mjs` to write back on every save: a measurement whose asset the
 * project records, and a platform's archive record whose `entries` are all
 * files of that platform's recorded exports. Anything dropped here is
 * already ignored by `exportState` (which reads the narrower pack-based
 * set), so pruning changes no state, row or step. Pure: returns a new
 * sidecar (key order kept) and what it dropped.
 */
export function pruneSidecar(project) {
  const raw = isRecord(project?.[SIDECAR_KEY]) ? project[SIDECAR_KEY] : {};
  const assets = project?.assets ?? [];
  const ids = new Set(assets.map((a) => a.id));
  const measures = {};
  const archives = {};
  const dropped = { measures: [], archives: [] };
  for (const [id, m] of Object.entries(isRecord(raw.measures) ? raw.measures : {})) {
    if (ids.has(id)) measures[id] = m;
    else dropped.measures.push(id);
  }
  for (const [platform, record] of Object.entries(isRecord(raw.archives) ? raw.archives : {})) {
    const files = new Set(assets.filter((a) => a.id.startsWith(`${platform}-`) && a.uri).map((a) => a.uri.split("/").pop()));
    if (isRecord(record) && Array.isArray(record.entries) && record.entries.every((name) => files.has(name))) archives[platform] = record;
    else dropped.archives.push(platform);
  }
  return { sidecar: { ...raw, schema: raw.schema ?? SIDECAR_SCHEMA, measures, archives }, dropped };
}

/** The archive key: its member files' keys, in order. Null when any member is missing or stale. */
export function archiveKey(platform, members) {
  return hashValue({ recipe: EXPORT_RECIPES[platform], members });
}

/**
 * Per-platform export state. Each deliverable is `current`, `stale`
 * (exported from other inputs), `missing` (never exported) or `blocked`
 * (its source is not there yet: no picked take, no picked art).
 */
export function exportState(pack, project, platform) {
  const sidecar = sidecarOf(project);
  const items = platformDeliverables(pack, platform).map((item) => {
    const source = deliverableSource(pack, project, item);
    const asset = assetOf(project, item.assetId);
    // A measurement describes a recorded file. One left behind for an export
    // the project no longer records (a craft `drop`) describes nothing.
    const measure = asset ? sidecar.measures[item.assetId] ?? null : null;
    const base = { ...item, file: asset?.uri ?? null, measure };
    if (!source.asset) return { ...base, key: null, state: "blocked", reason: source.reason };
    const key = exportKey(pack, project, platform, item);
    if (!asset || assetStatus(asset) !== "ready" || !measure) return { ...base, key, state: "missing", reason: "not exported yet" };
    if (measure.key !== key) {
      const edge = edgeOf(project, item.assetId);
      const from = edge?.fromAssetId ?? null;
      const reason = from && from !== source.asset.id ? `exported from ${from}; the pick is now ${source.asset.id}` : "exported from other inputs (keepFrames, order, art or the exporter changed)";
      return { ...base, key, state: "stale", reason };
    }
    return { ...base, key, state: "current", reason: null };
  });
  const required = items.filter((i) => !i.optional || i.state !== "blocked");
  // Likewise the archive record: it counts while every file in it is still a
  // recorded export of this platform.
  const recorded = new Set(items.filter((i) => i.file).map((i) => i.file.split("/").pop()));
  const kept = sidecar.archives[platform] ?? null;
  const archive = kept && Array.isArray(kept.entries) && kept.entries.every((name) => recorded.has(name)) ? kept : null;
  const allCurrent = required.length > 0 && required.every((i) => i.state === "current");
  const key = allCurrent ? archiveKey(platform, required.map((i) => [i.file, i.key])) : null;
  const archiveState = !allCurrent ? "blocked" : !archive ? "missing" : archive.key !== key ? "stale" : "current";
  return {
    platform,
    items,
    archive: { state: archiveState, key, uri: archive?.uri ?? paths.archive(platform), measure: archive },
    stale: items.some((i) => i.state === "stale" || i.state === "missing") || archiveState === "stale" || archiveState === "missing",
  };
}

// ---------------------------------------------------------------------------
// Checks — rows the CLI and the viewer both print
// ---------------------------------------------------------------------------

const LEVELS = ["pass", "warn", "fail"];
const worst = (levels) => levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "pass");

function row(id, label, level, detail, address) {
  return address ? { id, label, level, detail, address } : { id, label, level, detail };
}

function textRow(platform, field, spec, value) {
  const id = `listing-${field}`;
  const label = spec.label;
  const address = { platform };
  const text = String(value ?? "");
  if (!text.trim()) {
    return spec.required ? row(id, label, "fail", `listing.${platform}.${field} is empty`, address) : row(id, label, "pass", "not set (optional)", address);
  }
  const length = spec.asianWidth ? asianWidthLength(text) : charLength(text);
  const unit = spec.asianWidth ? "width (Asian characters count 2)" : "characters";
  const problems = [];
  if (spec.max !== undefined && length > spec.max) problems.push(`${length} ${unit}, over ${spec.max}`);
  if (spec.min !== undefined && length < spec.min) problems.push(`${length} ${unit}, under ${spec.min}`);
  if (spec.noPunctuation && hasPunctuation(text)) problems.push("no punctuation allowed");
  if (problems.length) return row(id, label, "fail", `"${text}": ${problems.join("; ")}`, address);
  if (spec.best !== undefined && length > spec.best) return row(id, label, "warn", `"${text}": ${length} ${unit} — up to ${spec.best} shows best`, address);
  const range = spec.max !== undefined ? ` (max ${spec.max}${spec.min !== undefined ? `, min ${spec.min}` : ""})` : "";
  return row(id, label, "pass", `"${text}" — ${length} ${unit}${range}`, address);
}

/** Problems of one exported sticker against its platform's rules: [level, text][]. */
function stickerExportProblems(platform, m) {
  const rules = PLATFORM_PROFILES[platform].sticker;
  const out = [];
  const fail = (text) => out.push(["fail", text]);
  if (m.bytes > rules.maxBytes) fail(`${fmtBytes(m.bytes)} is over ${fmtBytes(rules.maxBytes)}`);
  if (platform === "wechat") {
    if (m.format !== "gif") fail(`format ${m.format}, not GIF`);
    if (m.width !== rules.width || m.height !== rules.height) fail(`${m.width}×${m.height}, not ${rules.width}×${rules.height}`);
    if (m.loopCount !== 0) fail(m.loopCount === null ? "does not loop (no loop block)" : `loops ${m.loopCount} time(s), not forever`);
    if (!(m.frames > 1)) fail("is not animated");
  } else if (platform === "telegram") {
    if (m.format !== "webm" || m.codec !== "vp9") fail(`${m.format}/${m.codec}, not WEBM VP9`);
    if (!m.alpha?.channel) fail("has no alpha channel");
    const long = Math.max(m.width, m.height);
    if (long !== rules.edge || Math.min(m.width, m.height) > rules.edge) fail(`${m.width}×${m.height}: one side must be exactly ${rules.edge}, the other at most ${rules.edge}`);
    if (m.durationMs > rules.maxDurationMs) fail(`${fmtSeconds(m.durationMs)}, over ${fmtSeconds(rules.maxDurationMs)}`);
    if (m.fps > rules.fps) fail(`${m.fps} fps, over ${rules.fps}`);
    if (m.hasAudio) fail("has an audio stream");
  } else if (platform === "line") {
    if (m.format !== "apng") fail(`format ${m.format}, not APNG`);
    if (m.width > rules.maxWidth || m.height > rules.maxHeight) fail(`${m.width}×${m.height} is outside ${rules.maxWidth}×${rules.maxHeight}`);
    if (m.width < rules.minLongSide && m.height < rules.minLongSide) fail(`${m.width}×${m.height}: width or height must be at least ${rules.minLongSide}`);
    if (m.frames < rules.minFrames || m.frames > rules.maxFrames) fail(`${m.frames} frames, not ${rules.minFrames}–${rules.maxFrames}`);
    if (m.durationMs > rules.maxLoopMs) fail(`one loop is ${fmtSeconds(m.durationMs)}, over ${fmtSeconds(rules.maxLoopMs)}`);
    if (!(m.loopCount >= rules.minPlays && m.loopCount <= rules.maxPlays)) fail(`plays ${m.loopCount === 0 ? "forever" : m.loopCount}, not ${rules.minPlays}–${rules.maxPlays}`);
    else if (m.loopCount * m.durationMs > rules.maxTotalMs) fail(`${m.loopCount} plays × ${fmtSeconds(m.durationMs)} is over ${fmtSeconds(rules.maxTotalMs)}`);
    if (m.identical) fail("every frame is identical");
    if (!(m.alpha?.clear > 0)) fail("is not transparent");
    if (rules.cropMargins && m.margin !== undefined && m.margin > 1) out.push(["warn", `${m.margin} px of empty margin left`]);
    if (m.firstFrameCoverage !== undefined && m.firstFrameCoverage < 0.5) out.push(["warn", `the first frame (the store still) shows ${Math.round(m.firstFrameCoverage * 100)}% of the usual figure`]);
  }
  return out;
}

function stickerExportSummary(platform, m) {
  if (platform === "wechat") return `${m.width}×${m.height} GIF · ${fmtBytes(m.bytes)} · ${m.frames} frames · ${m.loopCount === 0 ? "loops forever" : "does not loop"}`;
  if (platform === "telegram") return `${m.width}×${m.height} WEBM VP9${m.alpha?.channel ? "+alpha" : ""} · ${fmtBytes(m.bytes)} · ${fmtSeconds(m.durationMs)} at ${m.fps} fps`;
  return `${m.width}×${m.height} APNG · ${fmtBytes(m.bytes)} · ${m.frames} frames · ${fmtSeconds(m.durationMs)} × ${m.loopCount} play(s)`;
}

function artExportProblems(spec, m) {
  const out = [];
  if (m.width !== spec.width || m.height !== spec.height) out.push(["fail", `${m.width}×${m.height}, not ${spec.width}×${spec.height}`]);
  if (m.bytes > spec.maxBytes) out.push(["fail", `${fmtBytes(m.bytes)} is over ${fmtBytes(spec.maxBytes)}`]);
  const formats = spec.formats;
  if (!formats.includes(m.format)) out.push(["fail", `format ${m.format}, not ${formats.join(" or ")}`]);
  if (spec.alpha === "transparent") {
    if (!(m.alpha?.clear > 0)) out.push(["fail", "is not transparent"]);
    else if (m.alpha?.cornersClear === false) out.push(["fail", "a corner is not transparent (a square frame or background)"]);
    if (spec.noWhiteOutline && m.alpha?.edgeWhite !== undefined && m.alpha.edgeWhite > 0.5) out.push(["warn", `${Math.round(m.alpha.edgeWhite * 100)}% of the outline is near-white — the platform asks for no white outline`]);
  } else if (spec.alpha === "opaque") {
    if (m.alpha?.clear > 0 || m.alpha?.semi > 0) out.push(["fail", "has transparent pixels; it must be opaque"]);
    if (spec.notWhite && m.nearWhite !== undefined && m.nearWhite > 0.5) out.push(["warn", `${Math.round(m.nearWhite * 100)}% near-white — the background must not be white`]);
  }
  if (spec.animated) {
    if (m.format !== "apng" || !(m.frames > 1)) out.push(["fail", "is not animated"]);
  }
  return out;
}

function deliverableRow(platform, item, takeState) {
  const profile = PLATFORM_PROFILES[platform];
  const address = item.kind === "art" ? { art: item.art, platform } : { sticker: item.sticker, platform };
  const spec = item.kind === "sticker" ? null : profile.deliverables[item.deliverable];
  const label = item.kind === "sticker" ? `${item.name} · ${item.sticker}` : spec.label;
  const id = item.kind === "sticker" ? `sticker-${item.sticker}` : item.deliverable;
  if (item.state === "blocked") {
    if (item.optional) return row(id, label, "pass", `none — ${item.reason}; optional${platform === "telegram" ? " (Telegram uses the first sticker)" : ""}`, address);
    return row(id, label, "fail", item.reason, address);
  }
  if (item.state === "missing") return row(id, label, "fail", `not exported yet — sticker.mjs export --platform ${platform}`, address);
  if (item.state === "stale") return row(id, label, "fail", `${item.reason} — export again`, address);
  const m = item.measure;
  const problems = item.kind === "sticker" ? stickerExportProblems(platform, m) : item.kind === "main" ? [...artExportProblems(spec, m), ...lineMainTiming(m)] : artExportProblems(spec, m);
  if (takeState?.status === "stale") problems.push(["warn", `its take is stale (${takeState.reason}) — re-roll to apply`]);
  const level = worst(problems.map(([l]) => l));
  const summary = item.kind === "sticker" ? stickerExportSummary(platform, m) : `${m.width}×${m.height} ${String(m.format).toUpperCase()} · ${fmtBytes(m.bytes)}`;
  return row(id, label, level, problems.length ? `${problems.map(([, t]) => t).join("; ")} (${summary})` : summary, address);
}

function lineMainTiming(m) {
  const rules = PLATFORM_PROFILES.line.sticker;
  const out = [];
  if (m.frames < rules.minFrames || m.frames > rules.maxFrames) out.push(["fail", `${m.frames} frames, not ${rules.minFrames}–${rules.maxFrames}`]);
  if (!(m.loopCount >= rules.minPlays && m.loopCount <= rules.maxPlays) || m.loopCount * m.durationMs > rules.maxTotalMs) out.push(["fail", `plays ${m.loopCount} × ${fmtSeconds(m.durationMs)} breaks LINE's 1–4 plays within ${fmtSeconds(rules.maxTotalMs)}`]);
  return out;
}

/**
 * The checklist for one platform: rows `{ id, label, level, detail,
 * address? }`, `level` ∈ pass | warn | fail. Pure over pack.json and the
 * measurements sticker.mjs recorded; `sticker.mjs check` prints these rows
 * and the viewer draws them, so the two always agree.
 */
export function checkPack(pack, project, platform) {
  const profile = PLATFORM_PROFILES[platform];
  if (!profile) throw new Error(`unknown platform '${platform}' (${PLATFORMS.join(", ")})`);
  const rows = [];
  const listing = pack.listing?.[platform] ?? {};

  rows.push(pack.rights
    ? row("rights", "rights", "pass", `${pack.rights.basis}, confirmed ${pack.rights.confirmedAt}${pack.rights.note ? ` — ${pack.rights.note}` : ""}`)
    : row("rights", "rights", "fail", "rights is not recorded in pack.json — required before any paid step and any submission"));

  if (!pack.platforms.includes(platform)) rows.push(row("platform", "platform", "warn", `'${platform}' is not in pack.platforms`, { platform }));

  // count
  const n = pack.stickers.length;
  if (profile.count.allowed) {
    rows.push(row("count", "sticker count", profile.count.allowed.includes(n) ? "pass" : "fail", `${n} sticker(s); ${profile.label} takes ${profile.count.allowed.join(", ")}`, { platform }));
  } else {
    const { min, max } = profile.count;
    rows.push(row("count", "sticker count", n >= min && n <= max ? "pass" : "fail", `${n} sticker(s); ${profile.label} takes ${min}–${max}${profile.count.setMax ? ` at creation, ${profile.count.setMax} per set` : ""}`, { platform }));
  }

  // per deliverable
  const state = exportState(pack, project, platform);
  const takeStates = new Map(pack.stickers.map((s) => [s.id, stickerState(pack, project, s.id)]));
  for (const item of state.items) rows.push(deliverableRow(platform, item, item.sticker ? takeStates.get(item.sticker) : null));

  // set-wide sticker rules
  if (platform === "wechat") {
    const exported = state.items.filter((i) => i.kind === "sticker" && i.measure);
    const still = exported.filter((i) => !(i.measure.frames > 1));
    if (exported.length) rows.push(row("all-animated", "all animated", still.length ? "fail" : "pass", still.length ? `${still.map((i) => i.sticker).join(", ")} are static; a set is all animated or all static` : `all ${exported.length} exported stickers are animated`, { platform }));
    const words = pack.stickers.map((s) => s.word.trim());
    const long = pack.stickers.filter((s) => !s.word.trim() || charLength(s.word.trim()) > profile.word.max);
    const dupes = pack.stickers.filter((s, i) => s.word.trim() && words.indexOf(s.word.trim()) !== i);
    const bad = [...long, ...dupes];
    rows.push(row("words", "含义词 meaning words", bad.length ? "fail" : "pass",
      bad.length
        ? [long.length ? `${long.map((s) => `${s.id} "${s.word}"`).join(", ")}: 1–${profile.word.max} characters` : null, dupes.length ? `${dupes.map((s) => `${s.id} "${s.word}"`).join(", ")}: used twice` : null].filter(Boolean).join("; ")
        : `${n} words, each 1–${profile.word.max} characters and unique`,
      bad.length ? { sticker: bad[0].id, platform } : { platform }));
  }
  if (platform === "telegram") {
    const bad = pack.stickers.filter((s) => !isSingleEmoji(s.emoji));
    rows.push(row("emoji", "emoji", bad.length ? "fail" : "pass", bad.length ? `${bad.map((s) => `${s.id} ${JSON.stringify(s.emoji)}`).join(", ")}: each sticker exports exactly one emoji` : "one emoji per sticker", bad.length ? { sticker: bad[0].id, platform } : { platform }));
  }

  // listing text
  for (const [field, spec] of Object.entries(profile.text)) {
    if (field === "rewardLine" && !listing.rewardLine) continue;
    rows.push(textRow(platform, field, spec, listing[field]));
  }

  // archive
  const archive = state.archive;
  if (archive.state === "current") {
    const m = archive.measure;
    const over = profile.zip && m.bytes > profile.zip.maxBytes;
    rows.push(row("zip", "upload archive", over ? "fail" : "pass", `${archive.uri} · ${fmtBytes(m.bytes)} · ${m.entries.length} files${over ? ` — over ${fmtBytes(profile.zip.maxBytes)}` : ""}`, { platform }));
  } else {
    rows.push(row("zip", "upload archive", "fail", archive.state === "blocked" ? "waits for every deliverable to be exported and current" : `${archive.state} — sticker.mjs export --platform ${platform}`, { platform }));
  }

  // rules with no official value: always a warning, never a pass
  for (const u of profile.unconfirmed) {
    if (u.when === "reward" && !rewardOn(pack)) continue;
    rows.push(row(u.id, u.label, "warn", `unconfirmed: ${u.detail}`, { platform }));
  }
  return rows;
}

/** `{ pass, warn, fail }` counts of a row list. */
export function tally(rows) {
  const out = { pass: 0, warn: 0, fail: 0 };
  for (const r of rows) out[r.level] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Next step — what status prints and the greeting says
// ---------------------------------------------------------------------------

/**
 * The one next step for this pack, in the order the work goes: rights,
 * character, stickers, takes, picks, re-rolls, exports, checks.
 * `{ id, line, command?, stickers? }`.
 */
export function nextStep(pack, project) {
  if (!pack.rights) return { id: "rights", line: "Record the rights basis in pack.json (rights: { basis, note, confirmedAt }) — nothing paid runs before it." };
  const anchor = anchorState(pack, project);
  if (!anchor.ready) {
    const { candidates } = characterAssets(project);
    const ready = candidates.filter((a) => assetStatus(a) === "ready");
    if (ready.length) return { id: "anchor", line: `Pick the character: set character.anchor in pack.json to one of ${ready.map((a) => a.id).join(", ")}.` };
    if (!pack.character.description.trim()) return { id: "character", line: "Write character.description (identity features, in English) in pack.json, then make the character." };
    return { id: "character", line: "Make the character from the user's photo or image.", command: "sticker.mjs character --from <image>" };
  }
  if (!pack.stickers.length) return { id: "stickers", line: "Add stickers to pack.json (id, word, caption, emoji, action)." };
  const states = stickerStates(pack, project);
  const by = (status) => states.filter((s) => s.status === status).map((s) => s.id);
  // Exactly what a plain `gen` would make (genTargets), then the stickers it leaves alone.
  const plan = genTargets(pack, project);
  const missing = plan.targets.map((t) => t.id);
  const uncertain = plan.uncertain.map((u) => u.id);
  const charged = `the last take failed with billing unknown — it may have been charged`;
  if (missing.length) {
    const left = uncertain.length ? ` Not included: ${uncertain.join(", ")} (${charged}; retry only with the user's yes: sticker.mjs gen --only ${uncertain.join(",")}).` : "";
    return { id: "generate", line: `Generate takes for ${missing.join(", ")}.${left}`, command: `sticker.mjs gen${missing.length === states.length ? "" : ` --only ${missing.join(",")}`}`, stickers: missing };
  }
  if (uncertain.length) return { id: "generate", line: `${uncertain.join(", ")}: ${charged}. A plain gen does not send it again; ask the user before retrying.`, command: `sticker.mjs gen --only ${uncertain.join(",")}`, stickers: uncertain };
  const generating = by("generating");
  if (generating.length) return { id: "generating", line: `Wait for ${generating.join(", ")} to land.`, stickers: generating };
  const pick = by("pick");
  if (pick.length) return { id: "pick", line: `Pick a take for ${pick.join(", ")} (stickers[].take in pack.json).`, stickers: pick };
  const stale = states.filter((s) => s.status === "stale");
  if (stale.length) return { id: "reroll", line: `Re-roll stale takes: ${stale.map((s) => `${s.id} (${s.reason})`).join("; ")}.`, command: `sticker.mjs gen --only ${stale.map((s) => s.id).join(",")} --redo`, stickers: stale.map((s) => s.id) };
  for (const platform of pack.platforms) {
    const state = exportState(pack, project, platform);
    if (state.stale) return { id: "export", line: `Export for ${PLATFORM_PROFILES[platform].label}.`, command: `sticker.mjs export --platform ${platform}` };
  }
  for (const platform of pack.platforms) {
    const rows = checkPack(pack, project, platform);
    const failing = rows.filter((r) => r.level === "fail");
    if (failing.length) return { id: "check", line: `${PLATFORM_PROFILES[platform].label}: ${failing.length} check(s) fail — ${failing.map((r) => r.label).join(", ")}.`, command: `sticker.mjs check --platform ${platform}` };
  }
  return { id: "done", line: "Every chosen platform's checklist passes; the zips are ready to submit." };
}
