/**
 * Fixtures for the pure-module tests: a valid 8-sticker pack and a craft
 * project built with the real craft rules (`craft-project.mjs`), recording
 * takes, art and exports the way sticker.mjs records them.
 */

import { emptyProject, failAsset, landAsset, reserveAsset } from "../../_shared/scripts/craft-project.mjs";
import type { CraftProjectFile } from "../../_shared/scripts/craft-project.mjs";
import * as S from "../skill/scripts/sticker-state.mjs";
import type { ArtKind, Measure, Pack, Platform, StickerSidecar } from "../skill/scripts/sticker-state.mjs";

export const T0 = 1793000000000;

const WORDS = [
  ["收到", "收到", "👌", "nods twice and salutes"],
  ["好的", "好的", "🙂", "gives a thumbs up"],
  ["加班", "又加班", "😩", "slumps over a laptop"],
  ["下班", "下班啦", "🏃", "runs out the door"],
  ["摸鱼", "", "🐟", "hides behind a monitor"],
  ["开会", "开会中", "📋", "takes notes and nods off"],
  ["谢谢", "谢谢老板", "🙏", "bows deeply"],
  ["晚安", "晚安", "🌙", "yawns and curls up"],
] as const;

export function rawPack(): Record<string, any> {
  return {
    version: 1,
    rights: { basis: "original", note: "our own mascot", confirmedAt: "2026-11-06" },
    platforms: ["wechat", "telegram", "line"],
    character: { description: "round pale blue-grey ox calf with cream horns", style: "thick clean dark outlines, flat colors", anchor: "character-1" },
    motion: { frames: 16, frameMs: 120, size: 512 },
    listing: {
      wechat: { name: "打工牛马", intro: "打工人的日常表情", copyright: "Pneuma" },
      telegram: { title: "Work Ox", shortName: "work_ox" },
      line: { title: "Work Ox", creator: "Pneuma", description: "Everyday office life of an ox", copyright: "Pneuma" },
    },
    stickers: WORDS.map(([word, caption, emoji, action], i) => ({
      id: `s0${i + 1}`, word, caption, emoji, action, take: `s0${i + 1}-take-1`, keepFrames: null,
    })),
    art: { portrait: "art-portrait-1", head: "art-head-1", banner: "art-banner-1" },
  };
}

export function packFrom(raw: Record<string, any>): Pack {
  const parsed = S.validatePack(raw);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join("\n"));
  return parsed.pack;
}

export type Doc = CraftProjectFile & { sticker: StickerSidecar };

export function emptyDoc(): Doc {
  return emptyProject({ title: "Work Ox", sidecarKey: "sticker", sidecar: { schema: 1, measures: {}, archives: {} } }) as Doc;
}

let clock = T0;
const tick = () => (clock += 1000);

export function addImage(doc: Doc, id: string, uri: string, { op = "generate", from }: { op?: "generate" | "upload"; from?: string[] } = {}) {
  reserveAsset(doc, { id, type: "image", name: id, op, uri, ...(from ? { from } : {}), ...(op === "generate" ? { model: "openai/gpt-image-2.6-flare", provider: "openrouter", prompt: "p" } : {}) }, tick());
  landAsset(doc, { id, uri, metadata: { width: 1024, height: 1024 } }, tick());
}

/** A take recorded as `gen` records it: prompt, request and inputs from `pack`. */
export function addTake(doc: Doc, pack: Pack, sid: string, n: number, { status = "ready", from = pack.character.anchor }: { status?: "ready" | "failed" | "generating"; from?: string | null } = {}) {
  const sticker = pack.stickers.find((s) => s.id === sid)!;
  const id = S.ids.take(sid, n);
  reserveAsset(doc, {
    id, type: "image", name: id, op: "generate", uri: S.paths.take(sid, n), ...(from ? { from: [from] } : {}),
    model: "openai/gpt-image-2.6-flare", provider: "fal", prompt: S.stickerPrompt(pack, sticker),
    params: { sticker: sid, request: S.stickerRequest(pack), promptInputs: S.stickerPromptInputs(pack, sticker) },
    cost: { usd: 0.1, basis: "estimate" }, generating: status === "generating",
  }, tick());
  if (status === "ready") landAsset(doc, { id, uri: S.paths.take(sid, n), metadata: { width: 512, height: 512 } }, tick());
  if (status === "failed") failAsset(doc, { id, reason: "upstream error", billing: "unknown" }, tick());
  return id;
}

/** The project of a pack whose stickers each have one ready take and whose art exists. */
export function readyDoc(pack: Pack): Doc {
  const doc = emptyDoc();
  addImage(doc, "character-1", "character/anchor-1.png");
  for (const s of pack.stickers) addTake(doc, pack, s.id, 1);
  for (const kind of ["portrait", "head", "banner", "reward-guide", "reward-thanks"] as ArtKind[]) addImage(doc, S.ids.art(kind, 1), S.paths.art(kind, 1), { from: ["character-1"] });
  return doc;
}

/** Measurements that meet each deliverable's rules. */
export function passingMeasure(platform: Platform, deliverable: string): Measure {
  const alpha = { channel: true, clear: 0.4, semi: 0, cornersClear: true, edgeWhite: 0 };
  if (deliverable.startsWith("s0")) {
    if (platform === "wechat") return { format: "gif", bytes: 250_000, width: 240, height: 240, frames: 16, delaysMs: Array(16).fill(120), durationMs: 1920, loopCount: 0, alpha, identical: false, firstFrameCoverage: 1, margin: 4 };
    if (platform === "telegram") return { format: "webm", codec: "vp9", bytes: 200_000, width: 512, height: 512, frames: 58, fps: 30, durationMs: 1933, loopCount: null, hasAudio: false, alpha: { ...alpha, semi: 0.05 }, identical: false, firstFrameCoverage: 1 };
    return { format: "apng", bytes: 450_000, width: 237, height: 270, frames: 16, delaysMs: Array(16).fill(120), durationMs: 1920, loopCount: 2, alpha, identical: false, firstFrameCoverage: 1, margin: 0 };
  }
  const opaque = { channel: false, clear: 0, semi: 0, cornersClear: false, edgeWhite: 0 };
  switch (deliverable) {
    case "cover": return { format: "png", bytes: 60_000, width: 240, height: 240, alpha: { ...alpha, semi: 0.04 }, nearWhite: 0.02 };
    case "icon": return { format: "png", bytes: 3_000, width: 50, height: 50, alpha, nearWhite: 0.02 };
    case "banner": return { format: "png", bytes: 300_000, width: 750, height: 400, alpha: opaque, nearWhite: 0.03 };
    case "reward-guide": return { format: "png", bytes: 300_000, width: 750, height: 560, alpha: opaque, nearWhite: 0.03 };
    case "reward-thanks": return { format: "png", bytes: 300_000, width: 750, height: 750, alpha: opaque, nearWhite: 0.03 };
    case "thumb": return { format: "png", bytes: 8_000, width: 100, height: 100, alpha, nearWhite: 0.01 };
    case "main": return { format: "apng", bytes: 270_000, width: 240, height: 240, frames: 16, durationMs: 1920, loopCount: 2, alpha, identical: false };
    case "tab": return { format: "png", bytes: 10_000, width: 96, height: 74, alpha, nearWhite: 0.01 };
    default: throw new Error(`no measure for ${deliverable}`);
  }
}

/**
 * Record every deliverable of `platform` as exported (derive edges, sidecar
 * measures with the current key, the archive), the way sticker.mjs export
 * records them. `measure` overrides a deliverable's measurement.
 */
export function exportAll(doc: Doc, pack: Pack, platform: Platform, measure: (deliverable: string, m: Measure) => Measure = (_, m) => m) {
  const members: [string, string][] = [];
  for (const item of S.platformDeliverables(pack, platform)) {
    const source = S.deliverableSource(pack, doc, item).asset;
    if (!source) continue;
    const ext = item.ext ?? "png";
    const uri = `${S.paths.exportDir(platform)}/${item.name}.${ext}`;
    reserveAsset(doc, { id: item.assetId, type: ext === "webm" ? "video" : "image", name: item.assetId, op: "derive", uri, from: [source.id], force: true, params: { op: "export", platform } }, tick());
    landAsset(doc, { id: item.assetId, uri, metadata: { width: 1, height: 1 } }, tick());
    const key = S.exportKey(pack, doc, platform, item)!;
    doc.sticker.measures[item.assetId] = { ...measure(item.deliverable, passingMeasure(platform, item.deliverable)), key };
    members.push([uri, key]);
  }
  const key = S.archiveKey(platform, members);
  doc.sticker.archives[platform] = { uri: S.paths.archive(platform), bytes: 1_000_000, entries: members.map(([u]) => u.split("/").pop()!), key, at: T0 };
}
