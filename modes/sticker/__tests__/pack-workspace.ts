/**
 * A pack in every state the viewer draws, as the two files the viewer reads.
 * Built with the real craft lifecycle (`sticker-fixture.ts`, which records
 * takes and exports the way sticker.mjs does), then pack.json is moved on
 * the way a person would move it:
 *
 *   s01 ready      picked take, exported everywhere (current)
 *   s02 pick       two ready takes, none picked
 *   s03 stale      picked take, caption edited afterwards
 *   s04 generating one take in flight
 *   s05 failed     one take failed, billing unknown (may have been charged)
 *   s06 empty      no take at all
 *   s07 ready      re-picked to take 2 after export → its exports are stale
 *   s08 failed     one take failed, billing none (never left)
 */

import { failAsset } from "../../_shared/scripts/craft-project.mjs";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import * as S from "../skill/scripts/sticker-state.mjs";
import { T0, addImage, addTake, emptyDoc, exportAll, packFrom, rawPack, type Doc } from "./sticker-fixture.js";

export interface PackWorkspace {
  raw: Record<string, any>;
  doc: Doc;
  files: ViewerFileContent[];
}

export function filesOf(raw: unknown, doc: unknown, indent = 2): ViewerFileContent[] {
  return [
    { path: "pack.json", content: `${JSON.stringify(raw, null, indent)}\n` },
    { path: "project.json", content: `${JSON.stringify(doc, null, 2)}\n` },
  ];
}

export function richWorkspace(): PackWorkspace {
  const raw = rawPack();
  const doc = emptyDoc();
  addImage(doc, "character-1", "character/anchor-1.png", { op: "upload" });
  for (const kind of ["portrait", "head", "banner"] as const) addImage(doc, S.ids.art(kind, 1), S.paths.art(kind, 1), { from: ["character-1"] });
  const at = (id: string) => raw.stickers.find((s: { id: string }) => s.id === id);

  at("s02").take = null;
  at("s04").take = null;
  at("s05").take = null;
  at("s06").take = null;
  at("s08").take = null;
  const pack = packFrom(raw);

  addTake(doc, pack, "s01", 1);
  addTake(doc, pack, "s02", 1);
  addTake(doc, pack, "s02", 2);
  addTake(doc, pack, "s03", 1);
  addTake(doc, pack, "s04", 1, { status: "generating" });
  addTake(doc, pack, "s05", 1, { status: "failed" });
  addTake(doc, pack, "s07", 1);
  addTake(doc, pack, "s07", 2);
  addTake(doc, pack, "s08", 1, { status: "generating" });
  failAsset(doc, { id: "s08-take-1", reason: "connect ECONNREFUSED — the request never left", billing: "none" }, T0 + 900_000_000);
  for (const platform of ["wechat", "telegram", "line"] as const) exportAll(doc, pack, platform);

  // The person moves on after the export.
  at("s03").caption = "收到啦";
  at("s07").take = "s07-take-2";
  return { raw, doc, files: filesOf(raw, doc) };
}

/** Every sticker ready and exported, every platform's archive current. */
export function finishedWorkspace(): PackWorkspace {
  const raw = rawPack();
  const pack = packFrom(raw);
  const doc = emptyDoc();
  addImage(doc, "character-1", "character/anchor-1.png", { op: "upload" });
  for (const kind of ["portrait", "head", "banner"] as const) addImage(doc, S.ids.art(kind, 1), S.paths.art(kind, 1), { from: ["character-1"] });
  for (const s of pack.stickers) addTake(doc, pack, s.id, 1);
  for (const platform of ["wechat", "telegram", "line"] as const) exportAll(doc, pack, platform);
  return { raw, doc, files: filesOf(raw, doc) };
}
