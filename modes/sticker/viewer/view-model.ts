/**
 * Where the sticker viewer is, and the ViewerAddress it reports.
 *
 * ONE POSITION. A click, `navigate-to`, `set-view`, a locator card and
 * `capture` all go through `Position`; `positionAddress` turns it into the
 * address on every selection, and `resolveAddress` turns an address back
 * into a position — refusing by name, listing what exists, and moving
 * nothing when the address names something that is not there.
 *
 * The vocabulary (docs/proposals/2026-11-06-sticker-mode.md "ViewerAddress"):
 *   coarse  sticker: "s01" | art: ArtKind | character: true
 *   fine    frame: number (0-based, as keepFrames and the inspect contact
 *           sheet count) · take: "<sid>-take-<n>"
 *   scope   platform: "wechat" | "telegram" | "line" — that platform's
 *           export of the thing (the submission tab); alone, the tab itself
 */

import type { ViewerAddress } from "../../../core/types/viewer-contract.js";
import { ART_KINDS, PLATFORMS } from "../skill/scripts/sticker-state.mjs";
import type { ArtKind, Platform, StickerPack, StickerView, TakeView } from "../domain.js";
import { findArt, findSticker } from "../domain.js";

export type View = "panel" | "chat" | "submit";
export type Plate = "light" | "dark";

export const VIEWS: readonly View[] = ["panel", "chat", "submit"];
export const PLATES: readonly Plate[] = ["light", "dark"];

/** The chat backgrounds every sticker is judged on (WeChat's light and dark chat). */
export const PLATE_COLORS: Record<Plate, string> = { light: "#EDEDED", dark: "#111111" };

export type Focus = { type: "sticker"; id: string } | { type: "character" } | { type: "art"; kind: ArtKind };

export interface Position {
  view: View;
  plate: Plate;
  /** The open submission tab. */
  platform: Platform | null;
  /** What the panel's inspector shows, and what the submission tab highlights. */
  focus: Focus | null;
  /** A take put on the stage instead of the sticker's shown one. */
  take: string | null;
  /** The stage frozen on this frame (0-based) of the stage's take. */
  frame: number | null;
}

export const START: Position = { view: "panel", plate: "light", platform: null, focus: null, take: null, frame: null };

export const ADDRESS_KEYS = ["sticker", "frame", "take", "art", "character", "platform"] as const;

const TAKE_ID_RE = /^(s[0-9]{2,3})-take-[0-9]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The take on the stage: the one the position names, else the sticker's
 * shown take, else its newest take of any state (a failure or a take in
 * flight is what there is to look at).
 */
export function stageTake(sticker: StickerView | null, position: Pick<Position, "take">): TakeView | null {
  if (!sticker) return null;
  if (position.take) return sticker.takes.find((t) => t.id === position.take) ?? null;
  return sticker.shown ?? sticker.takes[sticker.takes.length - 1] ?? null;
}

/** How many frames a ready take has: what sticker.mjs measured, else what the pack asks for. */
export function frameCount(take: TakeView, value: StickerPack): number {
  return take.measure?.frames ?? value.pack?.motion.frames ?? 0;
}

/** The position as an address — what every selection carries and the agent can send back. */
export function positionAddress(position: Position): ViewerAddress {
  const focus = position.focus;
  const scope = position.view === "submit" && position.platform ? { platform: position.platform } : {};
  if (position.view === "chat") return {};
  if (!focus) return scope;
  if (focus.type === "character") return position.view === "submit" ? scope : { character: true };
  if (focus.type === "art") return { art: focus.kind, ...scope };
  return {
    sticker: focus.id,
    ...(position.view === "panel" && position.take ? { take: position.take } : {}),
    ...(position.view === "panel" && position.frame !== null ? { frame: position.frame } : {}),
    ...scope,
  };
}

export type Resolved = { ok: true; position: Position } | { ok: false; message: string };

const refuse = (message: string): Resolved => ({ ok: false, message });

/**
 * Address → position, or a refusal that names what does exist. The plate
 * never changes here (`set-view` owns it).
 */
export function resolveAddress(value: StickerPack, address: unknown, here: Position): Resolved {
  if (!isRecord(address)) return refuse("address must be an object such as { \"sticker\": \"s01\" }");
  if (!ADDRESS_KEYS.some((k) => k in address)) {
    return refuse(`the address names nothing this viewer knows (keys: ${ADDRESS_KEYS.join(", ")})`);
  }
  const pack = value.pack;
  if (!pack) return refuse(value.hasPack ? `pack.json is not valid: ${value.packErrors[0]?.message ?? "unknown error"}` : "there is no pack.json yet");

  const { sticker: sid, frame, take, art, character, platform } = address;

  let scope: Platform | null = null;
  if (platform !== undefined) {
    if (typeof platform !== "string" || !(PLATFORMS as readonly string[]).includes(platform)) {
      return refuse(`platform must be one of ${PLATFORMS.join(", ")} (got ${JSON.stringify(platform)})`);
    }
    if (!pack.platforms.includes(platform as Platform)) {
      return refuse(`"${platform}" is not in pack.platforms (${pack.platforms.join(", ")})`);
    }
    scope = platform as Platform;
  }

  if (character !== undefined) {
    if (character !== true) return refuse(`character must be true (got ${JSON.stringify(character)})`);
    if (sid !== undefined || art !== undefined || take !== undefined || frame !== undefined) {
      return refuse("character stands alone — address a sticker or an art kind separately");
    }
    if (scope) return refuse("the character is not exported itself — address its art ({ art, platform }) or a sticker");
    return { ok: true, position: { ...here, view: "panel", focus: { type: "character" }, take: null, frame: null } };
  }

  if (art !== undefined) {
    if (typeof art !== "string" || !(ART_KINDS as readonly string[]).includes(art)) {
      return refuse(`art must be one of ${ART_KINDS.join(", ")} (got ${JSON.stringify(art)})`);
    }
    if (sid !== undefined || take !== undefined || frame !== undefined) return refuse("art stands alone — address a sticker separately");
    if (!findArt(value, art)) {
      return refuse(`no ${art} art in this pack (has: ${value.art.map((a) => a.kind).join(", ") || "none"})`);
    }
    return {
      ok: true,
      position: { ...here, view: scope ? "submit" : "panel", platform: scope ?? here.platform, focus: { type: "art", kind: art as ArtKind }, take: null, frame: null },
    };
  }

  // A take names its sticker.
  let stickerId: string | undefined;
  if (sid !== undefined) {
    if (typeof sid !== "string") return refuse(`sticker must be a sticker id such as "s01" (got ${JSON.stringify(sid)})`);
    stickerId = sid;
  }
  if (take !== undefined) {
    if (typeof take !== "string" || !TAKE_ID_RE.test(take)) return refuse(`take must be a take id such as "s01-take-2" (got ${JSON.stringify(take)})`);
    const owner = TAKE_ID_RE.exec(take)![1];
    if (stickerId && owner !== stickerId) return refuse(`"${take}" is not a take of ${stickerId}`);
    stickerId = owner;
  }
  if (stickerId === undefined) {
    if (frame !== undefined) return refuse("frame needs a sticker: { \"sticker\": \"s01\", \"frame\": 3 }");
    if (scope) return { ok: true, position: { ...here, view: "submit", platform: scope, focus: null, take: null, frame: null } };
    return refuse("the address names nothing this viewer can show");
  }

  const sticker = findSticker(value, stickerId);
  if (!sticker) {
    return refuse(`no sticker "${stickerId}" in pack.json (has: ${value.stickers.map((s) => s.id).join(", ") || "none"})`);
  }
  if (typeof take === "string" && !sticker.takes.some((t) => t.id === take)) {
    return refuse(`no take "${take}" for ${sticker.id} (has: ${sticker.takes.map((t) => t.id).join(", ") || "none yet"})`);
  }
  if (scope && (take !== undefined || frame !== undefined)) {
    return refuse("take and frame point inside the panel's stage — drop platform, or drop take and frame to see the export");
  }

  let frameIndex: number | null = null;
  if (frame !== undefined) {
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
      return refuse(`frame must be a 0-based frame index (got ${JSON.stringify(frame)})`);
    }
    const target = stageTake(sticker, { take: typeof take === "string" ? take : null });
    if (!target) return refuse(`${sticker.id} has no take to show frames of (${sticker.state.status})`);
    if (target.status !== "ready") return refuse(`${target.id} is ${target.status} — it has no frames to show`);
    const count = frameCount(target, value);
    if (frame >= count) return refuse(`${target.id} has frames 0–${count - 1} (got ${frame})`);
    frameIndex = frame;
  }

  if (scope) {
    return { ok: true, position: { ...here, view: "submit", platform: scope, focus: { type: "sticker", id: sticker.id }, take: null, frame: null } };
  }
  return {
    ok: true,
    position: {
      ...here,
      view: "panel",
      focus: { type: "sticker", id: sticker.id },
      take: typeof take === "string" ? take : null,
      frame: frameIndex,
    },
  };
}

export type SetView = { ok: true; position: Position } | { ok: false; message: string };

/** `set-view` params → position: a view, optionally a platform tab and a plate. */
export function resolveSetView(value: StickerPack, params: unknown, here: Position): SetView {
  const p = isRecord(params) ? params : {};
  const { view, platform, plate } = p;
  if (typeof view !== "string" || !(VIEWS as readonly string[]).includes(view)) {
    return { ok: false, message: `view must be one of ${VIEWS.join(", ")} (got ${JSON.stringify(view)})` };
  }
  if (plate !== undefined && (typeof plate !== "string" || !(PLATES as readonly string[]).includes(plate))) {
    return { ok: false, message: `plate must be "light" or "dark" (got ${JSON.stringify(plate)})` };
  }
  const chosen = value.pack?.platforms ?? [];
  let tab = here.platform && chosen.includes(here.platform) ? here.platform : chosen[0] ?? null;
  if (platform !== undefined) {
    if (typeof platform !== "string" || !chosen.includes(platform as Platform)) {
      return { ok: false, message: `platform must be one of pack.platforms (${chosen.join(", ") || "none"}) (got ${JSON.stringify(platform)})` };
    }
    if (view !== "submit") return { ok: false, message: "platform goes with view \"submit\"" };
    tab = platform as Platform;
  }
  if (view === "submit" && !tab) return { ok: false, message: "the pack has no platforms to submit to" };
  return {
    ok: true,
    position: {
      ...here,
      view: view as View,
      platform: view === "submit" ? tab : here.platform,
      plate: (plate as Plate | undefined) ?? here.plate,
      // The stage's frame and take belong to the panel; another view lets them go.
      ...(view !== "panel" ? { take: null, frame: null } : {}),
    },
  };
}
