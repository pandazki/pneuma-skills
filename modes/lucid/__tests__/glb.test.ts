/**
 * glb.mjs — pinned as a real process, because that is how the agent calls it.
 *
 * Every fixture is a GLB written in code at test time by
 * `fixtures/glb/make-glb.mjs`; no binary blobs are committed. Each run gets a
 * fresh working directory and the script is invoked with RELATIVE paths from
 * it, which is the contract the skill relies on (the agent's cwd is the
 * workspace, and the script never changes directory).
 *
 * The warning codes are the interesting surface: each one has a fixture where
 * it must fire and a fixture where it must not, because a warning that is
 * always on is noise and a warning that never fires is absent.
 *
 * `resize` / `simplify` / `optimize` / `unpack` shell out to
 * `@gltf-transform/cli` through `npx`, which downloads on first use. Those
 * live in the live tier.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceLiveTierSkip, LIVE_TIER, LIVE_TIER_LABEL } from "../../../core/__tests__/test-tier.js";
import { buildGlb, gridMesh, thinPolePositions } from "./fixtures/glb/make-glb.mjs";
import type { BuildGlbOptions } from "./fixtures/glb/make-glb.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "glb.mjs");

announceLiveTierSkip("the real gltf-transform runs behind glb.mjs resize/simplify/optimize/unpack");

const workspaces: string[] = [];

function fresh(): string {
  // realpath: /var/folders/... is a symlink to /private/var/... on macOS, and
  // the script reports resolved paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lucid-glb-")));
  workspaces.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function run(cwd: string, ...argv: string[]): Run {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function runJson(cwd: string, ...argv: string[]): any {
  const result = run(cwd, ...argv, "--json");
  if (result.code !== 0) throw new Error(`glb.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

/** Build a fixture in a fresh workspace and inspect it, by relative name. */
function inspectFixture(name: string, options?: BuildGlbOptions): { report: any; dir: string } {
  const dir = fresh();
  buildGlb(join(dir, name), options);
  return { report: runJson(dir, "inspect", name), dir };
}

function codes(report: any): string[] {
  return report.warnings.map((warning: { code: string }) => warning.code);
}

// ---------------------------------------------------------------------------

describe("glb.mjs — plumbing", () => {
  test("--help prints the usage and exits 0", () => {
    const result = run(fresh(), "--help");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: glb.mjs <subcommand>");
    expect(result.out).toContain("thin-pole-height");
  });

  test("an unknown subcommand exits 1 and names the ones that exist", () => {
    const result = run(fresh(), "dezmate");
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown subcommand 'dezmate'");
    expect(result.err).toContain("inspect, resize, simplify, optimize, unpack, ratio-for");
  });

  test("a missing file is refused by name", () => {
    const result = run(fresh(), "inspect", "nope.glb");
    expect(result.code).toBe(1);
    expect(result.err).toContain("<glb> does not exist: nope.glb");
  });
});

describe("glb.mjs inspect — the container", () => {
  test("reads geometry, material, texture and bbox off a plain textured triangle", () => {
    const { report } = inspectFixture("base.glb");
    expect(report.ok).toBe(true);
    expect(report.meshes).toBe(1);
    expect(report.primitives).toBe(1);
    expect(report.triangles).toBe(1);
    expect(report.vertices).toBe(3);
    expect(report.nodes).toBe(1);
    expect(report.skins).toBe(0);
    expect(report.joints).toBe(0);
    expect(report.animations).toEqual([]);
    expect(report.materials.count).toBe(1);
    expect(report.materials.doubleSided).toBe(0);
    expect(report.materials.items[0].metallicFactor).toBe(0.1);
    expect(report.materials.items[0].roughnessFactor).toBe(0.6);
    expect(report.textures).toBe(1);
    expect(report.images).toHaveLength(1);
    expect(report.images[0]).toMatchObject({ mime: "image/png", width: 2, height: 2, source: "bufferView" });
    expect(report.bytes).toBeGreaterThan(0);
  });

  test("the bounding box is the accessor bounds carried through the node transform", () => {
    // The mesh spans (0,0,0)–(1,1,0); the node scales it by (2,3,1) and moves
    // it to x=5. Reading the accessor alone would report a unit triangle.
    const { report } = inspectFixture("base.glb");
    expect(report.bbox).toEqual({ min: [5, 0, 0], max: [7, 3, 0] });
    expect(report.size).toEqual([2, 3, 0]);
    expect(report.longestAxis).toBe("y");
    expect(report.longestEdge).toBe(3);
  });

  test("a node matrix is read column-major, like glTF writes it", () => {
    // Column-major translate(0, 10, 0) * scale(4): the last COLUMN is the
    // translation. A row-major reader would put the 10 on the x axis.
    const { report } = inspectFixture("matrix.glb", {
      node: { matrix: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 10, 0, 1] },
    });
    expect(report.bbox).toEqual({ min: [0, 10, 0], max: [4, 14, 0] });
  });

  test("a POSITION accessor with no min/max is measured from the vertices", () => {
    // Invalid glTF, and emitted by parts of the AI-asset chain anyway.
    // "bbox unavailable" would be a worse answer than a measured one.
    const { report } = inspectFixture("nobounds.glb", { omitBounds: true });
    expect(report.bbox).toEqual({ min: [5, 0, 0], max: [7, 3, 0] });
    expect(report.notes.join(" ")).toContain("declare no min/max");
  });

  test("an unindexed mesh counts triangles off POSITION", () => {
    const { report } = inspectFixture("unindexed.glb", { indexed: false });
    expect(report.triangles).toBe(1);
    expect(report.vertices).toBe(3);
  });

  test("a non-TRIANGLES primitive is reported, not counted", () => {
    const { report } = inspectFixture("strip.glb", { mode: 5 });
    expect(report.triangles).toBe(0);
    expect(report.otherModes).toEqual({ TRIANGLE_STRIP: 1 });
    expect(report.notes.join(" ")).toContain("1x TRIANGLE_STRIP");
  });

  test("animations report their channel count and duration; skins report joints", () => {
    const { report } = inspectFixture("rigged.glb", { skin: true, animation: true });
    expect(report.skins).toBe(1);
    expect(report.joints).toBe(1);
    expect(report.animations).toEqual([{ index: 0, name: "drift", channels: 1, duration: 1 }]);
    expect(report.notes.join(" ")).toContain("skinned mesh node");
  });

  test("image mime and pixel size come from the header bytes, per format", () => {
    const { report } = inspectFixture("images.glb", {
      images: [
        { kind: "jpeg", width: 640, height: 480 },
        { kind: "webp-vp8", width: 321, height: 123 },
        { kind: "webp-vp8l", width: 77, height: 55 },
        { kind: "webp-vp8x", width: 1000, height: 900 },
      ],
    });
    expect(report.images.map((image: any) => [image.mime, image.width, image.height])).toEqual([
      ["image/jpeg", 640, 480],
      ["image/webp", 321, 123],
      ["image/webp", 77, 55],
      ["image/webp", 1000, 900],
    ]);
    expect(report.textures).toBe(4);
  });

  test("the human report lists the warnings under a compact table", () => {
    const dir = fresh();
    buildGlb(join(dir, "double.glb"), { doubleSided: true });
    const result = run(dir, "inspect", "double.glb");
    expect(result.code).toBe(0);
    expect(result.out).toContain("geometry   1 tris / 3 verts");
    expect(result.out).toContain("! double-sided-all:");
  });
});

describe("glb.mjs inspect — normalized accessors", () => {
  test("a normalized SHORT position reads as 1.0, not as 32767", () => {
    const { report } = inspectFixture("quantized.glb", {
      positions: [[0, 0, 0], [0.5, 0, 0], [0, 1, 0]],
      positionEncoding: "int16n",
      node: { translation: [0, 0, 0] },
    });
    expect(report.bbox).toEqual({ min: [0, 0, 0], max: [0.5, 1, 0] });
    expect(report.longestEdge).toBe(1);
    // The raw accessor max is 32767; nothing in the report may carry it.
    expect(JSON.stringify(report.bbox)).not.toContain("32767");
  });

  test("the normalized rule also applies to the sampled vertex heights", () => {
    const pole = thinPolePositions({ bodyCount: 40, bodyHeight: 0.15, poleCount: 4, poleHeight: 1 });
    const { report } = inspectFixture("quantized-pole.glb", {
      positions: pole,
      positionEncoding: "int16n",
      node: { translation: [0, 0, 0] },
    });
    expect(report.heightProfile.total).toBeCloseTo(1, 3);
    expect(report.heightProfile.p90).toBeLessThan(0.2);
  });
});

describe("glb.mjs inspect — warnings fire exactly when intended", () => {
  test("double-sided-all: every material, and not one of two", () => {
    expect(codes(inspectFixture("all.glb", { doubleSided: true }).report)).toContain("double-sided-all");
    expect(codes(inspectFixture("none.glb", { doubleSided: false }).report)).not.toContain("double-sided-all");
  });

  test("texture-over-2048: per image, with its index", () => {
    const { report } = inspectFixture("big.glb", {
      images: [
        { kind: "png", width: 2, height: 2 },
        { kind: "gray-png", width: 4096, height: 4096 },
      ],
    });
    const hits = report.warnings.filter((warning: any) => warning.code === "texture-over-2048");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ image: 1, width: 4096, height: 4096 });
    expect(codes(inspectFixture("small.glb").report)).not.toContain("texture-over-2048");
  });

  test("needs-decoder: only when the extension is REQUIRED", () => {
    for (const extension of ["EXT_meshopt_compression", "KHR_draco_mesh_compression"]) {
      const { report } = inspectFixture("packed.glb", {
        extensionsUsed: [extension],
        extensionsRequired: [extension],
      });
      expect(codes(report)).toContain("needs-decoder");
      expect(report.warnings.find((w: any) => w.code === "needs-decoder").extensions).toEqual([extension]);
    }
    // Declared as used but not required: a decoder is optional, so is the alarm.
    const optional = inspectFixture("optional.glb", { extensionsUsed: ["EXT_meshopt_compression"] }).report;
    expect(codes(optional)).not.toContain("needs-decoder");
  });

  test("quantized: informational, on extensionsUsed", () => {
    const { report } = inspectFixture("q.glb", { extensionsUsed: ["KHR_mesh_quantization"] });
    expect(codes(report)).toContain("quantized");
    expect(codes(inspectFixture("plain.glb").report)).not.toContain("quantized");
  });

  test("no-uv and no-materials are independent", () => {
    expect(codes(inspectFixture("nouv.glb", { uv: false }).report)).toContain("no-uv");
    expect(codes(inspectFixture("nouv.glb", { uv: false }).report)).not.toContain("no-materials");
    expect(codes(inspectFixture("nomat.glb", { material: false, images: [] }).report)).toContain("no-materials");
    expect(codes(inspectFixture("nomat.glb", { material: false, images: [] }).report)).not.toContain("no-uv");
    expect(codes(inspectFixture("both.glb").report)).not.toContain("no-uv");
  });

  test("thin-pole-height: a body under a pole, and not a solid shape", () => {
    const pole = inspectFixture("pole.glb", {
      positions: thinPolePositions(),
      node: { translation: [0, 0, 0] },
    }).report;
    expect(codes(pole)).toContain("thin-pole-height");
    expect(pole.heightProfile.p90).toBeLessThan(0.7 * pole.heightProfile.total);

    const solid = inspectFixture("solid.glb", {
      positions: gridMesh({ segments: 6, amplitude: 1 }).positions.map(([x, y, z]) => [x, (y + 1) / 2 + 0.5, z]),
      node: { translation: [0, 0, 0] },
    }).report;
    expect(codes(solid)).not.toContain("thin-pole-height");
  });

  test("thin-pole-height needs a distribution, not three vertices", () => {
    const { report } = inspectFixture("tiny.glb");
    expect(report.heightProfile).toBeNull();
    expect(codes(report)).not.toContain("thin-pole-height");
  });

  test("unit-normalized: a longest edge of 1.0, within tolerance", () => {
    const unit = inspectFixture("unit.glb", {
      positions: [[0, 0, 0], [1, 0, 0], [0, 0.4, 0]],
      node: { translation: [0, 0, 0] },
    }).report;
    expect(codes(unit)).toContain("unit-normalized");

    const scaled = inspectFixture("scaled.glb", {
      positions: [[0, 0, 0], [1.2, 0, 0], [0, 0.4, 0]],
      node: { translation: [0, 0, 0] },
    }).report;
    expect(codes(scaled)).not.toContain("unit-normalized");
  });

  test("a healthy model warns about nothing", () => {
    const { report } = inspectFixture("clean.glb");
    expect(report.warnings).toEqual([]);
  });
});

describe("glb.mjs inspect — refusals are legible", () => {
  test("a text file is named for what it is", () => {
    const dir = fresh();
    writeFileSync(join(dir, "notes.txt"), "this is not a model\n");
    const result = run(dir, "inspect", "notes.txt");
    expect(result.code).toBe(1);
    expect(result.err).toContain("does not start with the GLB magic 'glTF'");
  });

  test("a .gltf JSON document is told how to become a .glb", () => {
    const dir = fresh();
    writeFileSync(join(dir, "scene.gltf"), JSON.stringify({ asset: { version: "2.0" } }));
    const result = run(dir, "inspect", "scene.gltf");
    expect(result.code).toBe(1);
    expect(result.err).toContain("this is a .gltf document, not a .glb container");
  });

  test("a glTF 1.0 container is refused by version", () => {
    const dir = fresh();
    buildGlb(join(dir, "old.glb"));
    const bytes = readFileSync(join(dir, "old.glb"));
    bytes.writeUInt32LE(1, 4);
    writeFileSync(join(dir, "old.glb"), bytes);
    const result = run(dir, "inspect", "old.glb");
    expect(result.code).toBe(1);
    expect(result.err).toContain("is GLB version 1; only glTF 2.0");
  });

  test("a truncated container says it is truncated", () => {
    const dir = fresh();
    buildGlb(join(dir, "cut.glb"));
    const bytes = readFileSync(join(dir, "cut.glb"));
    writeFileSync(join(dir, "cut.glb"), bytes.subarray(0, bytes.length - 200));
    const result = run(dir, "inspect", "cut.glb");
    expect(result.code).toBe(1);
    expect(result.err).toContain("truncated");
  });
});

describe("glb.mjs ratio-for", () => {
  test("every role has a ratio and a reason", () => {
    const dir = fresh();
    for (const role of ["character", "vehicle", "prop", "building", "environment", "vegetation"]) {
      const payload = runJson(dir, "ratio-for", "--role", role);
      expect(payload.role).toBe(role);
      expect(payload.ratio).toBeGreaterThan(0);
      expect(payload.ratio).toBeLessThanOrEqual(1);
      expect(payload.reason.length).toBeGreaterThan(20);
    }
  });

  test("open lattices are treated more gently than smooth surfaces", () => {
    const dir = fresh();
    const vegetation = runJson(dir, "ratio-for", "--role", "vegetation").ratio;
    const character = runJson(dir, "ratio-for", "--role", "character").ratio;
    const building = runJson(dir, "ratio-for", "--role", "building").ratio;
    expect(vegetation).toBeGreaterThan(building);
    expect(building).toBeGreaterThan(character);
  });

  test("an unknown role lists the known ones", () => {
    const result = run(fresh(), "ratio-for", "--role", "spaceship");
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown --role 'spaceship'");
    expect(result.err).toContain("character, vehicle, prop, building, environment, vegetation");
  });
});

describe(`glb.mjs — gltf-transform wrappers ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!LIVE_TIER)("resize shrinks the texture and says so", () => {
    const dir = fresh();
    buildGlb(join(dir, "in.glb"), {
      images: [{ kind: "png", width: 2048, height: 2048 }],
    });
    const payload = runJson(dir, "resize", "in.glb", "out.glb", "--size", "256");
    expect(payload.ok).toBe(true);
    expect(payload.before.largestTexture).toBe("2048x2048");
    expect(payload.after.largestTexture).toBe("256x256");
    expect(payload.after.bytes).toBeLessThan(payload.before.bytes);
  }, 180_000);

  test.skipIf(!LIVE_TIER)("simplify reduces a welded grid and reports the drop", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 24 });
    buildGlb(join(dir, "grid.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });
    const payload = runJson(dir, "simplify", "grid.glb", "lo.glb", "--ratio", "0.25");
    expect(payload.before.triangles).toBe(1152);
    expect(payload.after.triangles).toBeLessThan(payload.before.triangles);
    expect(payload.floored).toBe(false);
  }, 180_000);

  test.skipIf(!LIVE_TIER)("simplify reports a geometry that did not reduce as a state, not a failure", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 24 });
    buildGlb(join(dir, "grid.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });
    const result = run(dir, "simplify", "grid.glb", "same.glb", "--ratio", "1");
    expect(result.code).toBe(0);
    expect(result.out).toContain("the geometry did not reduce");
    const payload = runJson(dir, "simplify", "grid.glb", "same2.glb", "--ratio", "1");
    expect(payload.floored).toBe(true);
    expect(payload.after.triangles).toBe(payload.before.triangles);
  }, 180_000);

  test.skipIf(!LIVE_TIER)("optimize quantizes without requiring a runtime decoder", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 24 });
    buildGlb(join(dir, "grid.glb"), {
      positions: grid.positions,
      indices: grid.indices,
      node: { translation: [0, 0, 0] },
      images: [{ kind: "png", width: 1024, height: 1024 }],
    });
    const payload = runJson(dir, "optimize", "grid.glb", "opt.glb", "--texture-size", "256", "--simplify-ratio", "0.3");
    expect(payload.after.bytes).toBeLessThan(payload.before.bytes);
    expect(payload.after.triangles).toBeLessThan(payload.before.triangles);
    // Quantization is the point: draco/meshopt would put a decoder between
    // the scene and its own geometry.
    const after = runJson(dir, "inspect", "opt.glb");
    expect(after.extensionsRequired).toEqual(["KHR_mesh_quantization"]);
    expect(after.extensionsRequired).not.toContain("EXT_meshopt_compression");
  }, 180_000);

  test.skipIf(!LIVE_TIER)("unpack leaves a file Blender can import", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 12 });
    buildGlb(join(dir, "grid.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });
    // meshopt in, plain buffers out.
    runJson(dir, "optimize", "grid.glb", "packed.glb", "--texture-size", "256");
    const payload = runJson(dir, "unpack", "packed.glb", "plain.glb");
    expect(payload.ok).toBe(true);
    expect(payload.extensionsRequiredAfter).not.toContain("EXT_meshopt_compression");
    expect(runJson(dir, "inspect", "plain.glb").triangles).toBe(288);
  }, 180_000);
});
