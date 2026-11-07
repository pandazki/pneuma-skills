/**
 * What `capture` shows when the viewer is on one object.
 *
 * The agent's eyes must not depend on the window. In the 2026-11-07 trial the
 * viewer pane was 479×357 and every `navigate-to` + `capture` returned the
 * top of a head with no caption — reported as success. So when the position
 * names an object (a sticker, a take, a frame, the character, an art kind,
 * or one platform's export of a sticker or art), the capture is a card drawn
 * here at a fixed, legible size, whatever the window: the object whole, on
 * the current chat plate, with what it is written beside it. Nothing named
 * (the panel overview, the chat preview, a submission tab) is "what the
 * user sees", shot by the framework as before.
 *
 *   sticker  the stage at 2× and at chat size, showing the frame the
 *            position freezes, else the first frame of the loop that ships;
 *            under it, that loop's frames in play order (keepFrames applied)
 *   character  every user photo beside every candidate, newest first
 *   art      every candidate of the kind, newest first, the picked one marked
 *   export   the platform's file at its own pixels (capped), its state
 *
 * When the object cannot be drawn whole (its file does not load, the canvas
 * is tainted) the answer is `{ error }` and the capture fails with that
 * reason. Media is gathered first, then drawn in one pass.
 */

import type { ViewportCapture } from "../../../core/types/viewer-contract.js";
import type { ArtKindView, AssetBrief, CharacterView, ExportItem, PlatformView, StickerPack, StickerView, TakeView } from "../domain.js";
import { findArt, findSticker } from "../domain.js";
import { currentExport, decoderDelays } from "./StickerLoop.js";
import { mediaUrl } from "./media.js";
import { holdGifFrames, imageDecoder, type DecodedGif } from "./players.js";
import type { StickerStrings } from "./strings.js";
import { PLATE_COLORS, assetNumber, effectiveLoop, frameCount, newestFirst, stageTake, type Loop, type Position } from "./view-model.js";

// ── What is addressed (pure) ───────────────────────────────────────────────

export type CaptureSubject =
  | { kind: "sticker"; sticker: StickerView; take: TakeView | null; frame: number | null }
  | { kind: "character"; character: CharacterView }
  | { kind: "art"; art: ArtKindView }
  | { kind: "export"; platform: PlatformView; item: ExportItem };

/**
 * The object the position names, or null when it names none — then the
 * capture is the viewer as the user sees it.
 */
export function captureSubject(value: StickerPack, position: Position): CaptureSubject | null {
  const focus = position.focus;
  if (!value.pack || !focus || position.view === "chat") return null;
  if (position.view === "submit") {
    const platform = value.platforms.find((p) => p.platform === position.platform);
    if (!platform) return null;
    const item =
      focus.type === "sticker"
        ? platform.exports.items.find((i) => i.kind === "sticker" && i.sticker === focus.id)
        : focus.type === "art"
          ? platform.exports.items.find((i) => i.kind === "art" && i.art === focus.kind)
          : undefined;
    return item ? { kind: "export", platform, item } : null;
  }
  if (focus.type === "sticker") {
    const sticker = findSticker(value, focus.id);
    return sticker ? { kind: "sticker", sticker, take: stageTake(sticker, position), frame: position.frame } : null;
  }
  if (focus.type === "character") return value.character ? { kind: "character", character: value.character } : null;
  const art = findArt(value, focus.kind);
  return art ? { kind: "art", art } : null;
}


// ── Media ──────────────────────────────────────────────────────────────────

interface Pic {
  source: CanvasImageSource;
  width: number;
  height: number;
}

const MEDIA_TIMEOUT_MS = 8000;

function within<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not load within ${MEDIA_TIMEOUT_MS / 1000} s`)), MEDIA_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function loadImage(url: string): Promise<Pic> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight };
}

async function loadVideoFrame(url: string): Promise<Pic & { release: () => void }> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(video.error?.message || "the video could not be decoded"));
    video.src = url;
    video.load();
  });
  return {
    source: video,
    width: video.videoWidth,
    height: video.videoHeight,
    release: () => {
      video.removeAttribute("src");
      video.load();
    },
  };
}

const numberOf = assetNumber;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)) || "unknown error";

// ── Drawing kit ────────────────────────────────────────────────────────────

const W = 640;
const PAD = 18;
const SCALE = 2;
const FONT = `ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

interface Tokens {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  primary: string;
  success: string;
  warning: string;
  error: string;
}

function tokens(root: Element | null): Tokens {
  const css = root && typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
  const read = (name: string, fallback: string) => css?.getPropertyValue(`--color-cc-${name}`).trim() || fallback;
  return {
    bg: read("bg", "#09090b"),
    surface: read("surface", "#18181b"),
    border: read("border", "rgba(255,255,255,0.08)"),
    fg: read("fg", "#fafafa"),
    muted: read("muted", "#a1a1aa"),
    primary: read("primary", "#f97316"),
    success: read("success", "#4ade80"),
    warning: read("warning", "#facc15"),
    error: read("error", "#f87171"),
  };
}

const INK = { light: "#52525b", dark: "#a1a1aa" } as const;

class Card {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  y = 0;

  constructor(
    readonly c: Tokens,
    maxHeight = 2400,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W * SCALE;
    this.canvas.height = maxHeight * SCALE;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas in this browser");
    this.ctx = ctx;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, maxHeight);
    ctx.textBaseline = "alphabetic";
  }

  font(px: number, weight = 400, mono = false) {
    this.ctx.font = `${weight} ${px}px ${mono ? MONO : FONT}`;
  }

  /** Greedy wrap that breaks between CJK characters and between Latin words. */
  wrap(text: string, max: number): string[] {
    const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) ?? [];
    const lines: string[] = [];
    let line = "";
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) line += " ";
        continue;
      }
      const next = line + token;
      if (line && this.ctx.measureText(next).width > max) {
        lines.push(line.trimEnd());
        line = token;
      } else line = next;
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }

  /** Wrapped text at the cursor; at most `maxLines` (the last ends with "…"). */
  text(text: string, { px = 13, weight = 400, color = this.c.fg, mono = false, x = PAD, max = W - 2 * PAD, maxLines = 6, lineHeight = 1.45 } = {}) {
    if (!text) return;
    this.font(px, weight, mono);
    this.ctx.fillStyle = color;
    let lines = this.wrap(text, max);
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}…`];
    for (const line of lines) {
      this.y += px * lineHeight;
      this.ctx.fillText(line, x, this.y - px * 0.28);
    }
  }

  gap(px: number) {
    this.y += px;
  }

  /** A filled rounded box from the cursor down, `height` tall. */
  box(height: number, fill: string, { x = PAD, width = W - 2 * PAD, radius = 14 } = {}) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, this.y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** `pic` contained in the square or rect at (x, y), centred. */
  image(pic: Pic, x: number, y: number, w: number, h: number) {
    if (!pic.width || !pic.height) return;
    const s = Math.min(w / pic.width, h / pic.height);
    const dw = pic.width * s;
    const dh = pic.height * s;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.drawImage(pic.source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  /** One line of small text at an absolute position (labels under tiles). */
  label(text: string, x: number, y: number, { px = 11, color = this.c.muted, align = "left" as CanvasTextAlign, max = 200, weight = 400 } = {}) {
    this.font(px, weight);
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    let shown = text;
    while (shown.length > 1 && this.ctx.measureText(shown).width > max) shown = shown.slice(0, -2);
    this.ctx.fillText(shown === text ? text : `${shown}…`, x, y);
    this.ctx.textAlign = "left";
  }

  /** The finished card, cropped to what was drawn, as base64 PNG. */
  png(): string {
    const height = Math.ceil(this.y + PAD);
    const out = document.createElement("canvas");
    out.width = W * SCALE;
    out.height = height * SCALE;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas in this browser");
    ctx.drawImage(this.canvas, 0, 0, W * SCALE, height * SCALE, 0, 0, W * SCALE, height * SCALE);
    return out.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }
}

function header(card: Card, title: string, tag: { text: string; color: string } | null, lines: string[]) {
  const c = card.c;
  card.gap(PAD - 4);
  card.text(title, { px: 18, weight: 600, max: W - 2 * PAD - 160, maxLines: 2 });
  if (tag) {
    card.font(12, 600);
    const width = card.ctx.measureText(tag.text).width + 18;
    card.ctx.beginPath();
    card.ctx.roundRect(W - PAD - width, PAD - 2, width, 22, 11);
    card.ctx.strokeStyle = tag.color;
    card.ctx.lineWidth = 1;
    card.ctx.stroke();
    card.ctx.fillStyle = tag.color;
    card.ctx.fillText(tag.text, W - PAD - width + 9, PAD + 13);
  }
  for (const line of lines) card.text(line, { px: 12.5, color: c.muted, maxLines: 3 });
  card.gap(12);
}

/** Tiles of pictures with a label under each, wrapped into rows on the plate. */
function tiles(card: Card, plate: "light" | "dark", items: Array<{ pic: Pic; label: string; strong?: boolean }>, size: number) {
  const gap = 14;
  const inner = W - 2 * PAD - 2 * 16;
  const perRow = Math.max(1, Math.floor((inner + gap) / (size + gap)));
  const rows = Math.ceil(items.length / perRow);
  const rowH = size + 26;
  const height = 16 + rows * rowH + 6;
  card.box(height, PLATE_COLORS[plate]);
  items.forEach((item, i) => {
    const x = PAD + 16 + (i % perRow) * (size + gap);
    const y = card.y + 16 + Math.floor(i / perRow) * rowH;
    card.image(item.pic, x, y, size, size);
    card.label(item.label, x + size / 2, y + size + 17, { align: "center", max: size, color: item.strong ? card.c.primary : INK[plate], weight: item.strong ? 600 : 400 });
  });
  card.gap(height + 12);
}

// ── Cards ──────────────────────────────────────────────────────────────────

export interface CaptureContext {
  value: StickerPack;
  position: Position;
  base: string;
  t: StickerStrings;
  /** Read for the theme's tokens. */
  root: Element | null;
}

const STATUS_COLOR = (c: Tokens): Record<string, string> => ({ ready: c.success, stale: c.warning, pick: c.primary, generating: c.primary, failed: c.error, empty: c.muted });

async function stickerCard(subject: Extract<CaptureSubject, { kind: "sticker" }>, cx: CaptureContext): Promise<ViewportCapture> {
  const { value, base, t, position } = cx;
  const { sticker, take, frame } = subject;
  const s = sticker.sticker;
  const plate = position.plate;
  const unread = value.projectError !== null;
  const notes: string[] = [];

  // Media first.
  const url = take?.status === "ready" ? mediaUrl(base, take) : null;
  const total = take ? frameCount(take, value) : 0;
  let stage: Pic | null = null;
  let strip: Array<{ pic: Pic; index: number }> | null = null;
  let loop: Loop | null = null;
  let stageLabel = "";
  let release = () => {};
  if (url && take) {
    const Decoder = imageDecoder();
    if (Decoder) {
      const hold = holdGifFrames(url, Decoder);
      release = hold.release;
      let gif: DecodedGif;
      try {
        gif = await within(hold.promise, take.id);
      } catch (error) {
        release();
        return { error: `${take.id} could not be drawn (${reason(error)}) — nothing was captured.` };
      }
      loop = effectiveLoop(s.keepFrames, gif.frames.length, take.measure?.delaysMs ?? decoderDelays(gif.durations), value.pack?.motion.frameMs ?? 120);
      if (loop.outOfRange !== null) notes.push(`keepFrames names frame ${loop.outOfRange}, but ${take.id} has ${gif.frames.length} frames: the strip is the whole take, and the exporter refuses it.`);
      const shown = frame !== null && frame < gif.frames.length ? frame : loop.order[0];
      const bitmap = gif.frames[shown];
      stage = bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
      stageLabel = frame !== null ? `${t.frame(frame, gif.frames.length)}${loop.trimmed && !loop.order.includes(frame) ? ` · ${t.cut}` : ""}` : t.firstShipped;
      strip = loop.order.map((index) => ({ pic: { source: gif.frames[index], width: gif.frames[index].width, height: gif.frames[index].height }, index }));
    } else {
      // No frame decoding: an image draws its first frame. A current export
      // is the trimmed loop, so its first frame is the first one that ships.
      const exported = s.keepFrames ? currentExport(value, sticker, take, base) : null;
      try {
        stage = await within(loadImage(exported?.url ?? url), take.id);
      } catch (error) {
        return { error: `${take.id} could not be loaded (${reason(error)}) — nothing was captured.` };
      }
      stageLabel = exported ? t.firstShipped : "";
      notes.push(
        exported
          ? `This browser cannot decode GIF frames: the stage is the first frame of the ${exported.platform} export (the trimmed loop that ships), and there is no frame strip.`
          : s.keepFrames
            ? `This browser cannot decode GIF frames: the stage is the first frame of the whole take, which the exports cut (they keep frames ${s.keepFrames.join(", ")}); there is no frame strip.`
            : "This browser cannot decode GIF frames: the stage is the take's first frame, and there is no frame strip.",
      );
    }
  }

  try {
    const card = new Card(tokens(cx.root));
    const c = card.c;
    const status = unread ? t.statusUnknown : t.status(sticker.state.status, sticker.state.ready.length, "");
    const takeBits = take ? [`${t.take(take.n)}${take.picked ? ` · ${t.inUse}` : ""}`, take.id] : [];
    header(card, `${sticker.number}  ${s.word || s.id}${s.emoji ? `  ${s.emoji}` : ""}`, { text: status, color: unread ? c.muted : STATUS_COLOR(c)[sticker.state.status] ?? c.muted }, [
      [s.id, s.caption ? `“${s.caption}”` : t.noCaption, ...takeBits].join("  ·  "),
      s.action,
      ...(s.keepFrames && total ? [t.keepFrames(s.keepFrames.length, total)] : []),
      ...(!unread && sticker.state.status !== "ready" ? sticker.state.messages.map(t.say) : []),
    ]);

    if (stage) {
      const stageSize = 240;
      const chat = 120;
      const height = 16 + stageSize + 30;
      card.box(height, PLATE_COLORS[plate]);
      const top = card.y + 16;
      card.image(stage, PAD + 20, top, stageSize, stageSize);
      card.label(`2×${stageLabel ? ` · ${stageLabel}` : ""}`, PAD + 20 + stageSize / 2, top + stageSize + 19, { align: "center", max: stageSize + 40, color: INK[plate] });
      const cx2 = PAD + 20 + stageSize + 60;
      card.image(stage, cx2, top + (stageSize - chat) / 2, chat, chat);
      card.label(t.chatSize, cx2 + chat / 2, top + (stageSize + chat) / 2 + 19, { align: "center", max: 200, color: INK[plate] });
      card.gap(height + 12);
      if (strip && loop) {
        card.text(t.shippedStrip(loop.order.length, total || loop.order.length), { px: 12, color: c.muted, maxLines: 2 });
        card.gap(6);
        tiles(
          card,
          plate,
          strip.map(({ pic, index }) => ({ pic, label: String(index), strong: index === frame })),
          50,
        );
      }
    } else {
      const height = 120;
      card.box(height, PLATE_COLORS[plate]);
      const failed = take?.status === "failed" ? take.failure?.reason : null;
      card.label(unread ? t.unread : failed ? failed : sticker.state.status === "empty" ? t.emptyHeadlineQuiet : status, W / 2, card.y + height / 2 + 5, { align: "center", max: W - 80, color: INK[plate], px: 13 });
      card.gap(height + 12);
    }
    const data = card.png();
    return { data, media_type: "image/png", ...(notes.length ? { note: notes.join(" ") } : {}) };
  } catch (error) {
    return { error: `The ${sticker.id} card could not be drawn (${reason(error)}) — nothing was captured.` };
  } finally {
    release();
  }
}

/** Load each brief's picture; the first that fails fails the card. */
async function pictures(briefs: AssetBrief[], base: string): Promise<{ pics: Map<string, Pic> } | { error: string }> {
  const pics = new Map<string, Pic>();
  for (const brief of briefs) {
    const url = mediaUrl(base, brief);
    if (!url) continue;
    try {
      pics.set(brief.id, await within(loadImage(url), brief.id));
    } catch (error) {
      return { error: `${brief.id} could not be loaded (${reason(error)}) — nothing was captured.` };
    }
  }
  return { pics };
}

async function characterCard(subject: Extract<CaptureSubject, { kind: "character" }>, cx: CaptureContext): Promise<ViewportCapture> {
  const { value, base, t, position } = cx;
  const character = subject.character;
  const candidates = newestFirst(character.candidates);
  const sources = newestFirst(character.sources);
  const loaded = await pictures([...sources, ...candidates], base);
  if ("error" in loaded) return loaded;
  try {
    const card = new Card(tokens(cx.root));
    const c = card.c;
    const anchor = value.pack?.character.anchor ?? null;
    const ready = candidates.filter((x) => x.status === "ready");
    header(
      card,
      value.title || t.character,
      character.anchor.ready ? { text: t.isTheCharacter, color: c.success } : ready.length ? { text: t.candidatesToPick(ready.length), color: c.primary } : null,
      [`${t.character} · ${anchor ? `${t.isTheCharacter}: ${t.candidateN(numberOf(anchor))} (${anchor})` : t.notPicked}`],
    );
    const items = [
      ...sources.filter((x) => loaded.pics.has(x.id)).map((x) => ({ pic: loaded.pics.get(x.id)!, label: t.photoN(numberOf(x.id)) })),
      ...candidates
        .filter((x) => loaded.pics.has(x.id))
        .map((x) => ({ pic: loaded.pics.get(x.id)!, label: `${t.candidateN(numberOf(x.id))}${x.id === anchor ? ` · ${t.isTheCharacter}` : ""}`, strong: x.id === anchor })),
    ];
    if (items.length) {
      card.text(sources.length ? t.compareHint : t.noPhoto, { px: 12, color: c.muted });
      card.gap(6);
      tiles(card, position.plate, items, items.length <= 2 ? 260 : 176);
    } else {
      card.box(100, PLATE_COLORS[position.plate]);
      card.label(t.noCharacter, W / 2, card.y + 55, { align: "center", max: W - 80, color: INK[position.plate], px: 13 });
      card.gap(112);
    }
    const unready = candidates.filter((x) => x.status !== "ready");
    for (const x of unready) card.text(`${x.id}: ${x.status}`, { px: 12, color: c.muted });
    card.text(`${t.description}: ${value.pack?.character.description || t.emptyValue}`, { px: 12.5, color: c.fg, maxLines: 5 });
    card.text(`${t.style}: ${value.pack?.character.style ?? ""}`, { px: 12.5, color: c.muted, maxLines: 2 });
    return { data: card.png(), media_type: "image/png" };
  } catch (error) {
    return { error: `The character card could not be drawn (${reason(error)}) — nothing was captured.` };
  }
}

async function artCard(subject: Extract<CaptureSubject, { kind: "art" }>, cx: CaptureContext): Promise<ViewportCapture> {
  const { base, t, position } = cx;
  const art = subject.art;
  const candidates = newestFirst(art.candidates);
  const loaded = await pictures(candidates, base);
  if ("error" in loaded) return loaded;
  try {
    const card = new Card(tokens(cx.root));
    const c = card.c;
    header(card, t.artKind(art.kind), art.picked ? { text: t.inUse, color: c.success } : { text: t.notPicked, color: c.muted }, [
      art.becomes.map((b) => `${t.platformName(b.platform)} ${t.deliverableLabel(b.platform, b.deliverable)}`).join(" · ") || t.artUnused,
    ]);
    const items = candidates
      .filter((x) => loaded.pics.has(x.id))
      .map((x) => ({ pic: loaded.pics.get(x.id)!, label: `${t.artN(numberOf(x.id))}${x.id === art.picked ? ` · ${t.inUse}` : ""}`, strong: x.id === art.picked }));
    if (items.length) tiles(card, position.plate, items, items.length === 1 ? 420 : items.length === 2 ? 270 : 176);
    else card.text(t.noneYet, { px: 13, color: c.muted });
    return { data: card.png(), media_type: "image/png" };
  } catch (error) {
    return { error: `The ${art.kind} card could not be drawn (${reason(error)}) — nothing was captured.` };
  }
}

async function exportCard(subject: Extract<CaptureSubject, { kind: "export" }>, cx: CaptureContext): Promise<ViewportCapture> {
  const { value, base, t, position } = cx;
  const { platform, item } = subject;
  const url = item.file ? mediaUrl(base, value.assets[item.assetId]) : null;
  const format = item.measure?.format ?? (item.ext === "webm" ? "webm" : item.ext === "gif" ? "gif" : "png");
  let pic: Pic | null = null;
  let release = () => {};
  if (url) {
    try {
      if (format === "webm") {
        const frame = await within(loadVideoFrame(url), item.assetId);
        release = frame.release;
        pic = frame;
      } else pic = await within(loadImage(url), item.assetId);
    } catch (error) {
      return { error: `${item.file ?? item.assetId} could not be loaded (${reason(error)}) — nothing was captured.` };
    }
  }
  try {
    const card = new Card(tokens(cx.root));
    const c = card.c;
    const word = item.sticker ? value.stickers.find((s) => s.id === item.sticker)?.sticker.word : undefined;
    const name = item.kind === "sticker" ? `${item.name} · ${item.sticker}${word ? `  ${word}` : ""}` : t.deliverableLabel(platform.platform, item.deliverable);
    const tone = item.state === "current" ? c.success : item.state === "stale" ? c.warning : item.state === "missing" ? c.error : c.muted;
    const m = item.measure;
    header(card, `${t.platformName(platform.platform)} · ${name}`, { text: t.exportState[item.state], color: tone }, [
      [item.file, m ? `${m.width}×${m.height}` : null, m?.bytes ? `${Math.round(m.bytes / 1000)} KB` : null].filter(Boolean).join("  ·  "),
      ...(item.message ? [t.say(item.message)] : []),
    ]);
    if (pic) {
      const cap = 480;
      const s = Math.min(1, cap / Math.max(pic.width, pic.height));
      const w = Math.round(pic.width * s);
      const h = Math.round(pic.height * s);
      const height = h + 32;
      card.box(height, PLATE_COLORS[position.plate]);
      card.image(pic, (W - w) / 2, card.y + 16, w, h);
      card.gap(height + 12);
      card.text(s < 1 ? t.shownAt(Math.round(s * 100)) : "1×", { px: 11.5, color: c.muted });
    }
    return { data: card.png(), media_type: "image/png", ...(format === "webm" || format === "apng" || format === "gif" ? { note: "An animated export: the card shows its first frame." } : {}) };
  } catch (error) {
    return { error: `The ${item.assetId} card could not be drawn (${reason(error)}) — nothing was captured.` };
  } finally {
    release();
  }
}

/** The card for what the position names. */
export function renderCapture(subject: CaptureSubject, cx: CaptureContext): Promise<ViewportCapture> {
  switch (subject.kind) {
    case "sticker":
      return stickerCard(subject, cx);
    case "character":
      return characterCard(subject, cx);
    case "art":
      return artCard(subject, cx);
    case "export":
      return exportCard(subject, cx);
  }
}
