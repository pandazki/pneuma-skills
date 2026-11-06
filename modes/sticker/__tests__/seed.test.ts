/**
 * The 打工牛马 seed is a real run, shipped as it came out and stopped before
 * export: the character, every take (re-rolls kept), every piece of art and
 * the picks are there; the exports are made by the user's first `export`.
 * These tests keep it honest against the rules it was made under: a change
 * to the prompt wording or a platform rule that would turn the seed stale,
 * or make it read as exported, shows up here, not in front of a new user.
 *
 * The export records were removed with `craft-project-io.mjs drop`, which
 * leaves the mode's sidecar alone; the measurements and archive records it
 * left were then pruned with `pruneSidecar` (what sticker.mjs runs before
 * every save), so the sidecar holds only records of files the project has.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as S from "../skill/scripts/sticker-state.mjs";

const SEED = join(import.meta.dir, "..", "seed", "niuma");
const EXPORT_ID = /^(wechat|telegram|line)-/;

function load() {
  const parsed = S.parsePack(readFileSync(join(SEED, "pack.json"), "utf-8"));
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join("\n"));
  const project = JSON.parse(readFileSync(join(SEED, "project.json"), "utf-8"));
  return { pack: parsed.pack, project };
}

describe("the niuma seed", () => {
  test("pack.json is valid, with rights, the anchor and every art kind picked", () => {
    const { pack, project } = load();
    expect(pack.rights?.basis).toBe("original");
    expect(pack.stickers).toHaveLength(8);
    expect(S.anchorState(pack, project).ready).toBe(true);
    for (const kind of ["portrait", "head", "banner"] as const) {
      const id = pack.art[kind];
      expect({ kind, status: S.assetStatus(project.assets.find((a: { id: string }) => a.id === id)) }).toEqual({ kind, status: "ready" });
    }
  });

  test("every sticker's picked take is ready and matches today's prompt", () => {
    const { pack, project } = load();
    for (const state of S.stickerStates(pack, project)) {
      expect({ id: state.id, status: state.status, reason: state.reason }).toEqual({ id: state.id, status: "ready", reason: null });
    }
  });

  test("the character source is an upload by a human; takes are generated from the anchor; re-rolls kept", () => {
    const { pack, project } = load();
    const edge = (id: string | null) => project.provenance.find((e: { toAssetId: string }) => e.toAssetId === id);
    const source = edge("character-source-1");
    expect(source.operation.type).toBe("upload");
    expect(source.operation.actor).toBe("human");
    expect(edge(pack.character.anchor).fromAssetId).toBe("character-source-1");
    for (const sticker of pack.stickers) expect(edge(sticker.take).operation.type).toBe("generate");
    for (const sticker of pack.stickers) expect(edge(sticker.take).fromAssetId).toBe(pack.character.anchor);
    expect(S.takesOf(project, "s05").map((t) => t.id)).toEqual(["s05-take-1", "s05-take-2"]);
    expect(S.artAssets(project, "head").map((a) => a.id)).toEqual(["art-head-1", "art-head-2"]);
  });

  test("every recorded file is in the seed, and no export is", () => {
    const { project } = load();
    for (const asset of project.assets) expect({ id: asset.id, present: existsSync(join(SEED, asset.uri)) }).toEqual({ id: asset.id, present: true });
    expect(project.assets.filter((a: { id: string }) => EXPORT_ID.test(a.id))).toEqual([]);
    expect(project.provenance.filter((e: { toAssetId: string }) => EXPORT_ID.test(e.toAssetId))).toEqual([]);
    expect(existsSync(join(SEED, "exports"))).toBe(false);
  });

  test("every platform reads as not exported yet: nothing blocked, nothing stale, the next step is export", () => {
    const { pack, project } = load();
    // No orphan records: every measurement is of a recorded asset, no archive outlives its files.
    expect(S.pruneSidecar(project).dropped).toEqual({ measures: [], archives: [] });
    expect(Object.keys(project.sticker.measures).filter((id) => EXPORT_ID.test(id))).toEqual([]);
    expect(project.sticker.archives).toEqual({});
    for (const platform of pack.platforms) {
      const state = S.exportState(pack, project, platform);
      expect(state.items.map((i) => [i.deliverable, i.state, i.measure])).toEqual(state.items.map((i) => [i.deliverable, "missing", null]));
      expect({ platform, archive: state.archive.state, measure: state.archive.measure }).toEqual({ platform, archive: "blocked", measure: null });
      // The only failing rows are the files export makes; every text and set rule already passes.
      const failing = S.checkPack(pack, project, platform).filter((r) => r.level === "fail");
      expect(failing.every((r) => r.id === "zip" || r.detail.startsWith("not exported yet"))).toBe(true);
      expect(failing.filter((r) => r.id !== "zip")).toHaveLength(state.items.length);
    }
    expect(S.checkPack(pack, project, "wechat").some((r) => r.id === "all-animated")).toBe(false);
    expect(S.nextStep(pack, project)).toMatchObject({ id: "export", command: "sticker.mjs export --platform wechat" });
  });
});
