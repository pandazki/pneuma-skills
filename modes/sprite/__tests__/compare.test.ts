import { describe, test, expect } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadFinalArtifact,
  compareFinalArtifacts,
  runCompare,
  type CompareCodecs,
} from "../skill/scripts/compare.mjs";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = (value = 255) => ({
  width: 1,
  height: 1,
  data: Buffer.from([value, 0, 0, 255]),
});
function fixture(fn: (root: string, codecs: CompareCodecs) => void) {
  const root = mkdtempSync(join(tmpdir(), "sprite-compare-test-"));
  const codecs: CompareCodecs = {
    readRgba: (p) => image(readFileSync(p).at(-1)),
    writeRgbaPng: (p, i) => writeFileSync(p, i.data),
    decodeGifFrames: () => {
      throw Error("not used");
    },
  };
  try {
    fn(root, codecs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const png = (root: string, name: string, value = 255) => {
  const p = join(root, name);
  writeFileSync(p, Buffer.concat([signature, Buffer.from([value])]));
  return p;
};
const atlas = (root: string, extra: Record<string, unknown> = {}) => {
  const p = join(root, "atlas.json");
  writeFileSync(
    p,
    JSON.stringify({
      meta: {
        app: "pneuma-sprite",
        image: "sheet.png",
        size: { w: 1, h: 1 },
        loop: true,
      },
      animations: { idle: ["idle_00"] },
      frames: {
        idle_00: {
          frame: { x: 0, y: 0, w: 1, h: 1 },
          rotated: false,
          trimmed: false,
          sourceSize: { w: 1, h: 1 },
          spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 },
          pivot: { x: 0.5, y: 1 },
          duration: 100,
          ...extra,
        },
      },
    }),
  );
  return p;
};
describe("final artifact comparison", () => {
  test("different encoding with same pixels is identical and binds both file hashes", () =>
    fixture((r, c) => {
      const a = png(r, "a.png"),
        b = png(r, "b.png");
      writeFileSync(b, Buffer.concat([signature, Buffer.from([0, 255])]));
      const report = runCompare(
        { baseline: a, candidate: b, out: join(r, "evidence") },
        c,
      );
      expect(report.status).toBe("identical");
      expect(report.inputs!.baseline.files[0]!.sha256).not.toBe(
        report.inputs!.candidate.files[0]!.sha256,
      );
      expect(existsSync(join(r, "evidence", "difference.png"))).toBe(true);
    }));
  test("reads final atlas pixels despite stale inspect and frame files", () =>
    fixture((r, c) => {
      const sheet = png(r, "sheet.png");
      const path = atlas(r);
      writeFileSync(join(r, "inspect.json"), "{}");
      const a = loadFinalArtifact(path, c);
      png(r, "sheet.png", 0);
      const b = loadFinalArtifact(path, c);
      expect(compareFinalArtifacts(a, b).changedProtectedProperties).toContain(
        "pixels",
      );
      expect(a.files.length).toBe(2);
      expect(readFileSync(sheet).at(-1)).toBe(0);
    }));
  test("refuses missing timing, bad rects and escaping references", () =>
    fixture((r, c) => {
      png(r, "sheet.png");
      expect(() => loadFinalArtifact(atlas(r, { duration: null }), c)).toThrow(
        "duration",
      );
      expect(() =>
        loadFinalArtifact(atlas(r, { frame: { x: 1, y: 0, w: 1, h: 1 } }), c),
      ).toThrow("rectangle");
      const p = atlas(r);
      const doc = JSON.parse(readFileSync(p, "utf8"));
      doc.meta.image = "../escape.png";
      writeFileSync(p, JSON.stringify(doc));
      expect(() => loadFinalArtifact(p, c)).toThrow();
    }));
  test("timing and frame loss remain unknown, frozen pixels never improve quality", () =>
    fixture((r, c) => {
      const a = loadFinalArtifact(png(r, "a.png"), c);
      const b = { ...a, frames: [image(0)] };
      expect(compareFinalArtifacts(a, b).improvement).toBe("unknown");
      expect(compareFinalArtifacts(a, { ...b, durationsMs: [90] }).status).toBe(
        "unknown",
      );
      expect(
        compareFinalArtifacts(a, { ...b, frames: [] })
          .changedProtectedProperties,
      ).toContain("geometry");
    }));
  test("cleanup proof is recomputed and distinguishes no-op and violation", () =>
    fixture((r, c) => {
      const a = loadFinalArtifact(png(r, "a.png"), c),
        params = { maxAlpha: 15, keepEdge: 2 };
      const cleanAlphaHaze = () => ({ image: image(0), report: {} });
      expect(
        compareFinalArtifacts(
          a,
          { ...a, frames: [image(0)] },
          { alphaClean: params, cleanAlphaHaze },
        ).alphaClean.status,
      ).toBe("verified");
      expect(
        compareFinalArtifacts(a, a, { alphaClean: params, cleanAlphaHaze })
          .alphaClean.status,
      ).toBe("violated");
      expect(
        compareFinalArtifacts(a, a, {
          alphaClean: params,
          cleanAlphaHaze: (f) => ({ image: f, report: {} }),
        }).alphaClean.status,
      ).toBe("no-op");
    }));
  test("rejects decode-time mutation with input digest and no partial output", () =>
    fixture((r, c) => {
      const a = png(r, "a.png"),
        b = png(r, "b.png");
      const original = c.readRgba;
      c.readRgba = (p) => {
        const im = original(p);
        writeFileSync(p, Buffer.from("changed"));
        return im;
      };
      let failure: any;
      try {
        runCompare({ baseline: a, candidate: b, out: join(r, "out") }, c);
      } catch (e) {
        failure = e;
      }
      expect(failure.message).toContain("changed");
      expect(failure.inputs[0].sha256).toHaveLength(64);
      expect(existsSync(join(r, "out"))).toBe(false);
    }));
  test("GIF preserves unequal real delays and refuses fallback timing", () =>
    fixture((r, c) => {
      const path = join(r, "motion.gif");
      const header = Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0]);
      const frame = (delay: number) =>
        Buffer.from([
          0x21,
          0xf9,
          4,
          0,
          delay,
          0,
          0,
          0,
          0x2c,
          0,
          0,
          0,
          0,
          1,
          0,
          1,
          0,
          0,
          2,
          1,
          0,
          0,
        ]);
      writeFileSync(
        path,
        Buffer.concat([header, frame(9), frame(17), Buffer.from([0x3b])]),
      );
      c.decodeGifFrames = (_p, out) => {
        png(out, "00.png");
        png(out, "01.png");
        return { delaysMs: [90, 170] };
      };
      const a = loadFinalArtifact(path, c);
      expect(a.durationsMs).toEqual([90, 170]);
      expect(a.loop).toEqual({ plays: 1 });
      const b = { ...a, durationsMs: [130, 130] };
      expect(compareFinalArtifacts(a, b).status).toBe("unknown");
      c.decodeGifFrames = (_p, out) => {
        png(out, "00.png");
        png(out, "01.png");
        return { delaysMs: [90, 90] };
      };
      expect(() => loadFinalArtifact(path, c)).toThrow("timing disagrees");
    }));
});

test("output refuses existing directories without changing their contents", () =>
  fixture((r, c) => {
    const a = png(r, "a.png"),
      b = png(r, "b.png");
    expect(() => runCompare({ baseline: a, candidate: b, out: r }, c)).toThrow(
      "already exists",
    );
    expect(readFileSync(a).at(-1)).toBe(255);
  }));

test("alpha loss is concrete evidence but cannot become improvement", () =>
  fixture((r, c) => {
    const a = loadFinalArtifact(png(r, "a.png"), c);
    const b = {
      ...a,
      frames: [{ ...a.frames[0]!, data: Buffer.from([255, 0, 0, 0]) }],
    };
    const report = compareFinalArtifacts(a, b);
    expect(report.alphaLostPixels).toBe(1);
    expect(report.changedProtectedProperties).toContain("pixels");
    expect(report.artisticQuality).toBe("unknown");
  }));

test("symlink input and sheet references are refused", () =>
  fixture((r, c) => {
    const source = png(r, "original.png");
    const link = join(r, "alias.png");
    symlinkSync(source, link);
    expect(() => loadFinalArtifact(link, c)).toThrow("Symlink");
    symlinkSync(source, join(r, "sheet.png"));
    expect(() => loadFinalArtifact(atlas(r), c)).toThrow("Symlink");
  }));
