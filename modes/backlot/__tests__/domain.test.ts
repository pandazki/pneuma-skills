/**
 * The domain layer: what the viewer is allowed to believe about a workspace
 * the scripts are rewriting underneath it.
 *
 * The invariants under test are the brief's, not the parser's convenience:
 * frame arithmetic is exact, a check nobody looked at is `unverified`, a
 * trigger beat's cause must exist, and one broken shot must not blank the
 * film.
 */

import { describe, expect, test } from "bun:test";

import {
  beatAt,
  checkTally,
  checkTargets,
  conditioningChip,
  cutPoints,
  fovForLens,
  frameAt,
  lensAt,
  loadFilm,
  nextOpenStage,
  parseCharacter,
  parseCut,
  parseMusic,
  parseSceneMeta,
  parseSetPiece,
  parseShot,
  primaryAnchor,
  projectDirOf,
  recordRev,
  resolveLinePath,
  saveFilm,
  segmentAt,
  selectedTake,
  shotDir,
  shotRefOf,
  shotPictures,
  shotStages,
  shotThumbnail,
  stageLabel,
  type Project,
} from "../domain.js";
import { hashStage } from "../skill/scripts/stage-state.mjs";

type File = { path: string; content: string };

const BACKLOT_JSON = JSON.stringify({
  version: 1,
  title: "One Inch of Wind",
  defaults: { seconds: 8, fps: 24, width: 1280, height: 720 },
  shots: ["lab-walk", "corridor"],
});

function shotJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    id: "lab-walk",
    title: "The researcher wakes the device",
    entry: "original",
    spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 },
    assumptions: ["8 s / 24 fps / 1280x720 are defaults"],
    beats: [
      { id: "touch", label: "Raises a hand", from: 4.5, to: 5.5, kind: "action" },
      { id: "glow", label: "Device brightens", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch" },
    ],
    reference: null,
    greybox: {
      revision: 2,
      script: "greybox/scene.py",
      preview: null,
      final: {
        file: "greybox/greybox.mp4",
        revision: 2,
        renderedAt: 1,
        renderSeconds: 11.2,
        probe: { codec: "h264", width: 1280, height: 720, fps: 24, frames: 192, seconds: 8 },
      },
      glb: "greybox/scene.glb",
      meta: "greybox/scene.meta.json",
      blend: "greybox/scene.blend",
      sheet: "greybox/sheet.png",
    },
    checks: [
      { id: "frame-count", label: "192 frames", target: "greybox", status: "pass", range: null, revision: 2 },
      { id: "contact", label: "Hand reaches", target: "greybox", status: "fail", range: [4.5, 5.5], revision: 2 },
      { id: "penetration", label: "No limb clips", target: "greybox", status: "unverified", revision: 2 },
      { id: "take-order", label: "Glow follows", target: "take-01", status: "pass", revision: 2 },
    ],
    stuck: [],
    prompt: { file: "prompts.md" },
    takes: [
      {
        id: "take-01",
        status: "done",
        model: "bytedance/seedance-2.5",
        resolution: "480p",
        seconds: 8,
        refSeconds: 8,
        greyboxRevision: 2,
        requestId: "abc",
        file: "takes/take-01.mp4",
        probe: { width: 854, height: 480, fps: 24, frames: 193, seconds: 8.04 },
        cost: { usd: 2.12, basis: "(8 s out + 8 s ref) x $0.1323" },
        selected: true,
      },
    ],
    ...overrides,
  });
}

const BASE_FILES: File[] = [
  { path: "one-inch-of-wind/backlot.json", content: BACKLOT_JSON },
  { path: "one-inch-of-wind/shots/lab-walk/shot.json", content: shotJson() },
];

describe("paths", () => {
  test("a project is a top-level directory holding backlot.json", () => {
    expect(projectDirOf("one-inch-of-wind/backlot.json")).toBe("one-inch-of-wind");
    expect(projectDirOf("backlot.json")).toBe("");
    // Nested and dot directories are not content sets, so they cannot be a
    // project: the resolver would never offer them and every /content URL
    // built from one would 404.
    expect(projectDirOf("a/b/backlot.json")).toBeNull();
    expect(projectDirOf(".pneuma/backlot.json")).toBeNull();
    expect(projectDirOf("one-inch-of-wind/shot.json")).toBeNull();
  });

  test("a shot is `<project>/shots/<id>/shot.json`", () => {
    expect(shotRefOf("one-inch-of-wind/shots/lab-walk/shot.json")).toEqual({
      project: "one-inch-of-wind",
      shot: "lab-walk",
    });
    expect(shotRefOf("shots/lab-walk/shot.json")).toEqual({ project: "", shot: "lab-walk" });
    expect(shotRefOf("one-inch-of-wind/shots/lab-walk/takes/shot.json")).toBeNull();
    expect(shotRefOf("one-inch-of-wind/shot.json")).toBeNull();
  });

  test("shotDir composes the same path back", () => {
    expect(shotDir("one-inch-of-wind", "lab-walk")).toBe("one-inch-of-wind/shots/lab-walk");
    expect(shotDir("", "lab-walk")).toBe("shots/lab-walk");
  });
});

describe("parseShot", () => {
  test("reads the whole record", () => {
    const shot = parseShot("one-inch-of-wind/shots/lab-walk", "lab-walk", shotJson())!;
    expect(shot.id).toBe("lab-walk");
    expect(shot.spec.frames).toBe(192);
    expect(shot.beats).toHaveLength(2);
    expect(shot.greybox.final?.file).toBe("greybox/greybox.mp4");
    expect(shot.takes[0].probe?.seconds).toBe(8.04);
    expect(shot.warnings).toEqual([]);
  });

  test("frame arithmetic that disagrees with the spec is REPORTED, not trusted", () => {
    // Invariant 3: `frames = seconds × fps`, frames 1..N. A shot.json that
    // says 193 is the 8.04 s bug the whole mode exists to catch, and the
    // viewer must not quietly show it as fine.
    const shot = parseShot(
      "d",
      "s",
      shotJson({ spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 193 } }),
    )!;
    expect(shot.warnings.join(" ")).toContain("193");
    expect(shot.warnings.join(" ")).toContain("192");
  });

  test("an unreadable check status is unverified, never pass", () => {
    // Invariant 4: nothing is passed unseen. A status the loader cannot
    // read is a check nobody looked at.
    const shot = parseShot(
      "d",
      "s",
      shotJson({ checks: [{ id: "x", label: "X", target: "greybox", status: "probably-fine" }] }),
    )!;
    expect(shot.checks[0].status).toBe("unverified");
  });

  test("an unreadable take status is submitted, never done", () => {
    // Invariant 6: a take is never reported finished on the strength of a
    // field nobody could parse — that would hide a paid job.
    const shot = parseShot("d", "s", shotJson({ takes: [{ id: "take-09", status: "maybe" }] }))!;
    expect(shot.takes[0].status).toBe("submitted");
  });

  test("a beat naming a cause that does not exist is reported and dropped", () => {
    // Invariant 5: cause before effect. A dangling `causedBy` would draw a
    // connector to nothing.
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        beats: [{ id: "glow", label: "Glow", from: 1, to: 2, kind: "trigger", causedBy: "nope" }],
      }),
    )!;
    expect(shot.beats[0].causedBy).toBeNull();
    expect(shot.warnings.join(" ")).toContain("nope");
  });

  test("a reversed beat range is normalised rather than rendered backwards", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({ beats: [{ id: "a", label: "A", from: 3, to: 1, kind: "action" }] }),
    )!;
    expect(shot.beats[0].from).toBe(3);
    expect(shot.beats[0].to).toBe(3);
  });

  test("a check range given backwards is sorted", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({ checks: [{ id: "x", label: "X", target: "greybox", status: "fail", range: [5, 2] }] }),
    )!;
    expect(shot.checks[0].range).toEqual([2, 5]);
  });

  test("a missing greybox block is a named absence, not a crash", () => {
    const shot = parseShot("d", "s", shotJson({ greybox: undefined }))!;
    expect(shot.greybox.final).toBeNull();
    expect(shot.greybox.revision).toBe(0);
    expect(shot.warnings.join(" ")).toContain("greybox");
  });

  test("garbage is null, not an exception — the file is rewritten mid-render", () => {
    expect(parseShot("d", "s", "{ half-writt")).toBeNull();
    expect(parseShot("d", "s", "[]")).toBeNull();
    expect(parseShot("d", "s", JSON.stringify({ title: "no version" }))).toBeNull();
  });
});

describe("loadFilm", () => {
  test("assembles projects and their shots", () => {
    const film = loadFilm(BASE_FILES)!;
    expect(Object.keys(film.projects)).toEqual(["one-inch-of-wind"]);
    expect(film.projects["one-inch-of-wind"].title).toBe("One Inch of Wind");
    expect(film.projects["one-inch-of-wind"].shots.map((s) => s.id)).toEqual(["lab-walk"]);
  });

  test("shots come back in backlot.json order, strays last", () => {
    const film = loadFilm([
      ...BASE_FILES,
      { path: "one-inch-of-wind/shots/zeta/shot.json", content: shotJson({ id: "zeta" }) },
      { path: "one-inch-of-wind/shots/corridor/shot.json", content: shotJson({ id: "corridor" }) },
    ])!;
    expect(film.projects["one-inch-of-wind"].shots.map((s) => s.id)).toEqual([
      "lab-walk",
      "corridor",
      "zeta",
    ]);
  });

  test("a listed shot with no shot.json is a named warning", () => {
    const film = loadFilm(BASE_FILES)!;
    expect(film.projects["one-inch-of-wind"].warnings.join(" ")).toContain("corridor");
  });

  test("one broken shot does not blank its siblings", () => {
    const film = loadFilm([
      ...BASE_FILES,
      { path: "one-inch-of-wind/shots/broken/shot.json", content: "{ oh no" },
    ])!;
    expect(film.projects["one-inch-of-wind"].shots.map((s) => s.id)).toEqual(["lab-walk"]);
  });

  test("a half-written backlot.json still names the project and keeps its shots", () => {
    const film = loadFilm([
      { path: "one-inch-of-wind/backlot.json", content: '{ "title": "First' },
      BASE_FILES[1],
    ])!;
    expect(film.projects["one-inch-of-wind"].shots).toHaveLength(1);
    expect(film.projects["one-inch-of-wind"].warnings.join(" ")).toContain("backlot.json");
  });

  test("a shot whose project manifest is absent is skipped, not orphaned", () => {
    const film = loadFilm([BASE_FILES[1]])!;
    expect(film.projects).toEqual({});
  });

  test("the viewer cannot write — backlot.json belongs to the script", () => {
    // Invariant 2: one writer for machine state.
    expect(() => saveFilm({ projects: {} }, [])).toThrow(/read-only/);
  });
});

describe("frameAt", () => {
  const spec = { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 };

  test("t = 0 is frame 1 — Blender numbers frames 1..N", () => {
    expect(frameAt(0, spec)).toBe(1);
  });

  test("3.80 s at 24 fps is frame 92, the brief's readout", () => {
    expect(frameAt(3.8, spec)).toBe(92);
  });

  test("the end of the shot is frame N, never N+1", () => {
    // 1 + round(8 × 24) = 193, and frame 193 does not exist.
    expect(frameAt(8, spec)).toBe(192);
    expect(frameAt(99, spec)).toBe(192);
  });

  test("before zero is still frame 1", () => {
    expect(frameAt(-1, spec)).toBe(1);
  });
});

describe("beatAt", () => {
  const beats = parseShot("d", "s", shotJson())!.beats;

  test("finds the beat containing the moment", () => {
    expect(beatAt(beats, 5)?.id).toBe("touch");
    expect(beatAt(beats, 6)?.id).toBe("glow");
  });

  test("prefers the narrowest beat when they overlap", () => {
    const wide = [
      { id: "push", label: "", from: 0, to: 8, kind: "camera" as const, causedBy: null, detail: null },
      { id: "walk", label: "", from: 1, to: 2, kind: "action" as const, causedBy: null, detail: null },
    ];
    expect(beatAt(wide, 1.5)?.id).toBe("walk");
  });

  test("between beats is null, not the nearest one", () => {
    expect(beatAt(beats, 0.2)).toBeNull();
  });
});

describe("acceptance helpers", () => {
  const shot = parseShot("d", "s", shotJson())!;

  test("the tally counts all three states", () => {
    expect(checkTally(shot.checks.filter((c) => c.target === "greybox"))).toEqual({
      pass: 1,
      fail: 1,
      unverified: 1,
    });
  });

  test("targets are greybox first, then takes", () => {
    expect(checkTargets(shot.checks)).toEqual(["greybox", "take-01"]);
  });

  test("a shot is not accepted while one check is unverified", () => {
    // Invariant 4 again, at the summary level: the rail dot must not go green
    // on "nobody looked".
    expect(shotStages(shot).accepted).toBe(false);
  });

  test("a shot is accepted only when every greybox check passed", () => {
    const passing = parseShot(
      "d",
      "s",
      shotJson({
        checks: [{ id: "a", label: "A", target: "greybox", status: "pass", revision: 2 }],
      }),
    )!;
    expect(shotStages(passing).accepted).toBe(true);
  });

  test("a stuck shot is never accepted, whatever the checks say", () => {
    const stuck = parseShot(
      "d",
      "s",
      shotJson({
        checks: [{ id: "a", label: "A", target: "greybox", status: "pass", revision: 2 }],
        stuck: ["a"],
      }),
    )!;
    expect(shotStages(stuck).accepted).toBe(false);
  });

  test("the stage dots read the record, not the file system", () => {
    expect(shotStages(shot)).toEqual({ plan: true, greybox: true, accepted: false, take: true });
  });

  test("a submitted take does not light the take dot", () => {
    const pending = parseShot(
      "d",
      "s",
      shotJson({ takes: [{ id: "take-01", status: "submitted" }] }),
    )!;
    expect(shotStages(pending).take).toBe(false);
  });

  test("selectedTake prefers the delivered one, else the first", () => {
    expect(selectedTake(shot)?.id).toBe("take-01");
    const two = parseShot(
      "d",
      "s",
      shotJson({
        takes: [
          { id: "take-01", status: "done", selected: false },
          { id: "take-02", status: "done", selected: true },
        ],
      }),
    )!;
    expect(selectedTake(two)?.id).toBe("take-02");
  });
});

describe("parseSceneMeta", () => {
  const META = JSON.stringify({
    fps: 24,
    frames: 192,
    seconds: 8,
    width: 1280,
    height: 720,
    camera: "cam",
    subjects: ["root"],
    accents: [{ objects: ["device_core"], from: 5.5, to: 7.5, color: [0.08, 0.42, 1] }],
    blender: "5.2.1",
    engine: "BLENDER_WORKBENCH",
  });

  test("reads the sidecar the 3D lane needs", () => {
    const meta = parseSceneMeta(META)!;
    expect(meta.camera).toBe("cam");
    expect(meta.subjects).toEqual(["root"]);
    expect(meta.accents[0].color).toEqual([0.08, 0.42, 1]);
  });

  test("an accent with no colour or no objects is dropped, not half-applied", () => {
    const meta = parseSceneMeta(
      JSON.stringify({ fps: 24, frames: 192, accents: [{ objects: ["a"] }, { color: [1, 0, 0] }] }),
    )!;
    expect(meta.accents).toEqual([]);
  });

  test("the named places and the pawns' own colours are read", () => {
    // glTF exports every one of the kit's materials at the default 0.8 grey,
    // so this sidecar is the ONLY place the 3D lane can learn that the tower
    // is red — the same reason the accents are here.
    const meta = parseSceneMeta(
      JSON.stringify({
        fps: 24,
        frames: 144,
        subjects: ["challenger", "door"],
        landmarks: [
          {
            name: "tower",
            label: "the bell tower",
            color: "red",
            rgb: [0.85, 0.15, 0.12],
            objects: ["tower", "tower_top"],
            in_frame: { first: false, last: true },
          },
        ],
        subjects_detail: [
          {
            name: "challenger",
            color: "grey",
            rgb: [0.78, 0.63, 0.42],
            behind: { first: [], last: ["tower"] },
          },
          { name: "door", color: null, rgb: null, behind: null },
        ],
      }),
    )!;
    expect(meta.landmarks).toEqual([
      {
        name: "tower",
        label: "the bell tower",
        color: "red",
        rgb: [0.85, 0.15, 0.12],
        objects: ["tower", "tower_top"],
        inFrame: { first: false, last: true },
      },
    ]);
    // A prop is a subject with no geography, not a figure whose geography
    // went missing: `behind: null` survives as null.
    expect(meta.subjectsDetail).toEqual([
      {
        name: "challenger",
        color: "grey",
        rgb: [0.78, 0.63, 0.42],
        behind: { first: [], last: ["tower"] },
      },
      { name: "door", color: null, rgb: null, behind: null },
    ]);
  });

  test("a sidecar written before landmarks existed reads as no landmarks", () => {
    const meta = parseSceneMeta(META)!;
    expect(meta.landmarks).toEqual([]);
    expect(meta.subjectsDetail).toEqual([]);
  });

  test("a landmark with no colour, no blocks or no name is dropped, not thrown", () => {
    const meta = parseSceneMeta(
      JSON.stringify({
        fps: 24,
        frames: 144,
        landmarks: [
          { name: "tower", objects: ["tower"] },
          { name: "tree", rgb: [0.15, 0.35, 0.85], objects: [] },
          { rgb: [0.92, 0.8, 0.1], objects: ["awning"] },
          { name: "half", rgb: [0.15, 0.65], objects: ["sign"] },
          "not a record",
          // Enough to paint: the label falls back to the name and `in_frame`
          // stays null rather than claiming the camera never saw it.
          { name: "steps", rgb: [0.95, 0.5, 0.1], objects: ["steps"], in_frame: { first: true } },
        ],
        subjects_detail: [{ color: "grey" }, { name: "keeper" }],
      }),
    )!;
    expect(meta.landmarks).toEqual([
      {
        name: "steps",
        label: "steps",
        color: null,
        rgb: [0.95, 0.5, 0.1],
        objects: ["steps"],
        inFrame: null,
      },
    ]);
    expect(meta.subjectsDetail).toEqual([
      { name: "keeper", color: null, rgb: null, behind: null },
    ]);
  });

  test("a file without fps or frames is not a scene meta", () => {
    expect(parseSceneMeta(JSON.stringify({ camera: "cam" }))).toBeNull();
    expect(parseSceneMeta("not json")).toBeNull();
  });

  test("the focal curve is read, sorted, and cleaned of impossible lenses", () => {
    // glTF carries no lens animation, so a dolly zoom would read as a plain
    // dolly without this. A lens of zero is not a wide lens, it is a broken
    // record, and a broken record must not be flown through.
    const meta = parseSceneMeta(
      JSON.stringify({
        fps: 24,
        frames: 48,
        camera_lens: [
          { frame: 10, mm: 24 },
          { frame: 1, mm: 50 },
          { frame: 5, mm: 0 },
          { frame: 7 },
        ],
      }),
    )!;
    expect(meta.cameraLens).toEqual([
      { frame: 1, mm: 50 },
      { frame: 10, mm: 24 },
    ]);
    expect(parseSceneMeta(JSON.stringify({ fps: 24, frames: 48 }))!.cameraLens).toEqual([]);
  });

  test("the lens in force is STEPPED — the curve is keyed on every frame", () => {
    const keys = [
      { frame: 1, mm: 50 },
      { frame: 10, mm: 24 },
    ];
    expect(lensAt(keys, 1)).toBe(50);
    expect(lensAt(keys, 9)).toBe(50);
    expect(lensAt(keys, 10)).toBe(24);
    expect(lensAt(keys, 999)).toBe(24);
    // Before the first key the first key holds; an empty track is "no answer".
    expect(lensAt(keys, -5)).toBe(50);
    expect(lensAt([], 3)).toBeNull();
  });

  test("a focal length becomes the vertical angle Three needs", () => {
    // Blender's default 36 mm sensor across the long side: a 50 mm lens is
    // 2·atan(36/100) = 39.60° horizontally, and on 16:9 that is
    // 2·atan(0.36 · 9/16) = 22.90° vertically — the number Three's camera
    // takes.
    expect(fovForLens(50, 1280, 720)).toBeCloseTo(22.9, 1);
    // Wider lens, wider angle — and the dolly zoom's whole point.
    expect(fovForLens(24, 1280, 720)).toBeGreaterThan(fovForLens(50, 1280, 720));
  });
});

// ── The whole film: eight stages, a bible, sound and a cut ─────────────────

const CHARACTER_JSON = JSON.stringify({
  version: 1,
  id: "kai",
  name: "小凯",
  description: "The night-shift researcher.",
  look: "mid-twenties, grey hoodie, tired",
  sheet: { file: "sheet.png", revision: 2, cost: { usd: 0.13, basis: "reported" } },
  voice: {
    model: "seed-speech",
    voiceId: "zh_male_01",
    style: "flat, quiet",
    sample: { file: "voice.mp3", text: "还开着吗？", seconds: 2.2, cost: { usd: 0.01, basis: "table" } },
  },
});

const SET_JSON = JSON.stringify({
  version: 1,
  id: "lab",
  name: "实验室",
  description: "One bench, one door, one device.",
  look: "cold fluorescents, concrete",
  concept: { file: "concept.png", revision: 1, cost: { usd: 0.12, basis: "reported" } },
});

const SOUND_JSON = JSON.stringify({
  version: 1,
  music: {
    file: "music.mp3",
    prompt: "low drone, one piano figure",
    model: "google/lyria-3-pro-preview",
    seconds: 26,
    cost: { usd: 0.4, basis: "reported" },
  },
});

const EDL_JSON = JSON.stringify({
  version: 1,
  kind: "reel",
  file: "reel.mp4",
  seconds: 16,
  builtAt: 1758380000000,
  segments: [
    { shot: "lab-walk", source: "take-01", offset: 0, seconds: 8 },
    { shot: "corridor", source: "greybox", offset: 8, seconds: 8 },
  ],
  vo: [{ shot: "lab-walk", line: "l2", at: 0.8, file: "shots/lab-walk/sound/l2.mp3" }],
  music: { file: "sound/music.mp3", gainDb: -18, fadeOutSeconds: 2 },
});

const FILM_MANIFEST = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    title: "One Inch of Wind",
    logline: "A researcher wakes a device that was not asleep.",
    defaults: { seconds: 8, fps: 24, width: 1280, height: 720 },
    gates: "closed",
    scenes: [
      { id: "sc1", number: 1, heading: "INT. 实验室 — 夜", summary: "Kai comes back for the device." },
      { id: "sc2", number: 2, heading: "INT. 走廊 — 夜", summary: "The corridor answers." },
    ],
    characters: ["kai"],
    sets: ["lab"],
    shots: ["lab-walk", "corridor"],
    ...extra,
  });

const FILM_SHOT = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    id,
    title: id === "lab-walk" ? "The researcher wakes the device" : "The corridor",
    entry: "original",
    spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 },
    scene: id === "lab-walk" ? "sc1" : "sc2",
    characters: ["kai"],
    set: "lab",
    board: {
      file: "board.png",
      revision: 1,
      prompt: "wide, the door at frame left",
      refs: ["bible/characters/kai/sheet.png"],
      at: 1758370000000,
      cost: { usd: 0.11, basis: "reported" },
    },
    lines: [
      { id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 5.2, file: null, seconds: null, cost: null },
      {
        id: "l2",
        speaker: "narrator",
        kind: "vo",
        text: "凌晨三点。",
        at: 0.8,
        file: "sound/l2.mp3",
        seconds: 3.1,
        cost: { usd: 0.02, basis: "table" },
      },
    ],
    greybox: { revision: 1, final: { file: "greybox/greybox.mp4", revision: 1 } },
    checks: [{ id: "frames", label: "192 frames", target: "greybox", status: "pass", revision: 1 }],
    takes:
      id === "lab-walk"
        ? [
            {
              id: "take-01",
              status: "done",
              model: "bytedance/seedance-2.5",
              file: "takes/take-01.mp4",
              selected: true,
              submittedAt: 1758375000000,
              cost: { usd: 2.12, basis: "table" },
              refs: [
                { kind: "video", index: 1, file: "greybox/greybox.mp4", role: "layout" },
                { kind: "image", index: 1, file: "board.png" },
              ],
            },
          ]
        : [],
    ...extra,
  });

const FILM_FILES: File[] = [
  { path: "one-inch-of-wind/backlot.json", content: FILM_MANIFEST() },
  { path: "one-inch-of-wind/idea.md", content: "# One Inch of Wind\n\nA device that was not asleep.\n" },
  { path: "one-inch-of-wind/screenplay.md", content: "## INT. 实验室 — 夜\n\nKai opens the door.\n" },
  { path: "one-inch-of-wind/bible/characters/kai/character.json", content: CHARACTER_JSON },
  { path: "one-inch-of-wind/bible/sets/lab/set.json", content: SET_JSON },
  { path: "one-inch-of-wind/shots/lab-walk/shot.json", content: FILM_SHOT("lab-walk") },
  { path: "one-inch-of-wind/shots/corridor/shot.json", content: FILM_SHOT("corridor") },
  { path: "one-inch-of-wind/sound/sound.json", content: SOUND_JSON },
  { path: "one-inch-of-wind/cut/edl.json", content: EDL_JSON },
];

/** The project-relative text map `loadFilm` hands to `stage-state.mjs`. */
function textsOf(files: File[], dir: string): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const file of files) {
    if (!file.path.startsWith(`${dir}/`)) continue;
    texts[file.path.slice(dir.length + 1)] = file.content;
  }
  return texts;
}

function filmProject(files: File[] = FILM_FILES): Project {
  return loadFilm(files)!.projects["one-inch-of-wind"];
}

describe("the project manifest", () => {
  test("reads the fields the eight stages hang off", () => {
    const project = filmProject();
    expect(project.title).toBe("One Inch of Wind");
    expect(project.logline).toContain("researcher");
    expect(project.gates).toBe("closed");
    expect(project.scenes.map((s) => s.id)).toEqual(["sc1", "sc2"]);
    expect(project.characters.map((c) => c.id)).toEqual(["kai"]);
    expect(project.sets.map((s) => s.id)).toEqual(["lab"]);
    expect(project.idea).toContain("One Inch of Wind");
    expect(project.screenplay).toContain("实验室");
    expect(project.warnings).toEqual([]);
  });

  test("THE OLD SEED STILL LOADS — missing project fields default, nothing is invented", () => {
    // `one-inch-of-wind/backlot.json` predates scenes, gates, approvals and the
    // bible. A loader that required them would blank the shipped seed.
    const project = loadFilm(BASE_FILES)!.projects["one-inch-of-wind"];
    expect(project.logline).toBe("");
    expect(project.gates).toBe("closed");
    expect(project.approvals).toEqual({});
    expect(project.scenes).toEqual([]);
    expect(project.characters).toEqual([]);
    expect(project.sets).toEqual([]);
    expect(project.sound).toEqual({ music: null, lines: [] });
    expect(project.cut).toBeNull();
    expect(project.idea).toBeNull();
    expect(project.stages.map((s) => s.status)).toEqual([
      "empty",
      "empty",
      "empty",
      "draft",
      "draft",
      "draft",
      "empty",
      "empty",
    ]);
    // The only warning is the one the old fixture earns on its own.
    expect(project.warnings.join(" ")).toContain("corridor");
  });

  test("gates nobody can read are CLOSED, and the guess is written down", () => {
    const project = filmProject([
      { path: "one-inch-of-wind/backlot.json", content: FILM_MANIFEST({ gates: "ajar" }) },
    ]);
    expect(project.gates).toBe("closed");
    expect(project.warnings.join(" ")).toContain("ajar");
  });

  test("an unknown manifest version is read as 1 and reported", () => {
    const project = filmProject([
      { path: "one-inch-of-wind/backlot.json", content: FILM_MANIFEST({ version: 7 }) },
    ]);
    expect(project.title).toBe("One Inch of Wind");
    expect(project.warnings.join(" ")).toContain("version 7");
  });

  test("a scene with no id is dropped by name rather than drawn blank", () => {
    const project = filmProject([
      {
        path: "one-inch-of-wind/backlot.json",
        content: FILM_MANIFEST({ scenes: [{ number: 1, heading: "INT. NOWHERE" }] }),
      },
    ]);
    expect(project.scenes).toEqual([]);
    expect(project.warnings.join(" ")).toContain("no id");
  });

  test("a listed character with no record is a named warning", () => {
    const project = filmProject(FILM_FILES.filter((f) => !f.path.includes("/characters/")));
    expect(project.characters).toEqual([]);
    expect(project.warnings.join(" ")).toContain('character "kai"');
  });

  test("a scene carries the shots broken out of it, in shot order", () => {
    const project = filmProject();
    expect(project.scenes[0].shots).toEqual(["lab-walk"]);
    expect(project.scenes[1].shots).toEqual(["corridor"]);
  });

  test("a shot naming a scene that does not exist is reported", () => {
    const project = filmProject([
      ...FILM_FILES.filter((f) => !f.path.includes("shots/corridor")),
      {
        path: "one-inch-of-wind/shots/corridor/shot.json",
        content: FILM_SHOT("corridor", { scene: "sc9" }),
      },
    ]);
    expect(project.warnings.join(" ")).toContain("sc9");
  });
});

describe("bible, sound and cut records", () => {
  test("a character carries its sheet, its voice and where it lives", () => {
    const project = filmProject();
    const kai = project.characters[0];
    expect(kai.name).toBe("小凯");
    expect(kai.dir).toBe("one-inch-of-wind/bible/characters/kai");
    expect(kai.sheet).toEqual({ file: "sheet.png", revision: 2, cost: { usd: 0.13, basis: "reported" } });
    expect(kai.voice?.sample?.seconds).toBe(2.2);
  });

  test("a set is a place, with its concept frame", () => {
    const lab = filmProject().sets[0];
    expect(lab.name).toBe("实验室");
    expect(lab.concept?.file).toBe("concept.png");
    expect(lab.dir).toBe("one-inch-of-wind/bible/sets/lab");
  });

  test("a half-written bible record is skipped with a warning, not thrown on", () => {
    const project = filmProject([
      ...FILM_FILES.filter((f) => !f.path.includes("/characters/")),
      { path: "one-inch-of-wind/bible/characters/kai/character.json", content: "{ half" },
    ]);
    expect(project.characters).toEqual([]);
    expect(project.warnings.join(" ")).toContain("bible/characters/kai");
    // The rest of the film still loads.
    expect(project.shots).toHaveLength(2);
  });

  test("parseCharacter and parseSetPiece default what is missing", () => {
    const bare = parseCharacter("d", "kai", JSON.stringify({ version: 1 }))!;
    expect(bare.id).toBe("kai");
    expect(bare.name).toBe("kai");
    expect(bare.sheet).toBeNull();
    expect(bare.voice).toBeNull();
    expect(parseSetPiece("d", "lab", "not json")).toBeNull();
  });

  test("a voice block with no sample is a voice choice, not a recording", () => {
    const character = parseCharacter(
      "d",
      "kai",
      JSON.stringify({ id: "kai", voice: { model: "seed-speech", voiceId: "v1" } }),
    )!;
    expect(character.voice?.voiceId).toBe("v1");
    expect(character.voice?.sample).toBeNull();
  });

  test("every line of every shot arrives in the sound state, with its shot", () => {
    const sound = filmProject().sound;
    expect(sound.lines.map((l) => `${l.shot}:${l.id}`)).toEqual([
      "lab-walk:l1",
      "lab-walk:l2",
      "corridor:l1",
      "corridor:l2",
    ]);
    expect(sound.lines[0].kind).toBe("spoken");
    expect(sound.lines[1].file).toBe("sound/l2.mp3");
    expect(sound.music?.model).toBe("google/lyria-3-pro-preview");
  });

  test("a line whose kind cannot be read is voice-over, never spoken", () => {
    // `spoken` claims the video model will render the mouth. That claim is
    // never made on the strength of a field nobody could parse.
    const shot = parseShot("d", "s", shotJson({ lines: [{ id: "l1", kind: "shouted" }] }))!;
    expect(shot.lines[0].kind).toBe("vo");
  });

  test("a take records the references it was rendered against, and their jobs", () => {
    const project = filmProject();
    const take = project.shots[0].takes[0];
    expect(take.refs).toEqual([
      { kind: "video", index: 1, file: "greybox/greybox.mp4", role: "layout" },
      // A reference written before roles existed has none, not undefined:
      // "nobody assigned this one a job" is exactly what null has to mean.
      { kind: "image", index: 1, file: "board.png", role: null },
    ]);
    // A take from before references were recorded has none, not undefined.
    expect(parseShot("d", "s", shotJson())!.takes[0].refs).toEqual([]);
  });

  test("a `handoff` role is kept verbatim — the viewer never narrows the vocabulary", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        takes: [
          {
            id: "take-01",
            status: "done",
            refs: [
              { kind: "image", index: 3, file: "takes/handoff-in.png", role: "handoff" },
              { kind: "image", index: 4, file: "sheet.png", role: 42 },
            ],
          },
        ],
      }),
    )!;
    expect(shot.takes[0].refs.map((r) => r.role)).toEqual(["handoff", null]);
  });

  test("a take records the hand-off it was given, or that it was skipped", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        takes: [
          { id: "take-01", status: "done", handoff: "skipped" },
          {
            id: "take-02",
            status: "done",
            handoff: { from: "s02", take: "take-01", frame: 192, at: 7.96, file: "takes/handoff-in.png" },
          },
          { id: "take-03", status: "done" },
          { id: "take-04", status: "done", handoff: "yes please" },
        ],
      }),
    )!;
    expect(shot.takes[0].handoff).toEqual({
      skipped: true,
      from: null,
      take: null,
      frame: null,
      at: null,
      file: null,
    });
    expect(shot.takes[1].handoff).toEqual({
      skipped: false,
      from: "s02",
      take: "take-01",
      frame: 192,
      at: 7.96,
      file: "takes/handoff-in.png",
    });
    // No record, and an unreadable one, are both "nothing was handed over":
    // being given the previous frame is never inferred from a field nobody
    // could parse.
    expect(shot.takes[2].handoff).toBeNull();
    expect(shot.takes[3].handoff).toBeNull();
  });

  test("the cut is read as its edit list, and a reel says so", () => {
    const cut = filmProject().cut!;
    expect(cut.kind).toBe("reel");
    expect(cut.segments.map((s) => s.shot)).toEqual(["lab-walk", "corridor"]);
    expect(cut.vo[0].at).toBe(0.8);
    expect(cut.music?.gainDb).toBe(-18);
  });

  test("a `final` that still stands a greybox in is demoted to a reel", () => {
    // The label is a claim about what the user is watching; the segment list
    // is the evidence, and the evidence wins.
    const cut = parseCut(
      JSON.stringify({
        kind: "final",
        file: "final.mp4",
        segments: [{ shot: "a", source: "greybox", offset: 0, seconds: 4 }],
      }),
    )!;
    expect(cut.kind).toBe("reel");
    expect(cut.seconds).toBe(4);
  });

  test("a cut with every take in place stays a final", () => {
    const cut = parseCut(
      JSON.stringify({
        kind: "final",
        file: "final.mp4",
        seconds: 8,
        segments: [{ shot: "a", source: "take-02", offset: 0, seconds: 8 }],
      }),
    )!;
    expect(cut.kind).toBe("final");
  });

  test("music with no file is no music at all", () => {
    expect(parseMusic(JSON.stringify({ music: { prompt: "x" } }))).toBeNull();
    expect(parseMusic("{")).toBeNull();
  });

  test("segmentAt finds the shot playing at a second", () => {
    const cut = filmProject().cut!;
    expect(segmentAt(cut, 0)?.shot).toBe("lab-walk");
    expect(segmentAt(cut, 7.99)?.shot).toBe("lab-walk");
    // A boundary belongs to the shot that STARTS there.
    expect(segmentAt(cut, 8)?.shot).toBe("corridor");
    // The last frame of the film is still the last shot.
    expect(segmentAt(cut, 16)?.shot).toBe("corridor");
    expect(segmentAt(cut, -1)).toBeNull();
    expect(segmentAt(null, 1)).toBeNull();
  });

  test("a line file is resolved project-relative or shot-relative, as written", () => {
    expect(resolveLinePath("one-inch-of-wind", "one-inch-of-wind/shots/s01", "sound/l2.mp3")).toBe(
      "one-inch-of-wind/sound/l2.mp3",
    );
    expect(resolveLinePath("one-inch-of-wind", "one-inch-of-wind/shots/s01", "shots/s01/sound/l2.mp3")).toBe(
      "one-inch-of-wind/shots/s01/sound/l2.mp3",
    );
    expect(resolveLinePath("one-inch-of-wind", "one-inch-of-wind/shots/s01", "l2.mp3")).toBe(
      "one-inch-of-wind/shots/s01/l2.mp3",
    );
  });

  test("recordRev changes exactly when the record does", () => {
    const sample = { file: "voice.mp3", seconds: 2.2 };
    expect(recordRev(sample)).toBe(recordRev({ seconds: 2.2, file: "voice.mp3" }));
    expect(recordRev(sample)).not.toBe(recordRev({ ...sample, seconds: 2.3 }));
  });
});

// ── Continuity, anchors and the designed picture ────────────────────────────

describe("continuity", () => {
  test("a declared hand-off is read whole", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        continuity: {
          from: "s03-orbit",
          entry: "challenger mid-lunge, blade at chest height",
          exit: "blades in contact, both weight forward",
        },
      }),
    )!;
    expect(shot.continuity).toEqual({
      from: "s03-orbit",
      entry: "challenger mid-lunge, blade at chest height",
      exit: "blades in contact, both weight forward",
    });
  });

  test("no block, an empty block and a non-object are all 'no hand-off'", () => {
    // HAND-OFF IS OPT-IN: most cuts exist to break continuity, so the
    // absence of a declaration is the normal case and never a half-read one.
    expect(parseShot("d", "s", shotJson())!.continuity).toBeNull();
    expect(parseShot("d", "s", shotJson({ continuity: null }))!.continuity).toBeNull();
    expect(parseShot("d", "s", shotJson({ continuity: {} }))!.continuity).toBeNull();
    expect(parseShot("d", "s", shotJson({ continuity: "yes" }))!.continuity).toBeNull();
    expect(
      parseShot("d", "s", shotJson({ continuity: { from: null, entry: null, exit: null } }))!
        .continuity,
    ).toBeNull();
  });

  test("an exit alone is kept — a shot may say how it ends without continuing anything", () => {
    // `shot.mjs::makeContinuity` allows exactly this shape, for a later shot
    // to pick up. It is NOT a hand-off and must not be read as one.
    const shot = parseShot(
      "d",
      "s",
      shotJson({ continuity: { from: null, entry: null, exit: "blade low, guard open" } }),
    )!;
    expect(shot.continuity).toEqual({ from: null, entry: null, exit: "blade low, guard open" });
  });
});

describe("conditioning", () => {
  test("is read whole, and anything unreadable is the greybox it was made as", () => {
    expect(parseShot("d", "s", shotJson())!.conditioning).toBe("greybox");
    expect(parseShot("d", "s", shotJson({ conditioning: "free" }))!.conditioning).toBe("free");
    expect(parseShot("d", "s", shotJson({ conditioning: "hybrid" }))!.conditioning).toBe("hybrid");
    // A typo must not make the viewer claim a shot was shot free when the
    // take on record was conditioned on a block.
    expect(parseShot("d", "s", shotJson({ conditioning: "liberated" }))!.conditioning).toBe("greybox");
    expect(parseShot("d", "s", shotJson({ conditioning: 3 }))!.conditioning).toBe("greybox");
  });

  test("the chip is one word and one sentence, and every surface reads the same ones", () => {
    const free = parseShot("d", "s", shotJson({ conditioning: "free" }))!;
    expect(conditioningChip(free)).toEqual({
      id: "free",
      label: "free",
      title: conditioningChip("free").title,
    });
    expect(conditioningChip(free).title).toContain("no greybox is sent");
    expect(conditioningChip("greybox").label).toBe("greybox");
    expect(conditioningChip("hybrid").label).toBe("hybrid");
    expect(conditioningChip("hybrid").title).toContain("positions and the camera path");
    // A shot and its bare id answer identically: one authority for the word.
    expect(conditioningChip(free)).toEqual(conditioningChip("free"));
  });
});

describe("the designed picture", () => {
  test("a beat carries its design, and a beat written before details has none", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        beats: [
          { id: "lunge", label: "Lunges", from: 0, to: 2, kind: "action", detail: "  weight through the front foot, dust off the flagstones  " },
          { id: "hold", label: "Holds", from: 2, to: 3, kind: "hold" },
          { id: "blank", label: "Blank", from: 3, to: 4, kind: "action", detail: "   " },
        ],
      }),
    )!;
    expect(shot.beats.map((b) => b.detail)).toEqual([
      "  weight through the front foot, dust off the flagstones  ",
      null,
      null,
    ]);
  });

  test("anchors are read in order; one with no id or no file is dropped", () => {
    const shot = parseShot(
      "d",
      "s",
      shotJson({
        anchors: [
          {
            id: "first",
            file: "anchors/first.png",
            revision: 2,
            at: 0,
            prompt: "the keeper turning the thrust aside",
            refs: ["bible/characters/kai/sheet.png"],
            createdAt: 1758370000000,
            cost: { usd: 0.11, basis: "reported" },
          },
          { id: "impact", file: "anchors/impact.png", revision: 1, at: 3.2 },
          { file: "anchors/nameless.png", revision: 1 },
          { id: "fileless", revision: 1 },
        ],
      }),
    )!;
    expect(shot.anchors.map((a) => a.id)).toEqual(["first", "impact"]);
    expect(shot.anchors[0].at).toBe(0);
    expect(shot.anchors[0].cost?.usd).toBe(0.11);
    expect(shot.anchors[1].prompt).toBe("");
    expect(shot.anchors[1].createdAt).toBeNull();
    // A shot from before anchors existed has none, not undefined.
    expect(parseShot("d", "s", shotJson())!.anchors).toEqual([]);
  });

  test("the lineup's anchor is `first` by name, else the earliest moment", () => {
    const named = parseShot(
      "d",
      "s",
      shotJson({
        anchors: [
          { id: "impact", file: "a.png", at: 3.2 },
          { id: "first", file: "b.png", at: 5 },
        ],
      }),
    )!;
    expect(primaryAnchor(named)?.id).toBe("first");

    const unnamed = parseShot(
      "d",
      "s",
      shotJson({
        anchors: [
          { id: "impact", file: "a.png", at: 3.2 },
          { id: "open", file: "b.png", at: 0.4 },
        ],
      }),
    )!;
    expect(primaryAnchor(unnamed)?.id).toBe("open");

    // Nothing placed on the clock: whatever was written first.
    const unplaced = parseShot(
      "d",
      "s",
      shotJson({ anchors: [{ id: "a", file: "a.png" }, { id: "b", file: "b.png" }] }),
    )!;
    expect(primaryAnchor(unplaced)?.id).toBe("a");
    expect(primaryAnchor(parseShot("d", "s", shotJson())!)).toBeNull();
  });

  /**
   * The shot list's thumbnail, after three acceptance rounds removed every
   * picture that competed with the greybox.
   *
   * Nothing is drawn at the shot-plan stage, and the greybox is the one
   * picture of layout the take receives — so it leads, and the optional
   * stills only stand in while there is no render.
   */
  test("a shot card shows its greybox, else a key frame, else a grey card", () => {
    // THE GREYBOX IS THE PICTURE, and it wins over every optional still:
    // it is the shot's actual space, staging and camera, and the only
    // picture the take is conditioned on. An MP4, drawn as a poster.
    const anchored = parseShot("d", "s", shotJson({
      anchors: [{ id: "first", file: "anchors/first.png", revision: 3, at: 0 }],
      board: { file: "board.png", revision: 1, prompt: "the doorway", refs: [], at: 1 },
    }))!;
    expect(shotThumbnail(anchored)).toEqual({ kind: "greybox", file: "greybox/greybox.mp4", rev: 2 });

    const blocked = parseShot("d", "s", shotJson())!;
    expect(shotThumbnail(blocked)).toEqual({ kind: "greybox", file: "greybox/greybox.mp4", rev: 2 });

    // No render yet, but somebody rendered a key frame from an earlier one:
    // that still stands in rather than a grey card.
    const stillOnly = parseShot("d", "s", shotJson({
      greybox: { revision: 1, script: "greybox/scene.py", preview: null, final: null },
      anchors: [{ id: "first", file: "anchors/first.png", revision: 3, at: 0 }],
    }))!;
    expect(shotThumbnail(stillOnly)).toEqual({ kind: "anchor", file: "anchors/first.png", rev: 3 });

    // Not rendered yet: the contact sheet, then the legacy board, then a
    // grey card — `none` is a state, not a missing case.
    const unrendered = parseShot("d", "s", shotJson({
      greybox: { revision: 1, script: "greybox/scene.py", preview: null, final: null, sheet: "greybox/sheet.png" },
    }))!;
    expect(shotThumbnail(unrendered)).toEqual({ kind: "sheet", file: "greybox/sheet.png", rev: 1 });

    const legacy = parseShot("d", "s", shotJson({
      greybox: { revision: 0, script: "greybox/scene.py", preview: null, final: null },
      board: { file: "board.png", revision: 2, prompt: "the doorway", refs: [], at: 1 },
    }))!;
    expect(shotThumbnail(legacy)).toEqual({ kind: "board", file: "board.png", rev: 2 });

    const nothing = parseShot("d", "s", shotJson({
      greybox: { revision: 0, script: "greybox/scene.py", preview: null, final: null },
      takes: [],
    }))!;
    expect(shotThumbnail(nothing)).toEqual({ kind: "none", file: null, rev: 0 });
  });

  /**
   * `greybox.sheet` is where a render WILL write its contact sheet — the
   * scaffold names the path before anything is rendered, and `previz.mjs
   * render` is the only writer of both the file and `greybox.revision`. A
   * free shot is never rendered, so its sheet path names a file that does
   * not exist; pointing an <img> at it drew a black box on every card
   * (2026-09-24, the 23-shot tanka-launch film).
   */
  test("a sheet path is only a picture once a render wrote it; a free shot shows its take", () => {
    const scaffolded = {
      revision: 0,
      script: "greybox/scene.py",
      preview: null,
      final: null,
      sheet: "greybox/sheet.png",
    };
    const freeWithTake = parseShot("d", "s", shotJson({ conditioning: "free", greybox: scaffolded }))!;
    // The take is the shot's own picture, cache-busted like the take lane.
    expect(shotThumbnail(freeWithTake)).toEqual({ kind: "take", file: "takes/take-01.mp4", rev: 2 });
    expect(shotPictures(freeWithTake).map((p) => p.kind)).toEqual(["take"]);

    const freeNoTake = parseShot("d", "s", shotJson({ conditioning: "free", greybox: scaffolded, takes: [] }))!;
    expect(shotThumbnail(freeNoTake)).toEqual({ kind: "none", file: null, rev: 0 });

    // Only a finished take has bytes: a submitted or failed one is skipped.
    const pending = parseShot("d", "s", shotJson({
      greybox: scaffolded,
      takes: [{ id: "take-01", status: "submitted", file: null, selected: true }],
    }))!;
    expect(shotThumbnail(pending).kind).toBe("none");

    // A preview render wrote the sheet (and bumped the revision): it leads,
    // and the take stays behind it as the fallback when the sheet is gone.
    const previewOnly = parseShot("d", "s", shotJson({
      greybox: {
        ...scaffolded,
        revision: 1,
        preview: { file: "greybox/preview.mp4", revision: 1, renderedAt: 1, renderSeconds: 3 },
      },
    }))!;
    expect(shotPictures(previewOnly)).toEqual([
      { kind: "sheet", file: "greybox/sheet.png", rev: 1 },
      { kind: "take", file: "takes/take-01.mp4", rev: 2 },
    ]);
  });

  test("a recreate shot's reference clip stands in until the greybox is rendered", () => {
    const reference = { file: "reference/segment.mp4", sourceName: "src.mp4", in: 1, out: 9, cuts: [] };
    const recreate = parseShot("d", "s", shotJson({
      reference,
      greybox: { revision: 0, script: "greybox/scene.py", preview: null, final: null, sheet: "greybox/sheet.png" },
      takes: [],
    }))!;
    expect(shotThumbnail(recreate)).toEqual({ kind: "reference", file: "reference/segment.mp4", rev: 0 });
    // The greybox still wins once it exists.
    expect(shotThumbnail(parseShot("d", "s", shotJson({ reference }))!).kind).toBe("greybox");
  });
});

describe("time_warp", () => {
  const meta = (extra: Record<string, unknown>) =>
    parseSceneMeta(JSON.stringify({ fps: 24, frames: 192, seconds: 8, ...extra }))!;

  test("the tempo spans are read and ordered", () => {
    expect(
      meta({
        time_warp: [
          { from: 5.5, to: 6.5, factor: 0.5 },
          { from: 1, to: 2, factor: 2 },
        ],
      }).timeWarp,
    ).toEqual([
      { from: 1, to: 2, factor: 2 },
      { from: 5.5, to: 6.5, factor: 0.5 },
    ]);
  });

  test("a zero factor, a negative one and an empty span are broken records, not tempos", () => {
    expect(
      meta({
        time_warp: [
          { from: 1, to: 2, factor: 0 },
          { from: 1, to: 2, factor: -0.5 },
          { from: 2, to: 2, factor: 0.5 },
          { from: 3, to: 2, factor: 0.5 },
          { from: 1, factor: 0.5 },
          "nope",
        ],
      }).timeWarp,
    ).toEqual([]);
  });

  test("a scene rendered before slowmo existed has no tempo row", () => {
    expect(meta({}).timeWarp).toEqual([]);
    expect(meta({ time_warp: "half" }).timeWarp).toEqual([]);
  });
});

describe("cutPoints", () => {
  const CONTINUITY_EDL = JSON.stringify({
    version: 1,
    kind: "final",
    file: "final.mp4",
    seconds: 16,
    segments: [
      { shot: "lab-walk", source: "take-01", offset: 0, seconds: 8 },
      { shot: "corridor", source: "take-02", offset: 8, seconds: 8 },
    ],
  });

  const filesWith = (corridorExtra: Record<string, unknown>): File[] => [
    { path: "one-inch-of-wind/backlot.json", content: FILM_MANIFEST() },
    { path: "one-inch-of-wind/shots/lab-walk/shot.json", content: FILM_SHOT("lab-walk") },
    {
      path: "one-inch-of-wind/shots/corridor/shot.json",
      content: FILM_SHOT("corridor", {
        takes: [
          { id: "take-02", status: "done", file: "takes/take-02.mp4", selected: true },
        ],
        ...corridorExtra,
      }),
    },
    { path: "one-inch-of-wind/cut/edl.json", content: CONTINUITY_EDL },
  ];

  const HANDOFF = {
    continuity: { from: "lab-walk", entry: "hand still on the door", exit: "hand off the door" },
    checks: [
      {
        id: "take-handoff",
        label: "First frame continues the previous shot's last used frame",
        target: "take-02",
        status: "pass",
        note: "same hand, same door",
      },
    ],
  };

  test("one point per boundary, with both sides resolved", () => {
    const project = filmProject(filesWith(HANDOFF));
    const points = cutPoints(project, project.cut);
    expect(points).toHaveLength(1);
    const [point] = points;
    expect(point.index).toBe(0);
    expect(point.fromShot?.id).toBe("lab-walk");
    expect(point.toShot?.id).toBe("corridor");
    expect(point.fromTake?.id).toBe("take-01");
    expect(point.toTake?.id).toBe("take-02");
    // The boundary on the CUT's clock, and the last frame INSIDE the
    // outgoing source: `seconds` itself is one frame past the end.
    expect(point.at).toBe(8);
    expect(point.outTime).toBeCloseTo(8 - 1 / 24, 5);
    expect(point.inTime).toBe(0);
  });

  test("a declared hand-off carries its verdict; anything else is a plain cut", () => {
    const declared = cutPoints(
      filmProject(filesWith(HANDOFF)),
      filmProject(filesWith(HANDOFF)).cut,
    )[0];
    expect(declared.continuity).toBe(true);
    expect(declared.handoffCheck?.status).toBe("pass");

    // No declaration: a cut, and NO judgement — most cuts exist to break
    // continuity, so an absent hand-off is never reported as unverified.
    const plainFiles = filesWith({});
    const plain = cutPoints(filmProject(plainFiles), filmProject(plainFiles).cut)[0];
    expect(plain.continuity).toBe(false);
    expect(plain.handoffCheck).toBeNull();
  });

  test("a hand-off that names the WRONG shot is not continuous here", () => {
    // The declaration is about `s99`; the frame before this one is
    // `lab-walk`. What the audience sees is a cut, and so is the badge.
    const files = filesWith({ ...HANDOFF, continuity: { from: "s99", entry: "x", exit: "y" } });
    const point = cutPoints(filmProject(files), filmProject(files).cut)[0];
    expect(point.continuity).toBe(false);
  });

  test("the verdict comes from the take the segment PLAYS, not from any take", () => {
    // A pass recorded on take-01 says nothing about the take-02 frame the
    // cut actually shows.
    const files = filesWith({
      ...HANDOFF,
      checks: [
        { id: "take-handoff", label: "x", target: "take-01", status: "pass" },
        { id: "take-handoff", label: "x", target: "take-02", status: "fail", note: "hand jumps" },
      ],
    });
    const point = cutPoints(filmProject(files), filmProject(files).cut)[0];
    expect(point.handoffCheck?.status).toBe("fail");
    expect(point.handoffCheck?.note).toBe("hand jumps");
  });

  test("a greybox stand-in has no take, and a one-shot cut has no joins", () => {
    const project = filmProject();
    const points = cutPoints(project, project.cut);
    expect(points).toHaveLength(1);
    expect(points[0].toTake).toBeNull();
    expect(points[0].continuity).toBe(false);
    expect(cutPoints(project, null)).toEqual([]);
    expect(
      cutPoints(project, {
        ...project.cut!,
        segments: [project.cut!.segments[0]],
      }),
    ).toEqual([]);
  });

  test("a segment naming a shot the film no longer has is still a boundary", () => {
    const project = filmProject();
    const points = cutPoints(project, {
      ...project.cut!,
      segments: [
        { shot: "deleted", source: "take-01", offset: 0, seconds: 4 },
        { shot: "corridor", source: "greybox", offset: 4, seconds: 4 },
      ],
    });
    expect(points[0].fromShot).toBeNull();
    expect(points[0].continuity).toBe(false);
    // Still 24 fps: the fallback clock, not a crash and not a NaN.
    expect(points[0].outTime).toBeCloseTo(4 - 1 / 24, 5);
  });
});

describe("stage state", () => {
  test("an empty stage is empty, a written one is a draft", () => {
    const project = filmProject();
    const status = Object.fromEntries(project.stages.map((s) => [s.id, s.status]));
    expect(status).toEqual({
      idea: "draft",
      script: "draft",
      bible: "draft",
      boards: "draft",
      previz: "draft",
      takes: "draft",
      sound: "draft",
      cut: "draft",
    });
  });

  test("an approval whose hash matches is APPROVED; one that does not is CHANGED", () => {
    // The hash is computed by the module `backlot.mjs` gates its spending
    // with, over the SAME project-relative map `loadFilm` builds — this is
    // the test that the viewer's prefix stripping agrees with the script.
    const texts = textsOf(FILM_FILES, "one-inch-of-wind");
    const files: File[] = [
      {
        path: "one-inch-of-wind/backlot.json",
        content: FILM_MANIFEST({
          approvals: {
            script: { at: 1758380000000, hash: hashStage("script", { ...texts, "backlot.json": FILM_MANIFEST() }) },
            idea: { at: 1758370000000, hash: "deadbeef" },
          },
        }),
      },
      ...FILM_FILES.slice(1),
    ];
    // `script` hashes the screenplay plus the manifest's scenes, and the
    // manifest text changes when approvals are added — so the hash is taken
    // against the manifest WITHOUT them, exactly as `stage-state.mjs`
    // projects it (only `scenes` enter the script hash).
    const project = loadFilm(files)!.projects["one-inch-of-wind"];
    const status = Object.fromEntries(project.stages.map((s) => [s.id, s.status]));
    expect(status.script).toBe("approved");
    expect(status.idea).toBe("changed");
    expect(project.approvals.script?.at).toBe(1758380000000);
    expect(project.stages.find((s) => s.id === "script")?.approvedAt).toBe(1758380000000);
    expect(project.stages.find((s) => s.id === "bible")?.approvedAt).toBeNull();
  });

  test("the next open stage is the first one the creator has not approved", () => {
    const texts = textsOf(FILM_FILES, "one-inch-of-wind");
    const approvals = {
      idea: { at: 1, hash: hashStage("idea", texts) },
      script: { at: 2, hash: hashStage("script", texts) },
    };
    const files: File[] = [
      { path: "one-inch-of-wind/backlot.json", content: FILM_MANIFEST({ approvals }) },
      ...FILM_FILES.slice(1),
    ];
    const project = loadFilm(files)!.projects["one-inch-of-wind"];
    // `script` hashes `backlot.json#scenes`, which does not change when
    // approvals are added, so both approvals still hold.
    expect(project.stages.find((s) => s.id === "idea")?.status).toBe("approved");
    expect(nextOpenStage(project)?.id).toBe("bible");
  });

  test("a changed stage is open again — the creator has not seen this version", () => {
    const texts = textsOf(FILM_FILES, "one-inch-of-wind");
    const files: File[] = [
      {
        path: "one-inch-of-wind/backlot.json",
        content: FILM_MANIFEST({ approvals: { idea: { at: 1, hash: hashStage("idea", texts) } } }),
      },
      ...FILM_FILES.slice(1).filter((f) => !f.path.endsWith("idea.md")),
      { path: "one-inch-of-wind/idea.md", content: "# One Inch of Wind\n\nRewritten after approval.\n" },
    ];
    const project = loadFilm(files)!.projects["one-inch-of-wind"];
    expect(project.stages.find((s) => s.id === "idea")?.status).toBe("changed");
    expect(nextOpenStage(project)?.id).toBe("idea");
  });

  test("stage labels exist in both languages, and the Chinese is film-crew Chinese", () => {
    expect(stageLabel("previz")).toBe("Previz");
    expect(stageLabel("previz", "zh")).toBe("白模");
    expect(stageLabel("cut", "zh")).toBe("成片");
  });
});

describe("cost", () => {
  test("every paid record is aggregated to the stage that spent it", () => {
    const project = filmProject();
    const byStage = Object.fromEntries(project.stages.map((s) => [s.id, s.usd]));
    // bible: sheet 0.13 + voice 0.01 + concept 0.12
    expect(byStage.bible).toBeCloseTo(0.26, 5);
    // boards: two board frames at 0.11
    expect(byStage.boards).toBeCloseTo(0.22, 5);
    // takes: one take
    expect(byStage.takes).toBeCloseTo(2.12, 5);
    // sound: two vo lines at 0.02 + the music
    expect(byStage.sound).toBeCloseTo(0.44, 5);
    expect(byStage.idea).toBe(0);
    expect(byStage.previz).toBe(0);
  });

  test("a cost line names what it paid for and how the figure was got", () => {
    // The lines come from `skill/scripts/cost.mjs`, the module `backlot.mjs
    // cost` prints from — the viewer must not keep a second opinion about
    // money. Refs are project-relative, as that module writes them.
    const project = filmProject();
    const take = project.cost.find((line) => line.kind === "take")!;
    expect(take).toMatchObject({
      stage: "takes",
      source: "table",
      usd: 2.12,
      ref: "shots/lab-walk/takes/take-01.mp4",
      at: 1758375000000,
    });
    const sheet = project.cost.find((line) => line.ref.endsWith("sheet.png"))!;
    expect(sheet).toMatchObject({ stage: "bible", kind: "image", source: "reported" });
    const music = project.cost.find((line) => line.kind === "music")!;
    expect(music.ref).toBe("sound/music.mp3");
  });

  test("the lines come back in stage order — the order the money was spent in", () => {
    const stages = filmProject().cost.map((line) => line.stage);
    expect(stages).toEqual([...stages].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
  });

  test("a take with no recorded price is LISTED unpriced, never counted", () => {
    // Paid work is recorded before the request leaves (invariant 6), so a
    // take whose price nobody wrote down still has to appear — as a dash.
    // Inventing a number for it is the one thing a bill must not do.
    const project = filmProject([
      ...FILM_FILES.filter((f) => !f.path.includes("shots/lab-walk")),
      {
        path: "one-inch-of-wind/shots/lab-walk/shot.json",
        content: FILM_SHOT("lab-walk", {
          takes: [{ id: "take-01", status: "done", file: "takes/take-01.mp4" }],
        }),
      },
    ]);
    expect(project.stages.find((s) => s.id === "takes")?.usd).toBe(0);
    const take = project.cost.find((line) => line.kind === "take")!;
    expect(take.usd).toBeNull();
    expect(take.source).toBeNull();
  });
});

const ORDER = ["idea", "script", "bible", "boards", "previz", "takes", "sound", "cut"];
