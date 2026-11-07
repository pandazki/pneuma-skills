/**
 * Sticker Mode — ModeDefinition binding manifest + viewer.
 *
 * Loaded by the frontend via dynamic import; the Bun backend reads
 * `manifest.ts` directly, which is why React only appears here.
 *
 * One workspace = one pack. The viewer owns its whole surface (panel, chat,
 * submission tabs), so there are no workspace items for the TopBar.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerFileContent, ViewerSelectionContext } from "../../core/types/viewer-contract.js";

import { findArt, findPlatform, findSticker, loadPack, type StickerPack, type StickerView } from "./domain.js";
import stickerManifest from "./manifest.js";
import StickerPreview from "./viewer/StickerPreview.js";
import { captureSticker } from "./viewer/capture-seam.js";

// ── Context ────────────────────────────────────────────────────────────────

function str(address: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = address?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function takeLine(sticker: StickerView): string {
  if (!sticker.takes.length) return "Takes: none yet";
  return `Takes: ${sticker.takes
    .map((t) => {
      const bits: string[] = [t.status];
      if (t.picked) bits.push("picked");
      if (t.actor === "human") bits.push("uploaded");
      if (t.staleness?.stale) bits.push(`stale: ${t.staleness.reasons.join("; ")}`);
      if (t.status === "failed") {
        bits.push(t.failure?.billing === "unknown" ? "billing unknown — may have been charged" : "not billed");
        if (t.failure?.reason) bits.push(t.failure.reason);
      }
      return `${t.id} (${bits.join(", ")})`;
    })
    .join("; ")}`;
}

const UNREAD = "unknown — project.json is unreadable";

function stickerLines(value: StickerPack, sticker: StickerView, address: Record<string, unknown>): string[] {
  const s = sticker.sticker;
  const unread = value.projectError !== null;
  const lines = [
    `Sticker ${s.id} (${sticker.number} of ${value.stickers.length}): word "${s.word}" · caption ${s.caption ? `"${s.caption}"` : "none (no text in the sticker)"} · emoji ${s.emoji || "none"}`,
    `Action: ${s.action || "(none)"}`,
    unread ? `Status: ${UNREAD}` : `Status: ${sticker.state.status}${sticker.state.reason ? ` — ${sticker.state.reason}` : ""}`,
    unread ? `Takes: ${UNREAD}` : takeLine(sticker),
  ];
  if (s.keepFrames) lines.push(`keepFrames: [${s.keepFrames.join(", ")}]`);
  const take = str(address, "take");
  if (take) lines.push(`Showing take: ${take}`);
  const frame = address.frame;
  if (typeof frame === "number") {
    const shown = take ? sticker.takes.find((t) => t.id === take) : sticker.shown;
    const count = shown?.measure?.frames ?? value.pack?.motion.frames ?? 0;
    lines.push(`Frame: ${frame} of 0–${count - 1} in ${shown?.id ?? "the shown take"} (0-based, as keepFrames and the inspect contact sheet count)`);
  }
  const platform = findPlatform(value, str(address, "platform"));
  if (platform && unread) lines.push(`${platform.profile.label} export: ${UNREAD}`);
  else if (platform) {
    const item = platform.exports.items.find((i) => i.kind === "sticker" && i.sticker === s.id);
    const row = platform.rows.find((r) => r.id === `sticker-${s.id}`);
    lines.push(`${platform.profile.label} export: ${item?.file ?? "no file"} — ${item?.state ?? "unknown"}${item?.reason ? ` (${item.reason})` : ""}`);
    if (row) lines.push(`${platform.profile.label} check: ${row.level} — ${row.detail}`);
  }
  return lines;
}

/**
 * What the user is looking at, written for the agent. The address comes
 * first, so it can be copied straight back into `navigate-to` or `capture`;
 * every status is the domain's, i.e. sticker-state.mjs's — the same words
 * `sticker.mjs status` prints.
 */
export function extractStickerContext(selection: ViewerSelectionContext | null, files: ViewerFileContent[]): string {
  const value = loadPack(files);
  const wrap = (lines: string[]) => `<viewer-context mode="sticker">\n${lines.join("\n")}\n</viewer-context>`;
  if (!value.hasPack) return wrap(["No pack.json yet — the workspace has no sticker pack."]);
  if (!value.pack) return wrap([`pack.json is invalid: ${value.packErrors.map((e) => e.message).join("; ")}`]);

  const address = (selection?.address ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (Object.keys(address).length) lines.push(`Address: ${JSON.stringify(address)}`);
  if (selection?.type === "view") lines.push("On screen: the chat preview (the stickers sent in order in a phone-width chat)");
  // Every take, export and cost is recorded there: say so before anything that depends on it.
  const unread = value.projectError !== null;
  if (unread) lines.push(`project.json is unreadable (${value.projectError}) — statuses, takes, exports, checks and spend are unknown until it is fixed; only the sticker scripts write it.`);

  const sticker = findSticker(value, str(address, "sticker"));
  const art = findArt(value, str(address, "art"));
  const platform = findPlatform(value, str(address, "platform"));
  if (sticker) {
    lines.push(...stickerLines(value, sticker, address));
  } else if (address.character === true && unread) {
    lines.push(`Character: ${UNREAD} · style: ${value.pack.character.style}`);
  } else if (address.character === true && value.character) {
    const c = value.character;
    lines.push(
      `Character: anchor ${c.anchor.anchor ?? "not picked"}${c.anchor.ready ? " (ready)" : c.anchor.reason ? ` — ${c.anchor.reason}` : ""} · candidates: ${c.candidates.map((a) => `${a.id} ${a.status}`).join(", ") || "none"}`,
      `Description: ${value.pack.character.description || "(empty)"} · style: ${value.pack.character.style}`,
    );
  } else if (art && unread) {
    lines.push(`Art ${art.kind}: ${UNREAD}`);
  } else if (art) {
    lines.push(
      `Art ${art.kind}: picked ${art.picked ?? "none"}${art.asset ? ` (${art.asset.status})` : ""} · candidates: ${art.candidates.map((a) => `${a.id} ${a.status}`).join(", ") || "none"} · becomes: ${art.becomes.map((b) => `${b.platform} ${b.deliverable}`).join(", ") || "nothing on the chosen platforms"}`,
    );
    if (platform) {
      for (const b of art.becomes.filter((x) => x.platform === platform.platform)) {
        const item = platform.exports.items.find((i) => i.deliverable === b.deliverable);
        const row = platform.rows.find((r) => r.id === b.deliverable);
        lines.push(`${platform.profile.label} ${b.deliverable}: ${item?.file ?? "no file"} — ${item?.state ?? "unknown"}${row ? ` · check ${row.level}: ${row.detail}` : ""}`);
      }
    }
  }
  if (platform && !sticker && !art && unread) {
    lines.push(`Submission tab: ${platform.profile.label} — checks and exports ${UNREAD}`);
  } else if (platform && !sticker && !art) {
    const failing = platform.rows.filter((r) => r.level === "fail");
    lines.push(
      `Submission tab: ${platform.profile.label} — ${platform.tally.fail} fail, ${platform.tally.warn} warn, ${platform.tally.pass} pass${failing.length ? ` · failing: ${failing.map((r) => r.label).join(", ")}` : ""}`,
      `Exports: archive ${platform.exports.archive.state}${platform.exports.stale ? " · some files stale or not exported" : ""}`,
    );
  }

  const counts = new Map<string, number>();
  for (const s of value.stickers) counts.set(s.state.status, (counts.get(s.state.status) ?? 0) + 1);
  const cost = value.cost;
  if (unread) {
    lines.push(`Pack: ${value.title || "(untitled)"} · ${value.stickers.length} sticker(s) · platforms ${value.pack.platforms.join(", ")} · statuses and spend unknown`);
  } else {
    lines.push(
      `Pack: ${value.title || "(untitled)"} · ${value.stickers.length} sticker(s) (${[...counts].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}) · platforms ${value.pack.platforms.join(", ")} · ≈${usd(cost.total)} est.${cost.uncertain.length ? ` (incl. ${cost.uncertain.length} failed call(s) whose billing is unknown: ${cost.uncertain.join(", ")})` : ""}${cost.inFlight.length ? ` · in flight: ${cost.inFlight.join(", ")}` : ""}`,
    );
  }
  if (!value.pack.rights) lines.push("Rights: NOT recorded — every paid step refuses until pack.json.rights is written");
  if (value.next) lines.push(`Next: ${value.next.line}`);
  return wrap(lines);
}

// ── Mode Definition ────────────────────────────────────────────────────────

const workspace = stickerManifest.viewerApi!.workspace!;

const stickerMode: ModeDefinition = {
  manifest: stickerManifest,

  viewer: {
    PreviewComponent: StickerPreview,

    workspace: {
      type: workspace.type,
      multiFile: workspace.multiFile,
      ordered: workspace.ordered,
      hasActiveFile: workspace.hasActiveFile,
      topBarNavigation: workspace.topBarNavigation,
      // One pack, drawn whole by the viewer: no item list.
      resolveItems: () => [],
      // No "new" button from the framework: pack.json is written by the
      // agent after the rights question, which an empty skeleton would skip.
      createEmpty: () => null,
    },

    extractContext: extractStickerContext,

    // The manifest is the single source of truth for the action space.
    actions: stickerManifest.viewerApi?.actions,

    // A sticker, take, frame, the character, an art kind or one export,
    // drawn whole at a fixed size whatever the window (viewer/capture.ts);
    // nothing named is the viewer as the user sees it.
    captureViewport: captureSticker,

    updateStrategy: "incremental",
  },
};

export default stickerMode;
