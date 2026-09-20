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
  frameAt,
  loadFilm,
  parseSceneMeta,
  parseShot,
  projectDirOf,
  saveFilm,
  selectedTake,
  shotDir,
  shotRefOf,
  shotStages,
} from "../domain.js";

type File = { path: string; content: string };

const PREVIZ_JSON = JSON.stringify({
  version: 1,
  title: "First Light",
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
  { path: "first-light/previz.json", content: PREVIZ_JSON },
  { path: "first-light/shots/lab-walk/shot.json", content: shotJson() },
];

describe("paths", () => {
  test("a project is a top-level directory holding previz.json", () => {
    expect(projectDirOf("first-light/previz.json")).toBe("first-light");
    expect(projectDirOf("previz.json")).toBe("");
    // Nested and dot directories are not content sets, so they cannot be a
    // project: the resolver would never offer them and every /content URL
    // built from one would 404.
    expect(projectDirOf("a/b/previz.json")).toBeNull();
    expect(projectDirOf(".pneuma/previz.json")).toBeNull();
    expect(projectDirOf("first-light/shot.json")).toBeNull();
  });

  test("a shot is `<project>/shots/<id>/shot.json`", () => {
    expect(shotRefOf("first-light/shots/lab-walk/shot.json")).toEqual({
      project: "first-light",
      shot: "lab-walk",
    });
    expect(shotRefOf("shots/lab-walk/shot.json")).toEqual({ project: "", shot: "lab-walk" });
    expect(shotRefOf("first-light/shots/lab-walk/takes/shot.json")).toBeNull();
    expect(shotRefOf("first-light/shot.json")).toBeNull();
  });

  test("shotDir composes the same path back", () => {
    expect(shotDir("first-light", "lab-walk")).toBe("first-light/shots/lab-walk");
    expect(shotDir("", "lab-walk")).toBe("shots/lab-walk");
  });
});

describe("parseShot", () => {
  test("reads the whole record", () => {
    const shot = parseShot("first-light/shots/lab-walk", "lab-walk", shotJson())!;
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
    expect(Object.keys(film.projects)).toEqual(["first-light"]);
    expect(film.projects["first-light"].title).toBe("First Light");
    expect(film.projects["first-light"].shots.map((s) => s.id)).toEqual(["lab-walk"]);
  });

  test("shots come back in previz.json order, strays last", () => {
    const film = loadFilm([
      ...BASE_FILES,
      { path: "first-light/shots/zeta/shot.json", content: shotJson({ id: "zeta" }) },
      { path: "first-light/shots/corridor/shot.json", content: shotJson({ id: "corridor" }) },
    ])!;
    expect(film.projects["first-light"].shots.map((s) => s.id)).toEqual([
      "lab-walk",
      "corridor",
      "zeta",
    ]);
  });

  test("a listed shot with no shot.json is a named warning", () => {
    const film = loadFilm(BASE_FILES)!;
    expect(film.projects["first-light"].warnings.join(" ")).toContain("corridor");
  });

  test("one broken shot does not blank its siblings", () => {
    const film = loadFilm([
      ...BASE_FILES,
      { path: "first-light/shots/broken/shot.json", content: "{ oh no" },
    ])!;
    expect(film.projects["first-light"].shots.map((s) => s.id)).toEqual(["lab-walk"]);
  });

  test("a half-written previz.json still names the project and keeps its shots", () => {
    const film = loadFilm([
      { path: "first-light/previz.json", content: '{ "title": "First' },
      BASE_FILES[1],
    ])!;
    expect(film.projects["first-light"].shots).toHaveLength(1);
    expect(film.projects["first-light"].warnings.join(" ")).toContain("previz.json");
  });

  test("a shot whose project manifest is absent is skipped, not orphaned", () => {
    const film = loadFilm([BASE_FILES[1]])!;
    expect(film.projects).toEqual({});
  });

  test("the viewer cannot write — previz.json belongs to the script", () => {
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
      { id: "push", label: "", from: 0, to: 8, kind: "camera" as const, causedBy: null },
      { id: "walk", label: "", from: 1, to: 2, kind: "action" as const, causedBy: null },
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

  test("a file without fps or frames is not a scene meta", () => {
    expect(parseSceneMeta(JSON.stringify({ camera: "cam" }))).toBeNull();
    expect(parseSceneMeta("not json")).toBeNull();
  });
});
