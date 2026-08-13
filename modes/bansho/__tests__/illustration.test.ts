/**
 * I1 — the drawn figure: sidecar, plan, paint, and the honest hole.
 *
 * What these pin, in the order the picture travels:
 *  1. the sidecar reader (tolerant, one bad entry never blanks the rest);
 *  2. the ONE verdict function the board and `check-board` share;
 *  3. the plan (one beat per figure, gap-transparent no longer);
 *  4. the time — a function of the DECLARED aspect and of nothing measured
 *     (the two-width gate depends on this);
 *  5. the box — it FITS INSIDE the region it stands in, on both axes, and
 *     the arithmetic that says so reads no pixels;
 *  6. the paint — the board's own ink through the picture's luminance, one
 *     asset for both themes;
 *  7. every way it can fail, each one visible.
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { loadBoard, parseLecture } from "../domain.js";
import { collectFindings } from "../viewer/board-check.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import { BANNED_WORDS } from "./vocabulary.js";
import { illustrationCascade, toEntries } from "../viewer/reconcile.js";
import { DEFAULT_DURATIONS, IMAGE_GLUE, imageDuration } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import { flattenSteps, planLecture, planStepUnits } from "../engine/inference.js";
import { buildTimeline } from "../engine/timeline.js";
import type {
  ImageStep,
  IllustrationSpec,
  MeasureContext,
  Step,
} from "../engine/types.js";
import {
  illustrationAspect,
  illustrationBox,
  illustrationSource,
  illustrationRefusal,
  illustrationSources,
  isSafeIllustrationSrc,
  readIllustrationManifest,
  undrawnIllustrations,
  type IllustrationManifest,
} from "../illustrations/types.js";
import {
  BOUNDED_REGION_WORDS,
  REGION_GUTTER,
  resolveRegionRect,
} from "../engine/regions.js";

const D = DEFAULT_DURATIONS;

const SRC = "# 神经元\n\n先看它的样子。\n\n![一个神经元](illustrations/neuron.png)\n\n再看它怎么传信号。\n";

const manifestOf = (json: unknown): IllustrationManifest =>
  readIllustrationManifest(JSON.stringify(json)).manifest!;

const NEURON = manifestOf({
  figures: { "illustrations/neuron.png": { aspect: 1.5 } },
});

function makeCtx(
  illustration?: (step: ImageStep) => IllustrationSpec | undefined,
): MeasureContext {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const measureHost = doc.createElement("div");
  doc.body.appendChild(measureHost);
  return {
    durations: D,
    document: doc,
    measureHost,
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: () => undefined,
    ...(illustration ? { illustration } : {}),
  };
}

function buildFigure(
  source: string,
  ctx: MeasureContext,
): { step: ImageStep; node: Element; revealables: ReturnType<typeof factoryFor> extends never ? never : any[] } {
  const lecture = parseLecture(source);
  const entry = flattenSteps(lecture).find((e) => e.step.kind === "image")!;
  const built = factoryFor("image")!.build(entry.step, ctx);
  return { step: entry.step as ImageStep, ...built };
}

// ── 1. The sidecar ──────────────────────────────────────────────────────────

describe("illustrations/manifest.json — the declared shape", () => {
  test("absent is silence, not a fault", () => {
    expect(readIllustrationManifest(undefined)).toEqual({
      manifest: null,
      issue: null,
    });
    expect(readIllustrationManifest("  ")).toEqual({ manifest: null, issue: null });
  });

  test("malformed carries its reason instead of hiding behind that silence", () => {
    const broken = readIllustrationManifest("{not json");
    expect(broken.manifest).toBeNull();
    expect(broken.issue).toMatch(/not valid JSON/);

    const shapeless = readIllustrationManifest('{"clips":{}}');
    expect(shapeless.manifest).toBeNull();
    expect(shapeless.issue).toMatch(/figures/);
  });

  test("both spellings of the shape are read: aspect, or width and height", () => {
    const read = readIllustrationManifest(
      JSON.stringify({
        figures: {
          "a.png": { aspect: 1.5 },
          "b.png": { width: 1536, height: 1024 },
        },
      }),
    );
    expect(read.issue).toBeNull();
    expect(read.manifest!.figures["a.png"]!.aspect).toBeCloseTo(1.5, 10);
    expect(read.manifest!.figures["b.png"]!.aspect).toBeCloseTo(1.5, 10);
  });

  test("one unusable entry is dropped by name; the rest still draw", () => {
    const read = readIllustrationManifest(
      JSON.stringify({
        figures: {
          "good.png": { aspect: 1 },
          "zero.png": { aspect: 0 },
          "typo.png": { widht: 100, height: 50 },
        },
      }),
    );
    expect(Object.keys(read.manifest!.figures)).toEqual(["good.png"]);
    expect(read.issue).toMatch(/zero\.png/);
    expect(read.issue).toMatch(/typo\.png/);
  });

  test("`./x.png` and `x.png` name the same picture", () => {
    const read = readIllustrationManifest(
      JSON.stringify({ figures: { "./a/b.png": { aspect: 2 } } }),
    );
    expect(illustrationAspect("a/b.png", read.manifest)).toBe(2);
    expect(illustrationAspect("./a/b.png", read.manifest)).toBe(2);
  });

  test("the sidecar rides the board's own file load, per content set", () => {
    const board = loadBoard([
      { path: "神经/board.md", content: SRC },
      {
        path: "神经/illustrations/manifest.json",
        content: JSON.stringify({ figures: { "illustrations/neuron.png": { aspect: 1.5 } } }),
      },
      { path: "别的/board.md", content: "# 别的\n" },
    ] as never)!;
    expect(illustrationAspect("illustrations/neuron.png", board.illustrations["神经"]!.manifest)).toBe(1.5);
    expect(board.illustrations["别的"]!.manifest).toBeNull();
  });
});

// ── 2. The one verdict ──────────────────────────────────────────────────────

describe("the verdict the board and the report share", () => {
  test("a picture with an entry is drawable", () => {
    expect(illustrationRefusal("illustrations/neuron.png", NEURON)).toBeNull();
  });

  test("a picture with no entry is refused — the board cannot make room", () => {
    expect(illustrationRefusal("illustrations/other.png", NEURON)).toBe("noEntry");
    expect(illustrationRefusal("illustrations/neuron.png", null)).toBe("noEntry");
  });

  test("a confirmed-absent file is refused, an unanswered probe accuses nobody", () => {
    const absent = new Set(["illustrations/neuron.png"]);
    expect(illustrationRefusal("illustrations/neuron.png", NEURON, absent)).toBe(
      "fileMissing",
    );
    expect(illustrationRefusal("illustrations/neuron.png", NEURON, new Set())).toBeNull();
  });

  test("a path that leaves the lecture's folder never reaches the paint", () => {
    // Each of these would be a different origin — where a mask fails
    // TOTALLY and SILENTLY (frontend rules, 2026-08-13) — or would be
    // refused by the file route's traversal guard.
    for (const src of [
      "/etc/passwd",
      "../secrets/x.png",
      "http://evil.example/x.png",
      "data:image/png;base64,AAAA",
      "file:///x.png",
      "",
    ]) {
      expect(isSafeIllustrationSrc(src), src).toBe(false);
      expect(illustrationRefusal(src, NEURON), src).toBe("unsafePath");
    }
    expect(isSafeIllustrationSrc("illustrations/neuron.png")).toBe(true);
    expect(isSafeIllustrationSrc("./a/b.png")).toBe(true);
  });

  test("every undrawn picture is named, addressed, in document order", () => {
    const lecture = parseLecture(
      "![一](a.png)\n\n![二](b.png)\n\n![三](../c.png)\n",
    );
    const undrawn = undrawnIllustrations(
      lecture,
      manifestOf({ figures: { "a.png": { aspect: 1 }, "b.png": { aspect: 1 } } }),
      new Set(["b.png"]),
    );
    expect(undrawn.map((u) => [u.src, u.reason])).toEqual([
      ["b.png", "fileMissing"],
      ["../c.png", "unsafePath"],
    ]);
    for (const u of undrawn) expect(typeof u.ref.section).toBe("number");
  });

  test("a clean board reports no undrawn pictures", () => {
    expect(undrawnIllustrations(parseLecture(SRC), NEURON)).toEqual([]);
  });

  test("the pictures a lecture names are listed once, safe ones only", () => {
    const lecture = parseLecture("![一](a.png)\n\n![又是一](./a.png)\n\n![外面](../c.png)\n");
    expect(illustrationSources(lecture)).toEqual(["a.png"]);
  });
});

// ── 3. The plan ─────────────────────────────────────────────────────────────

describe("the plan — a figure is performed now", () => {
  test("a picture no longer declares itself unperformable", () => {
    const lecture = parseLecture(SRC);
    expect(lecture.errors).toEqual([]);
  });

  test("one figure, one beat", () => {
    const lecture = parseLecture(SRC);
    const step = flattenSteps(lecture).find((e) => e.step.kind === "image")!.step;
    const units = planStepUnits(step, D);
    expect(units.map((u) => u.kind)).toEqual(["image"]);
    expect(units[0]!.srcSpan).toEqual(step.srcSpan);
    expect(units[0]!.duration).toBeCloseTo(imageDuration(IMAGE_GLUE.nominalAspect), 10);
  });

  test("the figure takes its place in the lecture's own sequence", () => {
    const plans = planLecture(parseLecture(SRC), D);
    expect(plans.map((p) => p.step.kind)).toEqual([
      "heading",
      "prose",
      "image",
      "prose",
    ]);
    // It breathes like any other block: one paragraph pause before it.
    expect(plans[2]!.leadIn).toBeCloseTo(D.paraGap, 10);
  });

  test("an embedded block is still not performed (the gate kept its other half)", () => {
    const lecture = parseLecture("段落。\n\n```html\n<b>x</b>\n```\n");
    expect(lecture.errors.map((e) => e.code)).toEqual(["unsupportedStep"]);
    expect(planLecture(lecture, D).map((p) => p.step.kind)).toEqual(["prose"]);
  });
});

// ── 4. The time ─────────────────────────────────────────────────────────────

describe("a figure's time — declared, never measured", () => {
  test("a square figure takes the reference time", () => {
    expect(imageDuration(1)).toBeCloseTo(IMAGE_GLUE.sweep, 10);
  });

  test("taller takes longer, wider takes less — monotonic in the declaration", () => {
    const tall = imageDuration(2 / 3);
    const square = imageDuration(1);
    const wide = imageDuration(3 / 2);
    expect(tall).toBeGreaterThan(square);
    expect(square).toBeGreaterThan(wide);
  });

  test("a freak declaration is bounded at both ends", () => {
    expect(imageDuration(0.001)).toBeCloseTo(IMAGE_GLUE.sweep * IMAGE_GLUE.maxTallness, 10);
    expect(imageDuration(1000)).toBeCloseTo(IMAGE_GLUE.sweep * IMAGE_GLUE.minTallness, 10);
  });

  test("total over its input domain — a broken number falls back, never NaN", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(imageDuration(bad)).toBeCloseTo(imageDuration(IMAGE_GLUE.nominalAspect), 10);
    }
  });

  test("the built figure's time is a function of the declaration alone", () => {
    // The two-width gate in one assertion: the SAME figure built against
    // two different boxes reports the same number, because nothing about
    // the box is an input.
    const wide = makeCtx(() => ({ aspect: 1.5, url: "/api/file?path=x" }));
    (wide.measureHost as HTMLElement).style.width = "1990px";
    const narrow = makeCtx(() => ({ aspect: 1.5, url: "/api/file?path=x" }));
    (narrow.measureHost as HTMLElement).style.width = "1280px";
    expect(buildFigure(SRC, wide).revealables[0].naturalDuration).toBe(
      buildFigure(SRC, narrow).revealables[0].naturalDuration,
    );
    expect(buildFigure(SRC, wide).revealables[0].naturalDuration).toBeCloseTo(
      imageDuration(1.5),
      10,
    );
  });

  test("the built figure's time reaches the canonical timeline", () => {
    const lecture = parseLecture(SRC);
    const ctx = makeCtx(() => ({ aspect: 2, url: "/api/file?path=x" }));
    const entry = flattenSteps(lecture).find((e) => e.step.kind === "image")!;
    const built = factoryFor("image")!.build(entry.step, ctx);
    const timeline = buildTimeline(lecture, { durations: D }, {
      unitsFor: (ref) =>
        ref.section === entry.ref.section && ref.step === entry.ref.step
          ? built.revealables
          : undefined,
    });
    const window = timeline.schedule.find(
      (s) => s.step.section === entry.ref.section && s.step.step === entry.ref.step,
    )!;
    expect(window.end - window.start).toBeCloseTo(imageDuration(2), 10);
  });
});

// ── 5. The box ──────────────────────────────────────────────────────────────

/**
 * NOTHING MAY BE PUSHED OUT OF FRAME (「不能有什么东西被挤出画面」).
 *
 * The canonical face: the board is 1242 × 894 (W7) and `.bansho-panel`
 * pads it 36 / 44 / 64, so a figure's world is 1154 wide and 794 deep.
 * Those are the numbers the live measurement was taken against, and the
 * `@at right` reproduction below is that measurement to the pixel.
 */
const FACE_W = 1242 - 44 - 44;
const FACE_H = 894 - 36 - 64;

/** Wide, tall, square — the three shapes that actually broke. */
const ASPECTS = [
  ["16:9", 16 / 9],
  ["3:4", 3 / 4],
  ["1:1", 1],
] as const;

describe("a figure fits inside the space it is given — both axes", () => {
  test("the reproduction: `@at right`, 16:9 — 565 wide, not the whole board", () => {
    // Measured in Chromium 2026-08-13: the box took 1242 (the FULL board)
    // and hung 633px off the right edge, because `left` + `right` +
    // `width: 100%` resolves the percentage against the containing block
    // and drops the insets. 1154 − 24 gutter, halved, is what `@at right`
    // actually offers.
    const rect = resolveRegionRect("right", FACE_W, FACE_H);
    expect(rect.ok && rect.rect.w).toBe(565);
    const box = illustrationBox(rect.ok ? rect.rect : { w: 0, h: 0 }, 16 / 9);
    expect(box.w).toBe(565);
    expect(Math.round(box.h)).toBe(318);
  });

  for (const word of BOUNDED_REGION_WORDS) {
    for (const [label, aspect] of ASPECTS) {
      test(`@at ${word} × ${label}: inside its region, and inside the board`, () => {
        const verdict = resolveRegionRect(word, FACE_W, FACE_H);
        expect(verdict.ok).toBe(true);
        const rect = verdict.ok ? verdict.rect : { x: 0, y: 0, w: 0, h: 0 };
        const box = illustrationBox(rect, aspect);

        // The two axes of the floor, said as the mount says them.
        expect(box.w).toBeLessThanOrEqual(rect.w);
        expect(box.h).toBeLessThanOrEqual(rect.h);
        // Centred in whatever the binding axis left over — the same
        // convention display math already uses on this board.
        const x = rect.x + (rect.w - box.w) / 2;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + box.w).toBeLessThanOrEqual(FACE_W);
        expect(rect.y + box.h).toBeLessThanOrEqual(FACE_H);
        // …and it is still the DECLARED shape, never a squash to fit.
        expect(box.w / box.h).toBeCloseTo(aspect, 10);
      });
    }
  }

  test("the height binds when the region is shallower than the picture is tall", () => {
    // A square figure across a whole 1154 × 794 face would be 1154 tall in
    // a 794-deep board — the vertical half of the same defect.
    const box = illustrationBox({ w: FACE_W, h: FACE_H }, 1);
    expect(box.w).toBe(FACE_H);
    expect(box.h).toBe(FACE_H);
  });

  test("the width binds when the region is wide enough for the whole height", () => {
    const box = illustrationBox({ w: 565, h: FACE_H }, 16 / 9);
    expect(box.w).toBe(565);
  });

  test("a band is half a face deep, and a square figure feels it", () => {
    const bandH = (FACE_H - REGION_GUTTER) / 2;
    expect(illustrationBox({ w: FACE_W, h: bandH }, 1).w).toBe(bandH);
  });

  test("the strip has no bottom, so nothing can be pushed off it downward", () => {
    // `H = Infinity` is the strip's face. The width still binds; the
    // vertical clamp simply has nothing to clamp against.
    const box = illustrationBox({ w: 565, h: Number.POSITIVE_INFINITY }, 1);
    expect(box.w).toBe(565);
    expect(box.h).toBe(565);
  });

  test("total over its input domain — a broken number never becomes a NaN box", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const box = illustrationBox({ w: 565, h: FACE_H }, bad);
      expect(Number.isFinite(box.w)).toBe(true);
      expect(Number.isFinite(box.h)).toBe(true);
      expect(box.w).toBeLessThanOrEqual(565);
      expect(box.h).toBeLessThanOrEqual(FACE_H);
    }
    for (const room of [{ w: 0, h: FACE_H }, { w: 565, h: 0 }, { w: Number.NaN, h: FACE_H }]) {
      const box = illustrationBox(room, 1.5);
      expect(box.w).toBe(0);
      expect(box.h).toBe(0);
    }
  });
});

// ── 6. The paint ────────────────────────────────────────────────────────────

describe("the paint — the board's ink through the picture's luminance", () => {
  const ctx = () => makeCtx(() => ({ aspect: 1.5, url: "/api/file?path=n.png" }));

  test("one asset serves both themes: the color is a token, not the file", () => {
    const { node } = buildFigure(SRC, ctx());
    const ink = node.querySelector(".bansho-illustration-ink") as HTMLElement;
    // Nothing about the figure names a color: the board's own `--board-fg`
    // is what gets painted, so a theme flip repaints the same file.
    expect(ink.style.cssText).not.toMatch(/#|rgb|color:/i);
    expect(BOARD_BASE_CSS).toMatch(
      /\.bansho-illustration-ink\s*\{[^}]*background-color:\s*var\(--board-fg\)/,
    );
    expect(ink.style.getPropertyValue("mask-mode")).toBe("luminance");
    expect(ink.style.getPropertyValue("mask-image")).toContain("/api/file?path=n.png");
  });

  test("the prefixed spelling carries its own luminance switch", () => {
    // Without it a prefixed engine falls back to ALPHA masking, and an
    // opaque picture in alpha mode paints a solid rectangle over the board.
    const { node } = buildFigure(SRC, ctx());
    const ink = node.querySelector(".bansho-illustration-ink") as HTMLElement;
    expect(ink.style.getPropertyValue("-webkit-mask-image")).toContain("n.png");
    expect(ink.style.getPropertyValue("-webkit-mask-source-type")).toBe("luminance");
  });

  test("the box is sized by the DECLARATION, before any file has loaded", () => {
    const { node } = buildFigure(SRC, makeCtx(() => ({ aspect: 1.5, url: "/x" })));
    // (a CSSOM may normalize `1.5` to the equivalent `1.5 / 1`)
    expect((node as HTMLElement).style.aspectRatio).toMatch(/^1\.5( \/ 1)?$/);
    expect(node.className).toBe("bansho-illustration");
  });

  test("the alt text is what a reader who cannot see it is told", () => {
    const { node } = buildFigure(SRC, ctx());
    expect(node.getAttribute("aria-label")).toBe("一个神经元");
    expect(node.getAttribute("role")).toBe("img");
  });

  test("built state is unrevealed; progress opens the window and only that", () => {
    const { node, revealables } = buildFigure(SRC, ctx());
    const ink = node.querySelector(".bansho-illustration-ink") as HTMLElement;
    const unit = revealables[0];
    expect(unit.kind).toBe("wipe");
    expect(unit.degraded).toBeUndefined();
    expect(ink.style.clipPath).toBe("inset(0 100.00% 0 0)");
    unit.seek(0.5);
    const half = ink.style.clipPath;
    expect(half).not.toBe("inset(0 100.00% 0 0)");
    expect(half).not.toBe("inset(0 0.00% 0 0)");
    unit.seek(1);
    expect(ink.style.clipPath).toBe("inset(0 0.00% 0 0)");
    // Pure in progress: seeking back is seeking back, not a new drawing.
    unit.seek(0.5);
    expect(ink.style.clipPath).toBe(half);
    unit.seek(0);
    expect(ink.style.clipPath).toBe("inset(0 100.00% 0 0)");
  });

  test("a path is escaped on its way into the paint, never interpolated raw", () => {
    const { node } = buildFigure(
      SRC,
      makeCtx(() => ({ aspect: 1, url: '/api/file?path=a") ; x:y ("' })),
    );
    const ink = node.querySelector(".bansho-illustration-ink") as HTMLElement;
    expect(ink.style.getPropertyValue("mask-image")).toContain('\\"');
  });
});

// ── 7. The honest hole ──────────────────────────────────────────────────────

describe("a picture that cannot be drawn says so, on the board", () => {
  test("no shape on record → a badge stands where the figure would", () => {
    const { node, revealables } = buildFigure(SRC, makeCtx(() => undefined));
    expect(node.className).toContain("bansho-bad-badge");
    expect(node.textContent).toContain("illustrations/neuron.png");
    // Schedule parity: the step keeps its place, and draws nothing.
    expect(revealables).toHaveLength(1);
    expect(revealables[0].degraded).toBe(true);
    expect(revealables[0].naturalDuration).toBeGreaterThan(0);
  });

  test("no seam at all (a host that never wired it) degrades the same way", () => {
    const { node } = buildFigure(SRC, makeCtx());
    expect(node.className).toContain("bansho-bad-badge");
  });

  test("nothing is painted for a refused picture — no mask, no color", () => {
    const { node } = buildFigure(SRC, makeCtx(() => undefined));
    expect(node.querySelector(".bansho-illustration-ink")).toBeNull();
    expect((node as HTMLElement).style.aspectRatio).toBe("");
  });

  test("a mis-registered kind degrades to inert beats, never a throw", () => {
    const ctx = makeCtx(() => ({ aspect: 1, url: "/x" }));
    const prose = flattenSteps(parseLecture("一句话。\n")).find(
      (e) => e.step.kind === "prose",
    )!.step as Step;
    const built = factoryFor("image")!.build(prose, ctx);
    expect(built.revealables.every((r) => r.degraded === true)).toBe(true);
  });
});

// ── 8. The host seam ────────────────────────────────────────────────────────

describe("the resolver a host hands the board", () => {
  const toUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;

  test("the URL is ROOT-RELATIVE and content-set prefixed", () => {
    // Root-relative is not a preference: a mask reads pixels, so a
    // cross-origin source paints nothing at all — and in dev the API base
    // is a different port, which is a different origin.
    const source = illustrationSource(NEURON, "神经", toUrl);
    const spec = source.resolve("illustrations/neuron.png")!;
    expect(spec.url.startsWith("/api/file?path=")).toBe(true);
    expect(decodeURIComponent(spec.url)).toContain("神经/illustrations/neuron.png");
    expect(spec.aspect).toBe(1.5);
    expect(illustrationSource(NEURON, "", toUrl).resolve("illustrations/neuron.png")!.url)
      .not.toContain("神经");
  });

  test("every refusal comes back as the one refusal the factory reads", () => {
    const source = illustrationSource(NEURON, "", toUrl, new Set(["gone.png"]));
    expect(source.resolve("nowhere.png")).toBeUndefined();
    expect(source.resolve("gone.png")).toBeUndefined();
    expect(source.resolve("../out.png")).toBeUndefined();
  });

  test("identity moves when the shape moves, and when a file comes or goes", () => {
    const base = illustrationSource(NEURON, "", toUrl).identity;
    const resized = illustrationSource(
      manifestOf({ figures: { "illustrations/neuron.png": { aspect: 2 } } }),
      "",
      toUrl,
    ).identity;
    const gone = illustrationSource(NEURON, "", toUrl, new Set(["x.png"])).identity;
    expect(resized).not.toBe(base);
    expect(gone).not.toBe(base);
    // …and stands still when nothing did (the file-watch loop is hot).
    expect(illustrationSource(NEURON, "", toUrl).identity).toBe(base);
  });
});

describe("a figure rebuilds when its picture changed under it", () => {
  const entries = toEntries(parseLecture(SRC));
  const imageIndex = entries.findIndex((e) => e.step.kind === "image");

  test("the same picture is left alone", () => {
    const prev = entries.map((e) => ({ hash: e.hash, illustration: "A" }));
    expect([...illustrationCascade(prev, entries, "A")]).toEqual([]);
  });

  test("a new shape, or a file that just arrived, rebuilds the figure", () => {
    // Neither event moves one byte of board.md, so every hash still
    // matches and the plan is a no-op: without this the stale box (or the
    // stale badge) survives every reconcile.
    const prev = entries.map((e) => ({ hash: e.hash, illustration: "A" }));
    expect([...illustrationCascade(prev, entries, "B")]).toEqual([imageIndex]);
  });

  test("only figures — a picture's shape says nothing about the prose", () => {
    const prev = entries.map((e) => ({ hash: e.hash }));
    // Nothing was built with an identity yet; the base plan covers a
    // never-built step, so the cascade adds only the one that WAS built.
    const withOne = prev.map((p, i) =>
      i === imageIndex ? { ...p, illustration: "A" } : p,
    );
    expect([...illustrationCascade(withOne, entries, "B")]).toEqual([imageIndex]);
  });
});

// ── 9. The report ───────────────────────────────────────────────────────────

describe("check-board says the same thing the board shows", () => {
  const lecture = parseLecture(
    "# 图\n\n![好的](a.png)\n\n![没登记](b.png)\n\n![不见了](c.png)\n\n![出界](../d.png)\n",
  );
  const manifest = manifestOf({
    figures: { "a.png": { aspect: 1 }, "c.png": { aspect: 1 } },
  });
  const findings = collectFindings(lecture, {
    mathErrors: [],
    overflowing: [],
    undrawnIllustrations: undrawnIllustrations(lecture, manifest, new Set(["c.png"])),
  });

  test("one finding per picture that is not on the board, and no more", () => {
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.code === "refUnresolved")).toBe(true);
  });

  test("each one is addressed, quotes its own path, and says what to do", () => {
    for (const finding of findings) {
      expect(finding.address).toBeDefined();
      expect(finding.excerpt).toBeTruthy();
    }
    expect(findings.map((f) => f.excerpt)).toEqual(["b.png", "c.png", "../d.png"]);
    expect(findings[0]!.message).toContain("illustrations/manifest.json");
    expect(findings[1]!.message).toMatch(/not there/);
    expect(findings[2]!.message).toMatch(/inside the lecture's own folder/);
  });

  test("a picture the board CAN draw is never accused", () => {
    expect(findings.some((f) => f.excerpt === "a.png")).toBe(false);
  });

  test("the words stay lecture words", () => {
    for (const finding of findings) {
      for (const banned of BANNED_WORDS) {
        expect(finding.message.toLowerCase()).not.toContain(banned);
      }
    }
  });
});
