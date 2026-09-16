/**
 * make-glb.mjs — every GLB the lucid suites need, written in code at test time.
 *
 * No binary blobs live in the repository: a fixture whose bytes nobody can
 * read is a fixture nobody can change. Each file here is a real glTF 2.0
 * container — magic, JSON chunk, BIN chunk, aligned buffer views, accessor
 * min/max — assembled from plain options, so a test can say "an unindexed mesh
 * with no UVs" and get exactly that.
 *
 * Images are written from scratch too. The PNGs are genuine (zlib-deflated
 * scanlines, correct CRCs); the JPEG and WebP helpers write HEADERS ONLY —
 * enough bytes for a header reader to identify the format and its pixel size,
 * and deliberately not a decodable image. They exist to pin
 * `glb.mjs inspect`'s header parsing for the two formats a Blender or Tripo
 * export can carry.
 *
 * Node built-ins only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFrom(width, height, colorType, bytesPerPixel, fillScanline) {
  const rowBytes = width * bytesPerPixel;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (rowBytes + 1);
    raw[start] = 0; // filter type 0 (None)
    fillScanline(raw, start + 1, y, rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A real RGBA PNG. `pixels` is row-major RGBA bytes; when it is omitted the
 * image is a magenta/teal checker so a viewer can tell it apart from nothing.
 */
export function rgbaPng(width, height, pixels) {
  const source = pixels ?? defaultChecker(width, height);
  return pngFrom(width, height, 6, 4, (raw, at, y, rowBytes) => {
    source.copy(raw, at, y * rowBytes, (y + 1) * rowBytes);
  });
}

function defaultChecker(width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const light = (x + y) % 2 === 0;
      out[at] = light ? 0xe0 : 0x20;
      out[at + 1] = light ? 0x30 : 0xc0;
      out[at + 2] = light ? 0xa0 : 0xb0;
      out[at + 3] = 0xff;
    }
  }
  return out;
}

/**
 * A grayscale PNG of solid black. One byte per pixel and a scanline that
 * deflates to nothing, which is what makes a 4096x4096 "oversized texture"
 * fixture cost milliseconds instead of a second.
 */
export function grayPng(width, height) {
  return pngFrom(width, height, 0, 1, () => {});
}

// ---------------------------------------------------------------------------
// Header-only JPEG / WebP
// ---------------------------------------------------------------------------

/**
 * SOI + JFIF APP0 + a baseline SOF0 frame header + EOI. Everything a header
 * reader needs and no entropy-coded data at all: this is NOT a decodable
 * image, and exists only to pin the JPEG branch of the size reader.
 */
export function jpegHeaderOnly(width, height) {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const sof0 = Buffer.alloc(21);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2); // segment length
  sof0[4] = 8; // sample precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // component count
  for (let c = 0; c < 3; c += 1) {
    sof0[10 + c * 3] = c + 1;
    sof0[11 + c * 3] = 0x11;
    sof0[12 + c * 3] = c === 0 ? 0 : 1;
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.from([0xff, 0xd9])]);
}

function riff(fourcc, payload) {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(4 + 8 + payload.length, 4);
  header.write("WEBP", 8, "latin1");
  const chunk = Buffer.alloc(8);
  chunk.write(fourcc, 0, "latin1");
  chunk.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, chunk, payload]);
}

/**
 * A WebP container carrying only the bytes that state the canvas size, in one
 * of the three sub-formats a real file can use. Header-only, like the JPEG.
 *
 * @param {"vp8"|"vp8l"|"vp8x"} variant
 */
export function webpHeaderOnly(width, height, variant = "vp8l") {
  if (variant === "vp8") {
    // payload[0..2] frame tag, payload[3..5] sync code, then 14-bit w/h.
    const payload = Buffer.alloc(10);
    payload[0] = 0x30; payload[1] = 0x01; payload[2] = 0x00;
    payload[3] = 0x9d; payload[4] = 0x01; payload[5] = 0x2a;
    payload.writeUInt16LE(width & 0x3fff, 6);
    payload.writeUInt16LE(height & 0x3fff, 8);
    return riff("VP8 ", payload);
  }
  if (variant === "vp8x") {
    const payload = Buffer.alloc(10);
    payload[0] = 0x00; // flags
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
    return riff("VP8X", payload);
  }
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f; // VP8L signature byte
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  payload.writeUInt32LE(bits >>> 0, 1);
  return riff("VP8L", payload);
}

/** @param {{kind: string, width: number, height: number}} spec */
function imageBytes(spec) {
  switch (spec.kind) {
    case "png": return { bytes: rgbaPng(spec.width, spec.height), mimeType: "image/png" };
    case "gray-png": return { bytes: grayPng(spec.width, spec.height), mimeType: "image/png" };
    case "jpeg": return { bytes: jpegHeaderOnly(spec.width, spec.height), mimeType: "image/jpeg" };
    case "webp-vp8": return { bytes: webpHeaderOnly(spec.width, spec.height, "vp8"), mimeType: "image/webp" };
    case "webp-vp8l": return { bytes: webpHeaderOnly(spec.width, spec.height, "vp8l"), mimeType: "image/webp" };
    case "webp-vp8x": return { bytes: webpHeaderOnly(spec.width, spec.height, "vp8x"), mimeType: "image/webp" };
    default: throw new Error(`make-glb: unknown image kind '${spec.kind}'`);
  }
}

// ---------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

function padTo4(length) {
  return (4 - (length % 4)) % 4;
}

/** One triangle in the XY plane, a unit on each side. */
export const UNIT_TRIANGLE = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

/**
 * A welded, gently displaced grid — the shape a decimator can actually work
 * on. `buildGlb`'s default index buffer is sequential (every triangle owns its
 * three vertices), and an unwelded mesh has nothing for meshoptimizer to
 * collapse, so a simplify fixture has to bring its own shared indices.
 */
export function gridMesh({ segments = 24, amplitude = 0.35 } = {}) {
  const positions = [];
  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const u = col / segments;
      const v = row / segments;
      positions.push([
        u * 2 - 1,
        Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2) * amplitude,
        v * 2 - 1,
      ]);
    }
  }
  const indices = [];
  const stride = segments + 1;
  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = row * stride + col;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  return { positions, indices };
}

/**
 * A body of `bodyCount` vertices spread over the bottom `bodyHeight` of the
 * model plus `poleCount` vertices at `poleHeight` — the shape that makes a
 * bounding box lie about how tall the thing reads.
 */
export function thinPolePositions({ bodyCount = 40, bodyHeight = 0.3, poleCount = 4, poleHeight = 2 } = {}) {
  const positions = [];
  for (let i = 0; i < bodyCount; i += 1) {
    const t = i / Math.max(1, bodyCount - 1);
    positions.push([Math.cos(t * Math.PI * 2) * 0.4, t * bodyHeight, Math.sin(t * Math.PI * 2) * 0.4]);
  }
  for (let i = 0; i < poleCount; i += 1) {
    positions.push([0.01 * i, bodyHeight + ((i + 1) / poleCount) * (poleHeight - bodyHeight), 0]);
  }
  return positions;
}

/**
 * Write one GLB.
 *
 * @param {string} outPath
 * @param {object} [options]
 * @returns {string} outPath
 */
export function buildGlb(outPath, options = {}) {
  const {
    positions = UNIT_TRIANGLE,
    indexed = true,
    indices = null,
    uv = true,
    material = true,
    doubleSided = false,
    positionEncoding = "float",
    omitBounds = false,
    images = [{ kind: "png", width: 2, height: 2 }],
    node = { translation: [5, 0, 0], scale: [2, 3, 1] },
    mode,
    extensionsUsed = [],
    extensionsRequired = [],
    animation = false,
    skin = false,
    generator = "lucid make-glb fixture",
  } = options;

  const views = [];
  const binParts = [];
  let binLength = 0;

  const addView = (data, target, byteStride) => {
    const pad = padTo4(binLength);
    if (pad) { binParts.push(Buffer.alloc(pad)); binLength += pad; }
    const view = { buffer: 0, byteOffset: binLength, byteLength: data.length };
    if (target !== undefined) view.target = target;
    if (byteStride !== undefined) view.byteStride = byteStride;
    views.push(view);
    binParts.push(data);
    binLength += data.length;
    return views.length - 1;
  };

  const accessors = [];
  const addAccessor = (accessor) => { accessors.push(accessor); return accessors.length - 1; };

  // --- POSITION ------------------------------------------------------------
  const count = positions.length;
  const rawMin = [Infinity, Infinity, Infinity];
  const rawMax = [-Infinity, -Infinity, -Infinity];
  let positionAccessor;
  if (positionEncoding === "int16n") {
    const data = Buffer.alloc(count * 3 * 2);
    positions.forEach((p, i) => {
      p.forEach((v, axis) => {
        if (v < -1 || v > 1) throw new Error("make-glb: int16n positions must sit inside [-1, 1]");
        const quantized = Math.round(v * 32767);
        data.writeInt16LE(quantized, (i * 3 + axis) * 2);
        if (quantized < rawMin[axis]) rawMin[axis] = quantized;
        if (quantized > rawMax[axis]) rawMax[axis] = quantized;
      });
    });
    const view = addView(data, ARRAY_BUFFER);
    positionAccessor = addAccessor({
      bufferView: view, componentType: 5122, normalized: true, count, type: "VEC3",
      ...(omitBounds ? {} : { min: rawMin, max: rawMax }),
    });
  } else {
    const data = Buffer.alloc(count * 3 * 4);
    positions.forEach((p, i) => {
      p.forEach((v, axis) => {
        data.writeFloatLE(v, (i * 3 + axis) * 4);
        if (v < rawMin[axis]) rawMin[axis] = v;
        if (v > rawMax[axis]) rawMax[axis] = v;
      });
    });
    const view = addView(data, ARRAY_BUFFER);
    positionAccessor = addAccessor({
      bufferView: view, componentType: 5126, count, type: "VEC3",
      ...(omitBounds ? {} : { min: rawMin, max: rawMax }),
    });
  }

  const attributes = { POSITION: positionAccessor };

  if (uv) {
    const data = Buffer.alloc(count * 2 * 4);
    positions.forEach((_, i) => {
      data.writeFloatLE((i % 2) === 0 ? 0 : 1, i * 8);
      data.writeFloatLE(i < count / 2 ? 0 : 1, i * 8 + 4);
    });
    attributes.TEXCOORD_0 = addAccessor({
      bufferView: addView(data, ARRAY_BUFFER), componentType: 5126, count, type: "VEC2",
    });
  }

  const primitive = { attributes };
  if (mode !== undefined) primitive.mode = mode;

  if (indexed || indices) {
    const list = indices ?? Array.from({ length: Math.floor(count / 3) * 3 }, (_, i) => i);
    if (list.some((i) => i >= 65536)) throw new Error("make-glb: index buffers are UNSIGNED_SHORT; keep fixtures under 65536 vertices");
    const data = Buffer.alloc(list.length * 2);
    list.forEach((value, i) => data.writeUInt16LE(value, i * 2));
    primitive.indices = addAccessor({
      bufferView: addView(data, ELEMENT_ARRAY_BUFFER), componentType: 5123,
      count: list.length, type: "SCALAR",
    });
  }

  // --- textures and material ----------------------------------------------
  const gltfImages = [];
  const gltfTextures = [];
  for (const [index, spec] of images.entries()) {
    const { bytes, mimeType } = imageBytes(spec);
    gltfImages.push({ name: `image-${index}`, bufferView: addView(bytes), mimeType });
    gltfTextures.push({ source: index, sampler: 0 });
  }

  const gltfMaterials = [];
  if (material) {
    const pbr = { baseColorFactor: [0.8, 0.8, 0.85, 1], metallicFactor: 0.1, roughnessFactor: 0.6 };
    if (gltfTextures.length) pbr.baseColorTexture = { index: 0 };
    gltfMaterials.push({ name: "surface", pbrMetallicRoughness: pbr, doubleSided });
    primitive.material = 0;
  }

  // --- nodes, skin, animation ---------------------------------------------
  const nodes = [{ name: "mesh-node", mesh: 0, ...node }];
  const sceneNodes = [0];

  let gltfSkins = null;
  if (skin) {
    const inverseBind = Buffer.alloc(16 * 4);
    [0, 5, 10, 15].forEach((slot) => inverseBind.writeFloatLE(1, slot * 4));
    nodes.push({ name: "joint-0", translation: [0, 0, 0] });
    sceneNodes.push(1);
    nodes[0].skin = 0;
    gltfSkins = [{
      joints: [1],
      inverseBindMatrices: addAccessor({
        bufferView: addView(inverseBind), componentType: 5126, count: 1, type: "MAT4",
      }),
    }];
  }

  const animationTargetNode = skin ? 1 : nodes.length;
  const gltfAnimations = [];
  if (animation) {
    if (!skin) {
      nodes.push({ name: "animated", translation: [0, 0, 0] });
      sceneNodes.push(animationTargetNode);
    }
    const times = Buffer.alloc(8);
    times.writeFloatLE(0, 0);
    times.writeFloatLE(1, 4);
    const input = addAccessor({
      bufferView: addView(times), componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1],
    });
    const values = Buffer.alloc(24);
    values.writeFloatLE(1, 12); // second keyframe translates by one unit in x
    const output = addAccessor({
      bufferView: addView(values), componentType: 5126, count: 2, type: "VEC3",
    });
    gltfAnimations.push({
      name: "drift",
      samplers: [{ input, output, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: animationTargetNode, path: "translation" } }],
    });
  }

  const gltf = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes: [{ name: "mesh", primitives: [primitive] }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: binLength }],
  };
  if (gltfMaterials.length) gltf.materials = gltfMaterials;
  if (gltfImages.length) {
    gltf.images = gltfImages;
    gltf.textures = gltfTextures;
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987 }];
  }
  if (gltfSkins) gltf.skins = gltfSkins;
  if (gltfAnimations.length) gltf.animations = gltfAnimations;
  if (extensionsUsed.length) gltf.extensionsUsed = extensionsUsed;
  if (extensionsRequired.length) gltf.extensionsRequired = extensionsRequired;

  return writeGlbFile(outPath, gltf, Buffer.concat(binParts));
}

/** Assemble a GLB container from an already-built JSON document and BIN blob. */
export function writeGlbFile(outPath, gltf, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(gltf), "utf-8");
  const jsonPad = Buffer.alloc(padTo4(jsonBytes.length), 0x20); // chunks pad with spaces
  const binPad = Buffer.alloc(padTo4(bin.length), 0x00);
  const jsonChunk = Buffer.concat([chunkHeader(jsonBytes.length + jsonPad.length, CHUNK_JSON), jsonBytes, jsonPad]);
  const binChunk = bin.length
    ? Buffer.concat([chunkHeader(bin.length + binPad.length, CHUNK_BIN), bin, binPad])
    : Buffer.alloc(0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([header, jsonChunk, binChunk]));
  return outPath;
}

function chunkHeader(length, type) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(length, 0);
  header.writeUInt32LE(type, 4);
  return header;
}
