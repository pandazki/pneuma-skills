import {
  readFileSync,
  realpathSync,
  lstatSync,
  existsSync,
  mkdirSync,
  rmdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  resolve,
  dirname,
  join,
  extname,
  relative,
  isAbsolute,
} from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const equal = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function imageValid(image) {
  if (
    !image ||
    !integer(image.width) ||
    !integer(image.height) ||
    !image.width ||
    !image.height ||
    image.data?.length !== image.width * image.height * 4
  )
    throw Error("Invalid decoded RGBA image");
  return {
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data),
  };
}
function inside(root, path) {
  const rel = relative(root, path);
  return (
    rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"))
  );
}
function snapshot(path, records) {
  const absolute = resolve(path);
  if (lstatSync(absolute).isSymbolicLink())
    throw Error(`Symlink input refused: ${absolute}`);
  const canonical = realpathSync(absolute);
  if (!lstatSync(canonical).isFile())
    throw Error(`Expected regular file: ${absolute}`);
  const bytes = readFileSync(canonical);
  const record = { path: absolute, realPath: canonical, sha256: hash(bytes) };
  records.push(record);
  return { bytes, record };
}
function verify(records) {
  for (const r of records) {
    if (
      realpathSync(r.path) !== r.realPath ||
      hash(readFileSync(r.path)) !== r.sha256
    )
      throw Error(`Input changed during comparison: ${r.path}`);
  }
}
function gifMetadata(bytes) {
  if (bytes.length < 13) throw Error("Truncated GIF");
  let at = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0),
    delay = null,
    loop = { plays: 1 };
  const delays = [];
  function blocks() {
    const chunks = [];
    while (at < bytes.length) {
      const size = bytes[at++];
      if (!size) return Buffer.concat(chunks);
      if (at + size > bytes.length) break;
      chunks.push(bytes.subarray(at, at + size));
      at += size;
    }
    throw Error("Truncated GIF sub-block");
  }
  while (at < bytes.length) {
    const tag = bytes[at++];
    if (tag === 0x3b) return { loop, delays };
    if (tag === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        if (bytes[at] !== 4 || at + 6 > bytes.length || bytes[at + 5] !== 0)
          throw Error("Invalid GIF control block");
        delay = bytes.readUInt16LE(at + 2) * 10;
        at += 6;
      } else {
        const data = blocks();
        if (
          label === 0xff &&
          ["NETSCAPE2.0", "ANIMEXTS1.0"].includes(
            data.subarray(0, 11).toString(),
          )
        ) {
          if (data.length !== 14 || data[11] !== 1)
            throw Error("Invalid GIF loop block");
          const repeats = data.readUInt16LE(12);
          loop = { plays: repeats === 0 ? "infinite" : repeats + 1 };
        }
      }
    } else if (tag === 0x2c) {
      if (at + 9 > bytes.length) throw Error("Truncated GIF image");
      const packed = bytes[at + 8];
      at += 9;
      if (packed & 128) at += 3 * 2 ** ((packed & 7) + 1);
      at++;
      blocks();
      if (!delay) throw Error("GIF frame delay missing or zero");
      delays.push(delay);
      delay = null;
    } else throw Error("Invalid GIF block");
  }
  throw Error("GIF trailer missing");
}
function animatedPng(bytes) {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(at),
      type = bytes.subarray(at + 4, at + 8).toString();
    if (type === "acTL") return true;
    at += 12 + size;
    if (type === "IEND") return false;
  }
  return false;
}

/** Load only final artifacts. Codec callbacks must decode without resizing. */
export function loadFinalArtifact(path, codecs, records = []) {
  const { bytes, record } = snapshot(path, records);
  const extension = extname(path).toLowerCase();
  let frames, durationsMs, loop, pivots, order, sheet;
  if (extension === ".png") {
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("PNG signature mismatch");
    if (animatedPng(bytes)) throw Error("Animated PNG is unsupported");
    frames = [imageValid(codecs.readRgba(record.realPath))];
    durationsMs = null;
    loop = null;
    pivots = null;
    order = null;
  } else if (extension === ".gif") {
    if (!/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
      throw Error("GIF signature mismatch");
    const scratch = mkdtempSync(join(tmpdir(), "sprite-compare-gif-"));
    try {
      const decoded = codecs.decodeGifFrames(
        record.realPath,
        scratch,
        "compare",
      );
      if (decoded.warnings?.length)
        throw Error("GIF timing is inferred; exact comparison refused");
      const names = readdirSync(scratch)
        .filter((n) => /^\d+\.png$/.test(n))
        .sort((a, b) => Number(a.slice(0, -4)) - Number(b.slice(0, -4)));
      frames = names.map((n) => imageValid(codecs.readRgba(join(scratch, n))));
      durationsMs = decoded.delaysMs;
      if (
        !frames.length ||
        frames.length !== durationsMs?.length ||
        durationsMs.some((n) => !Number.isFinite(n) || n <= 0)
      )
        throw Error("Invalid GIF frame timing");
      if (
        frames.some(
          (f) => f.width !== frames[0].width || f.height !== frames[0].height,
        )
      )
        throw Error("GIF canvas changed");
      const metadata = gifMetadata(bytes);
      if (!equal(metadata.delays, durationsMs))
        throw Error("Decoded GIF timing disagrees with final file");
      loop = metadata.loop;
      pivots = null;
      order = null;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else if (extension === ".json") {
    const doc = JSON.parse(bytes.toString());
    if (
      doc.meta?.app !== "pneuma-sprite" ||
      !doc.frames ||
      Array.isArray(doc.frames)
    )
      throw Error("Only Pneuma TexturePacker hash atlases are supported");
    const image = doc.meta.image;
    if (
      typeof image !== "string" ||
      !image ||
      isAbsolute(image) ||
      image.includes("\\")
    )
      throw Error("Invalid atlas image reference");
    const root = dirname(record.realPath),
      target = resolve(root, image);
    if (!inside(root, target) || !inside(root, realpathSync(target)))
      throw Error("Atlas image escapes artifact directory");
    const sheetInput = snapshot(target, records);
    if (
      extname(target).toLowerCase() !== ".png" ||
      !sheetInput.bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("Atlas sheet must be PNG");
    sheet = imageValid(codecs.readRgba(sheetInput.record.realPath));
    if (!equal(doc.meta.size, { w: sheet.width, h: sheet.height }))
      throw Error("Atlas sheet dimensions disagree");
    const animations = Object.values(doc.animations ?? {});
    if (animations.length !== 1 || !Array.isArray(animations[0]))
      throw Error("Atlas requires one explicit animation order");
    order = animations[0];
    if (
      !order.length ||
      new Set(order).size !== order.length ||
      order.length !== Object.keys(doc.frames).length ||
      order.some((k) => typeof k !== "string" || !Object.hasOwn(doc.frames, k))
    )
      throw Error("Invalid atlas frame order");
    if (typeof doc.meta.loop !== "boolean")
      throw Error("Atlas loop semantics missing");
    loop = { plays: doc.meta.loop ? "infinite" : 1 };
    durationsMs = [];
    pivots = [];
    frames = order.map((key) => {
      const f = doc.frames[key],
        r = f.frame;
      if (
        !r ||
        !["x", "y", "w", "h"].every((k) => integer(r[k])) ||
        !r.w ||
        !r.h ||
        r.x + r.w > sheet.width ||
        r.y + r.h > sheet.height
      )
        throw Error("Invalid atlas rectangle");
      if (
        f.rotated !== false ||
        f.trimmed !== false ||
        !equal(f.sourceSize, { w: r.w, h: r.h }) ||
        !equal(f.spriteSourceSize, { x: 0, y: 0, w: r.w, h: r.h })
      )
        throw Error("Rotated or trimmed atlas frames unsupported");
      if (!Number.isFinite(f.duration) || f.duration <= 0)
        throw Error("Atlas frame duration missing");
      if (
        !f.pivot ||
        !["x", "y"].every(
          (k) =>
            Number.isFinite(f.pivot[k]) && f.pivot[k] >= 0 && f.pivot[k] <= 1,
        ) ||
        (f.anchor && !equal(f.anchor, f.pivot))
      )
        throw Error("Invalid atlas pivot");
      durationsMs.push(f.duration);
      pivots.push(f.pivot);
      const data = Buffer.alloc(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++)
        sheet.data.copy(
          data,
          y * r.w * 4,
          ((r.y + y) * sheet.width + r.x) * 4,
          ((r.y + y) * sheet.width + r.x + r.w) * 4,
        );
      return { width: r.w, height: r.h, data };
    });
  } else
    throw Error(`Unsupported final artifact format: ${extension || "(none)"}`);
  verify(records);
  return {
    path: record.realPath,
    format: extension.slice(1),
    frames,
    durationsMs,
    loop,
    pivots,
    order,
    sheet,
    files: records.slice(),
    pixelSha256: hash(Buffer.concat(frames.map((f) => f.data))),
    ...(sheet ? { sheetPixelSha256: hash(sheet.data) } : {}),
  };
}

export function compareFinalArtifacts(
  baseline,
  candidate,
  { alphaClean, cleanAlphaHaze } = {},
) {
  const changed = [];
  const geometry = (a) =>
    a.frames.map((f) => ({ width: f.width, height: f.height }));
  for (const [property, a, b] of [
    ["geometry", geometry(baseline), geometry(candidate)],
    ["timing", baseline.durationsMs, candidate.durationsMs],
    ["loop", baseline.loop, candidate.loop],
    ["pivots", baseline.pivots, candidate.pivots],
    ["frameOrder", baseline.order, candidate.order],
  ])
    if (!equal(a, b)) changed.push(property);
  if (baseline.sheet || candidate.sheet) {
    if (
      !baseline.sheet ||
      !candidate.sheet ||
      baseline.sheet.width !== candidate.sheet.width ||
      baseline.sheet.height !== candidate.sheet.height
    )
      changed.push("sheetGeometry");
    else if (!Buffer.from(baseline.sheet.data).equals(candidate.sheet.data))
      changed.push("sheetPixels");
  }
  const sameGeometry = !changed.includes("geometry");
  let changedPixels = null,
    alphaLostPixels = null;
  if (sameGeometry) {
    changedPixels = 0;
    alphaLostPixels = 0;
    baseline.frames.forEach((f, i) => {
      const b = candidate.frames[i].data;
      for (let p = 0; p < f.data.length; p += 4) {
        if (
          f.data[p] !== b[p] ||
          f.data[p + 1] !== b[p + 1] ||
          f.data[p + 2] !== b[p + 2] ||
          f.data[p + 3] !== b[p + 3]
        )
          changedPixels++;
        if (b[p + 3] < f.data[p + 3]) alphaLostPixels++;
      }
    });
  }
  if (changedPixels) changed.push("pixels");
  const exact = changed.length === 0;
  const unknownTiming =
    baseline.frames.length > 1 &&
    (baseline.durationsMs === null || candidate.durationsMs === null);
  let cleanup = { status: "undeclared" };
  if (alphaClean) {
    cleanup = { status: "unverified", parameters: alphaClean };
    if (
      cleanAlphaHaze &&
      !changed.some((p) => p !== "pixels" && p !== "sheetPixels")
    ) {
      const matches = baseline.sheet
        ? Buffer.from(
            cleanAlphaHaze(baseline.sheet, alphaClean).image.data,
          ).equals(candidate.sheet.data)
        : baseline.frames.every((frame, i) =>
            Buffer.from(cleanAlphaHaze(frame, alphaClean).image.data).equals(
              candidate.frames[i].data,
            ),
          );
      cleanup.status = matches
        ? changedPixels === 0 && !changed.includes("sheetPixels")
          ? "no-op"
          : "verified"
        : "violated";
    }
  }
  return {
    schemaVersion: 1,
    status: exact
      ? "identical"
      : changed.some((p) => p !== "pixels" && p !== "sheetPixels") ||
          unknownTiming
        ? "unknown"
        : "comparable",
    artisticQuality: "unknown",
    changedProtectedProperties: changed,
    changedPixels,
    alphaLostPixels,
    alphaClean: cleanup,
    improvement: "unknown",
    note: "Pixel changes, smaller seams, less movement and frozen candidates do not establish artistic improvement.",
  };
}
function contact(frames) {
  const width = Math.max(...frames.map((f) => f.width)),
    height = frames.reduce((s, f) => s + f.height, 0),
    data = Buffer.alloc(width * height * 4);
  let y = 0;
  for (const f of frames) {
    for (let row = 0; row < f.height; row++)
      Buffer.from(f.data).copy(
        data,
        (y + row) * width * 4,
        row * f.width * 4,
        (row + 1) * f.width * 4,
      );
    y += f.height;
  }
  return { width, height, data };
}

/** CLI integration seam. All writes land in a new directory; inputs never change. */
export function runCompare({ baseline, candidate, out, alphaClean }, codecs) {
  const requested = resolve(out),
    parent = realpathSync(dirname(requested)),
    output = join(parent, relative(dirname(requested), requested));
  if (existsSync(output)) throw Error("Comparison output already exists");
  const inputs = [resolve(baseline), resolve(candidate)].map((p) =>
    realpathSync(p),
  );
  if (inputs.some((p) => inside(output, p)))
    throw Error("Output overlaps an input");
  const stage = mkdtempSync(join(parent, ".sprite-compare-"));
  const records = [];
  try {
    const a = loadFinalArtifact(baseline, codecs, records),
      b = loadFinalArtifact(candidate, codecs, records);
    const report = compareFinalArtifacts(a, b, {
      alphaClean,
      cleanAlphaHaze: codecs.cleanAlphaHaze,
    });
    report.inputs = {
      baseline: {
        files: a.files,
        pixelSha256: a.pixelSha256,
        ...(a.sheetPixelSha256 ? { sheetPixelSha256: a.sheetPixelSha256 } : {}),
      },
      candidate: {
        files: records.slice(a.files.length),
        pixelSha256: b.pixelSha256,
        ...(b.sheetPixelSha256 ? { sheetPixelSha256: b.sheetPixelSha256 } : {}),
      },
    };
    codecs.writeRgbaPng(
      join(stage, "baseline.png"),
      contact(a.frames),
      "compare baseline",
    );
    codecs.writeRgbaPng(
      join(stage, "candidate.png"),
      contact(b.frames),
      "compare candidate",
    );
    if (!report.changedProtectedProperties.includes("geometry")) {
      const frames = a.frames.map((f, i) => ({
        width: f.width,
        height: f.height,
        data: Buffer.from(
          f.data.map((v, p) =>
            p % 4 === 3 ? 255 : Math.abs(v - b.frames[i].data[p]),
          ),
        ),
      }));
      codecs.writeRgbaPng(
        join(stage, "difference.png"),
        contact(frames),
        "compare difference",
      );
    }
    verify(records);
    writeFileSync(
      join(stage, "comparison.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    mkdirSync(output);
    try {
      renameSync(stage, output);
    } catch (error) {
      try {
        rmdirSync(output);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
      throw error;
    }
    return { ...report, out: output };
  } catch (error) {
    error.inputs = records;
    throw error;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
