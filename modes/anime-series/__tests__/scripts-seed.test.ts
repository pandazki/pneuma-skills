/**
 * The mode's seed workspaces against the script rules: every seed must be a
 * workspace series.mjs accepts as it stands — bible and episodes well formed,
 * the bible's latest lock matching its text (an edit without a relock would
 * show every card as "edited" on first open), sidecar references resolving,
 * and its first episode assembling into prompts.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { readProjectFile, statusOf } from "../../_shared/scripts/craft-project.mjs";
import { probeMedia } from "../../_shared/scripts/craft-project-io.mjs";
import { assemblePart, bibleLang, noTextLine } from "../skill/scripts/prompts.mjs";
import { checkBible, checkEpisode, checkEpisodeFile, findEntity, lockStates } from "../skill/scripts/series-state.mjs";
import type { Bible, Episode, EntityKind } from "../skill/scripts/series-state.mjs";

const SEED = join(import.meta.dir, "..", "seed");
const SERIES = join(import.meta.dir, "..", "skill", "scripts", "series.mjs");
const seeds = existsSync(SEED)
  ? readdirSync(SEED, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(SEED, d.name, "bible.json"))).map((d) => d.name)
  : [];
if (!seeds.length) console.log("[anime-series] no seed workspace with a bible.json yet — seed checks skipped");

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

describe.each(seeds.length ? seeds : ["(none)"])("seed %s", (name) => {
  const dir = join(SEED, name);
  test.skipIf(!seeds.length)("is a workspace series.mjs accepts", () => {
    const bible: Bible = readJson(join(dir, "bible.json"));
    expect(checkBible(bible)).toEqual([]);
    const states = lockStates(bible);
    if (bible.locks.length) {
      for (const [key, state] of Object.entries(states)) expect(`${key}: ${state.state} ${state.changed.join(",")}`).toBe(`${key}: locked `);
    }

    const project = readProjectFile(readFileSync(join(dir, "project.json"), "utf-8"), { sidecarKey: "series" });
    if (!project.ok) throw new Error(project.error);
    const ids = new Set(project.value.assets.map((a) => a.id));
    for (const kind of ["character", "group", "scene"] as EntityKind[]) {
      for (const entity of (bible[`${kind}s` as "characters"] ?? []) as Array<{ id: string; sheet?: string | null }>) {
        if (entity.sheet) expect(ids.has(entity.sheet)).toBe(true);
      }
    }

    const episodesDir = join(dir, "episodes");
    const episodeIds = existsSync(episodesDir) ? readdirSync(episodesDir).filter((id) => existsSync(join(episodesDir, id, "episode.json"))) : [];
    for (const id of episodeIds) {
      const file = readJson(join(episodesDir, id, "episode.json"));
      expect(checkEpisodeFile(file, bible)).toEqual([]);
      const episode: Episode = { ...file, id };
      if (!episode.parts.length) continue;
      expect(checkEpisode(episode).errors).toEqual([]);
      const sheetOf = (kind: EntityKind, entityId: string) => {
        const sheet = (findEntity(bible, kind, entityId) as { sheet?: string | null } | null)?.sheet ?? null;
        return sheet && ids.has(sheet) ? sheet : null;
      };
      for (const part of episode.parts) {
        const assembled = assemblePart(bible, episode, part.id, { sheetOf, board: "board" });
        expect(assembled.refs.at(-1)?.kind).toBe("storyboard");
        const markings = [...episode.cast.map((c) => findEntity(bible, "character", c)), ...(episode.groups ?? []).map((g) => findEntity(bible, "group", g))]
          .map((e) => (e as { markings?: string } | null)?.markings).filter(Boolean);
        const closing = assembled.video.prompt.split("\n").at(-1)!;
        expect(closing).toBe(noTextLine(markings as string[], bibleLang(bible)));
        // A seed episode carries continuity lines: without them shots do not pick up each other's action.
        expect((episode.continuity ?? []).length).toBeGreaterThan(0);
        expect(assembled.video.prompt).toContain(bibleLang(bible) === "zh" ? "连贯要求：" : "Continuity: ");
      }
    }

    const validate = Bun.spawnSync([process.execPath, SERIES, "validate", "--dir", dir, "--json"], { stdout: "pipe", stderr: "pipe" });
    expect(JSON.parse(validate.stdout.toString())).toEqual({ command: "validate", ok: true, problems: [] });
  });
});

// The shipped run, read by the scripts: domain.test.ts pins the viewer's
// reading of the same files, so the two runtimes cannot drift apart unseen.
const RUN = join(SEED, "guang-niuma");

describe("the shipped run (guang-niuma ep01)", () => {
  test("series.mjs status reads it as done, every cell judged, the re-shot shot not stale", () => {
    const r = Bun.spawnSync([process.execPath, SERIES, "status", "--episode", "ep01", "--dir", RUN, "--json"], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const status = JSON.parse(r.stdout.toString());
    expect(status.bibleVersion).toBe(1);
    expect(status.edited).toEqual([]);
    expect(status.failed).toEqual([]);
    const [ep01] = status.episodes;
    expect(ep01).toMatchObject({ episode: "ep01", stage: "done", unverified: 0, finalReady: true, final: "ep01-final-2", busy: false });
    const [a] = ep01.parts;
    expect(a).toMatchObject({ board: "ep01-a-board-2", boardPicked: true, take: "ep01-a-take-1", reviewed: true, takeSetupChanged: false, takeBoardChanged: false });
    expect(a.checks).toEqual({ ok: 15, drift: 3, absent: 9, unverified: 0, accepted: 0 });
    expect(a.lost.map((l: { character: string; shot: number }) => `${l.character}@${l.shot}`)).toEqual(["niuma@1"]);
    // Shot 8 was rewritten after the board and re-shot from the new words.
    expect(a.boardStaleShots).toEqual([8]);
    expect(a.takeStaleShots).toEqual([]);
    expect(a.patches.map((p: { asset: string; status: string; take: string }) => [p.asset, p.status, p.take])).toEqual([
      ["ep01-a-patch-8-8-1", "ready", "ep01-a-take-1"],
    ]);
    // The live run's spend, unchanged by the delivery transcode.
    expect(status.cost).toMatchObject({ total: 7.9894, calls: 12, unpriced: [], uncertain: [], inFlight: [] });
  });
});

const MEDIA = mediaTierEnabled("anime-series");
announceMediaTierSkip("anime-series", "seed media probed against its craft records");
const HAS_FFPROBE = MEDIA && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (MEDIA && !HAS_FFPROBE) console.warn("(skip) modes/anime-series seed media probe — ffprobe not on PATH");

describe.skipIf(!HAS_FFPROBE)("the shipped run's media", () => {
  test("every file measures what its craft asset records", () => {
    const project = readProjectFile(readFileSync(join(RUN, "project.json"), "utf-8"), { sidecarKey: "series" });
    if (!project.ok) throw new Error(project.error);
    const mismatched: string[] = [];
    for (const asset of project.value.assets) {
      if (statusOf(asset) !== "ready" || (asset.type !== "image" && asset.type !== "video")) continue;
      const { metadata, warning } = probeMedia(join(RUN, asset.uri), asset.type);
      const recorded = asset.metadata as Record<string, number>;
      const same = !warning
        && metadata.width === recorded.width
        && metadata.height === recorded.height
        && (asset.type === "image" || (metadata.fps === recorded.fps && Math.abs(metadata.duration - recorded.duration) <= 0.002));
      if (!same) mismatched.push(`${asset.id} ${asset.uri}: ${warning ?? JSON.stringify(metadata)} vs ${JSON.stringify(recorded)}`);
    }
    expect(mismatched).toEqual([]);
  });
});
