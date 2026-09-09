/**
 * Sprite domain tests — the `Roster` aggregate.
 *
 * A roster is N characters, each one a craft project file plus a `sprite`
 * sidecar, written by `sprite-project.mjs` while the agent works. Three
 * properties are load-bearing and all three are pinned here:
 *
 *  - the key is the DIRECTORY, because the character is the content set;
 *  - motions keep their DECLARED order, because that order is the rail;
 *  - a broken `project.json` is SKIPPED, not thrown on, because one
 *    half-written character must not blank the stage for its siblings.
 *
 * The canonical fixture (`fixtures/mini/project.json`) is the design
 * document's own example, byte-for-byte. TASK-4's `sprite-project.mjs` tests
 * reproduce it from the CLI, so the two halves of the contract are pinned
 * against the same artefact rather than against each other's assumptions.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  CRAFT_PROJECT_SCHEMA,
  createCharacterProjectFile,
  findMotion,
  findRef,
  loadRoster,
  MOTION_STATUSES,
  resolveAssetUri,
  saveRoster,
} from "../domain.js";

const MINI = readFileSync(
  join(import.meta.dir, "fixtures", "mini", "project.json"),
  "utf-8",
);

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe("loadRoster", () => {
  test("keys the character by its directory prefix", () => {
    const roster = loadRoster(files({ "mini/project.json": MINI }));
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
    expect(roster!.byContentSet.mini.contentSet).toBe("mini");
    expect(roster!.byContentSet.mini.sprite.character.name).toBe("Mini");
  });

  test("a root-level project keys as the empty string", () => {
    // A quick session that never made a subdirectory is a real workspace,
    // not a degenerate one — the viewer resolves `""` the same as any prefix.
    const roster = loadRoster(files({ "project.json": MINI }));
    expect(Object.keys(roster!.byContentSet)).toEqual([""]);
    expect(roster!.byContentSet[""].contentSet).toBe("");
  });

  test("motions keep their declared order — that order is the rail", () => {
    const twoMotions = JSON.parse(MINI);
    twoMotions.sprite.motions.push({
      ...twoMotions.sprite.motions[0],
      id: "attack",
      label: "Attack",
    });
    const roster = loadRoster(
      files({ "mini/project.json": JSON.stringify(twoMotions) }),
    );
    expect(
      roster!.byContentSet.mini.sprite.motions.map((m) => m.id),
    ).toEqual(["bounce", "attack"]);
  });

  test("assets are indexed by id so a motion's frame ids resolve to uris", () => {
    const project = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini;
    const motion = project.sprite.motions[0];
    expect(motion.frames).toHaveLength(4);
    expect(
      motion.frames.map((id) => resolveAssetUri(project, id)),
    ).toEqual([
      "motions/bounce/frames/00.png",
      "motions/bounce/frames/01.png",
      "motions/bounce/frames/02.png",
      "motions/bounce/frames/03.png",
    ]);
    expect(resolveAssetUri(project, motion.sheet!)).toBe(
      "motions/bounce/sheet.png",
    );
    expect(resolveAssetUri(project, "no-such-asset")).toBeUndefined();
  });

  test("the sidecar's structural fields survive the parse intact", () => {
    const project = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini;
    const motion = project.sprite.motions[0];
    expect(motion.grid).toEqual({ rows: 2, cols: 2 });
    expect(motion.fps).toBe(8);
    expect(motion.loop).toBe(true);
    expect(motion.anchor).toBe("bottom");
    expect(motion.status).toBe("ready");
    expect(motion.inspect?.frameCount).toBe(4);
    expect(motion.inspect?.warnings).toEqual([]);
    expect(project.sprite.character.cell).toEqual({ width: 64, height: 64 });
    expect(project.sprite.refs).toEqual([
      { id: "portrait", asset: "ref-portrait", role: "portrait", label: "Portrait" },
    ]);
    expect(project.provenance).toHaveLength(9);
    expect(project.composition?.settings.fps).toBe(8);
  });

  test("returns null when the snapshot holds no project at all", () => {
    expect(loadRoster([])).toBeNull();
    expect(
      loadRoster(files({ "mini/refs/portrait.png": "", "notes.md": "hi" })),
    ).toBeNull();
  });

  test("a malformed project is skipped while a valid sibling still loads", () => {
    // The agent writes project.json mid-turn; a reader can catch a partial
    // file. Blanking the whole stage for it would be the wrong trade.
    const roster = loadRoster(
      files({
        "broken/project.json": '{"$schema": "pneuma-craft/pro',
        "mini/project.json": MINI,
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("a project without the craft schema or the sprite sidecar is skipped", () => {
    const noSchema = JSON.parse(MINI);
    delete noSchema.$schema;
    const noSidecar = JSON.parse(MINI);
    delete noSidecar.sprite;

    const roster = loadRoster(
      files({
        "no-schema/project.json": JSON.stringify(noSchema),
        "no-sidecar/project.json": JSON.stringify(noSidecar),
        "mini/project.json": MINI,
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("image entries arrive with empty content and are simply not projects", () => {
    // The aggregate-file source watches refs/ and motions/ as change signals;
    // their content is empty by design and must not look like a parse failure.
    const roster = loadRoster(
      files({
        "mini/project.json": MINI,
        "mini/refs/portrait.png": "",
        "mini/motions/bounce/frames/00.png": "",
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("every declared status survives, and an unknown one falls back", () => {
    // `status` is what the rail renders a chip for and what "is this motion
    // done" reads. A string outside the five would travel as if it were one
    // of ours — an unrenderable chip, or a half-built motion reading `ready`
    // because the sidecar carried a typo.
    const withStatus = (status: unknown) => {
      const body = JSON.parse(MINI);
      body.sprite.motions[0].status = status;
      return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
        .byContentSet.mini.sprite.motions[0].status;
    };

    for (const status of MOTION_STATUSES) {
      expect({ status, parsed: withStatus(status) }).toEqual({
        status,
        parsed: status,
      });
    }
    expect(withStatus("rendering")).toBe("planned");
    expect(withStatus("")).toBe("planned");
    expect(withStatus(7)).toBe("planned");
    expect(withStatus(undefined)).toBe("planned");
  });

  test("a motion missing its optional halves still loads as a motion", () => {
    // `add-motion --status planned` writes exactly this: no sheet, no frames.
    const planned = JSON.parse(MINI);
    planned.sprite.motions = [
      {
        id: "walk",
        label: "Walk",
        prompt: "",
        grid: { rows: 2, cols: 4 },
        fps: 10,
        loop: true,
        anchor: "bottom",
        status: "planned",
        frames: [],
        videos: [],
      },
    ];
    const project = loadRoster(
      files({ "mini/project.json": JSON.stringify(planned) }),
    )!.byContentSet.mini;
    expect(project.sprite.motions[0].status).toBe("planned");
    expect(project.sprite.motions[0].sheet).toBeUndefined();
    expect(project.sprite.motions[0].inspect).toBeUndefined();
  });
});

describe("lookups", () => {
  const project = loadRoster(files({ "mini/project.json": MINI }))!
    .byContentSet.mini;

  test("findMotion / findRef resolve by address key, and miss cleanly", () => {
    expect(findMotion(project, "bounce")?.label).toBe("Bounce");
    expect(findMotion(project, "attack")).toBeUndefined();
    expect(findRef(project, "portrait")?.asset).toBe("ref-portrait");
    expect(findRef(project, "turnaround")).toBeUndefined();
  });
});

describe("saveRoster", () => {
  test("throws — the viewer is read-only in v0.1", () => {
    // Silence here would mean a viewer write vanishing without a trace.
    expect(() => saveRoster({ byContentSet: {} }, [])).toThrow(
      /read-only/,
    );
  });
});

describe("createCharacterProjectFile", () => {
  test("produces a project the loader accepts — createEmpty and `init` agree", () => {
    // The viewer's "new character" and `sprite-project.mjs init` must write
    // the same skeleton; they share this function so they cannot drift, and
    // this test pins the shape both of them depend on.
    const content = createCharacterProjectFile({
      name: "Lumi",
      description: "A lantern courier.",
      style: "clean anime-chibi line art",
      cell: { width: 256, height: 256 },
      facing: "right",
    });
    const roster = loadRoster(files({ "lumi/project.json": content }));
    const project = roster!.byContentSet.lumi;

    expect(JSON.parse(content).$schema).toBe(CRAFT_PROJECT_SCHEMA);
    expect(project.title).toBe("Lumi");
    expect(project.sprite.character).toEqual({
      name: "Lumi",
      description: "A lantern courier.",
      style: "clean anime-chibi line art",
      cell: { width: 256, height: 256 },
      facing: "right",
    });
    expect(project.sprite.refs).toEqual([]);
    expect(project.sprite.motions).toEqual([]);
    expect(project.assets).toEqual([]);
    expect(project.provenance).toEqual([]);
    // Composition mirrors the cell size: a future timeline renders at the
    // character's own resolution, not at a guessed one.
    expect(project.composition?.settings).toEqual({
      width: 256,
      height: 256,
      fps: 8,
      aspectRatio: "1:1",
    });
    expect(content.endsWith("\n")).toBe(true);
  });

  test("defaults a 256×256 cell and omits facing when unspecified", () => {
    const body = JSON.parse(createCharacterProjectFile({ name: "Nameless" }));
    expect(body.sprite.character.cell).toEqual({ width: 256, height: 256 });
    expect("facing" in body.sprite.character).toBe(false);
  });
});
