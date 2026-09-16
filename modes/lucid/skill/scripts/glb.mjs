#!/usr/bin/env node
/**
 * glb.mjs — read a GLB without starting an engine, and wrap gltf-transform
 * for the operations that need one.
 *
 * `inspect` is the part that has to be ours: before a model goes into a
 * three.js scene the agent needs to know how big it really is, what it costs,
 * and which of the traps an AI-generated or Blender-exported asset usually
 * carries. That answer is a few thousand bytes of container parsing, so it
 * runs with no dependencies, no download and no GPU. Everything that rewrites
 * geometry or pixels (resize / simplify / optimize / unpack) is delegated to
 * `@gltf-transform/cli`, which already does it well; this file only drives it
 * and measures the before/after so a claim of "optimized" carries a number.
 *
 * Zero npm dependencies: Node built-ins only. `npx` is required for the
 * wrapping subcommands, and for nothing else.
 *
 * Every subcommand accepts `--json` (exactly one JSON object on stdout) and
 * `--help`. Without `--json`, stdout is a compact human report. Failures print
 * one `ERROR:` line on stderr and exit 1. Paths are resolved against the
 * current working directory; this script never changes directory.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Pinned so a run months from now decimates the way today's run did. */
const GLTF_TRANSFORM_PACKAGE = "@gltf-transform/cli@4.5.0";

/** A texture past this edge is the memory budget, whatever the triangle count
 *  says: one 4096² RGBA texture is 64 MB of VRAM, a 40k-triangle mesh is ~2. */
const TEXTURE_WARN_SIZE = 2048;

/** How close to 1.0 the longest edge has to be to read as "normalized to one
 *  unit" rather than "happens to be about a metre". */
const UNIT_TOLERANCE = 0.02;

/** The height percentile compared against the full bounding box. */
const THIN_POLE_PERCENTILE = 0.9;

/** Below this share of the total height, the p90 says the bounding box is
 *  being carried by something thin — an antenna, a flagpole, an umbrella. */
const THIN_POLE_RATIO = 0.7;

/** Fewer positions than this and a percentile is noise, not a distribution. */
const MIN_POSITIONS_FOR_HEIGHT = 24;

/** Positions read for the height distribution. Past this the answer does not
 *  change and the read starts to cost real time, so the sample is strided. */
const MAX_SAMPLED_POSITIONS = 200_000;

/** Materials listed individually before the list is truncated. */
const MAX_LISTED_MATERIALS = 32;

/** Characters of a failed tool's stderr that get quoted back. */
const STDERR_TAIL = 2000;

/** Per-role starting ratios for `simplify`. Ours, not the tool's: the number
 *  that works is a property of the surface, and the surface is a property of
 *  what the thing is. Adjust here, in one place. */
const ROLE_RATIOS = {
  character: {
    ratio: 0.35,
    reason: "skin and cloth are smooth continuous surfaces — the silhouette survives losing two thirds of the triangles",
  },
  vehicle: {
    ratio: 0.35,
    reason: "large smooth panels; watch the wheel rims and grille, which are where the error shows first",
  },
  prop: {
    ratio: 0.3,
    reason: "a prop is seen small and rarely up close, so it takes the most aggressive cut on this list",
  },
  building: {
    ratio: 0.45,
    reason: "window mullions and railings are lattices — cutting past half starts eating the openings that read as architecture",
  },
  environment: {
    ratio: 0.5,
    reason: "terrain and rocks simplify well, but an environment is usually the largest mesh, so halve it and measure",
  },
  vegetation: {
    ratio: 0.75,
    reason: "leaf cards and branches are open lattices with almost no redundant vertices — expect the result to stop short of the target",
  },
};

const COMPONENT_TYPES = {
  5120: { name: "BYTE", bytes: 1, array: Int8Array, normalizeDivisor: 127 },
  5121: { name: "UNSIGNED_BYTE", bytes: 1, array: Uint8Array, normalizeDivisor: 255 },
  5122: { name: "SHORT", bytes: 2, array: Int16Array, normalizeDivisor: 32767 },
  5123: { name: "UNSIGNED_SHORT", bytes: 2, array: Uint16Array, normalizeDivisor: 65535 },
  5125: { name: "UNSIGNED_INT", bytes: 4, array: Uint32Array, normalizeDivisor: null },
  5126: { name: "FLOAT", bytes: 4, array: Float32Array, normalizeDivisor: null },
};

const TYPE_COMPONENTS = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

const PRIMITIVE_MODES = {
  0: "POINTS", 1: "LINES", 2: "LINE_LOOP", 3: "LINE_STRIP",
  4: "TRIANGLES", 5: "TRIANGLE_STRIP", 6: "TRIANGLE_FAN",
};

/** glTF is Y-up, so "height" is the Y coordinate. Named, not spelled 1. */
const UP_AXIS = 1;
const AXIS_NAMES = ["x", "y", "z"];

/** Extensions that make the buffers unreadable without a decoder — and that
 *  Blender's importer cannot open at all in the meshopt case. */
const DECODER_EXTENSIONS = ["EXT_meshopt_compression", "KHR_draco_mesh_compression"];

const SUBCOMMANDS = ["inspect", "resize", "simplify", "optimize", "unpack", "ratio-for"];

const USAGE = `Usage: glb.mjs <subcommand> [options]

Read and rewrite GLB 2.0 models. 'inspect' is pure JS (no download, no GPU);
the rewriting subcommands wrap ${GLTF_TRANSFORM_PACKAGE} through npx.
Every subcommand accepts --json (exactly one JSON object on stdout) and --help.
Paths are resolved against the current working directory.

  inspect <glb> [--json]
      Parse the container and report what the model actually is: bytes,
      meshes, primitives, triangles, vertices, nodes, skins/joints,
      animations (name, channels, duration), materials (count, doubleSided,
      metallic/roughness), textures and images (mime and pixel size read from
      the PNG/JPEG/WebP headers), extensionsUsed/Required, the world-space
      bounding box, its size and longest axis, and warnings.

      Warning codes (stable):
        double-sided-all   every material is doubleSided — twice the fragment
                           cost for nothing, usually a Blender export default
        texture-over-${TEXTURE_WARN_SIZE}  an image larger than ${TEXTURE_WARN_SIZE}px on its long edge
        needs-decoder      meshopt/Draco in extensionsRequired: three.js needs
                           the matching decoder and Blender cannot import
                           meshopt at all — run 'unpack' first
        quantized          KHR_mesh_quantization (informational; no decoder
                           needed, this is the compression to prefer)
        no-uv              no TEXCOORD_0: nothing downstream can texture it
        no-materials       no materials at all
        thin-pole-height   the ${THIN_POLE_PERCENTILE * 100}th-percentile vertex height is under
                           ${THIN_POLE_RATIO} of the box height — an antenna or a pole is
                           carrying the bounding box; do not normalize on it
        unit-normalized    longest edge is 1.0 ± ${UNIT_TOLERANCE} — an AI-generated asset
                           normalized to one unit, needing a real scale

      Normalized integer accessors are decoded per the glTF rule (int8/int16/
      uint8/uint16 divided by 127/32767/255/65535), so a quantized model
      reports its real size instead of a bounding box 32767 units tall.

  resize <in> <out> --size 1024 [--json]
      gltf-transform resize --width N --height N. Reports before/after bytes
      and largest texture.

  simplify <in> <out> --ratio R [--error 1] [--json]
      gltf-transform simplify. Reports before/after triangles. A result that
      did not drop is reported as such, not as a failure: a lattice or a
      foliage card has no redundant vertices left to merge.

  optimize <in> <out> [--texture-size 1024] [--simplify-ratio R] [--simplify-error 1] [--json]
      gltf-transform optimize --compress quantize --texture-size N.
      Quantization on purpose: unlike Draco and meshopt it needs no runtime
      decoder, so the scene stays a plain static site. --simplify-ratio opts
      into geometry reduction; without it, simplification is off. With it,
      --simplify-error defaults to 1 (unconstrained) rather than the tool's
      0.0001, which would otherwise stop the decimator long before the ratio.

  unpack <in> <out> [--json]
      gltf-transform copy — decodes meshopt/Draco back to plain buffers so
      Blender can import the model.

  ratio-for --role character|vehicle|prop|building|environment|vegetation [--json]
      Print the recommended 'simplify --ratio' for that kind of surface.

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.`;

const COMMON_OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const OPTIONS = {
  inspect: {},
  resize: { size: { type: "string" } },
  simplify: { ratio: { type: "string" }, error: { type: "string" } },
  optimize: {
    "texture-size": { type: "string" },
    "simplify-ratio": { type: "string" },
    "simplify-error": { type: "string" },
  },
  unpack: {},
  "ratio-for": { role: { type: "string" } },
};

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

/** A refusal this script knows how to phrase, as opposed to a crash. */
class GlbError extends Error {}

function fail(message) {
  throw new GlbError(message);
}

function requirePositional(positionals, index, label) {
  const value = positionals[index];
  if (value === undefined || value === "") fail(`missing ${label}`);
  return value;
}

function requireFlag(value, label) {
  if (value === undefined || value === "") fail(`missing ${label}`);
  return value;
}

function num(value, label, { min = -Infinity, max = Infinity, integer = false, fallback } = {}) {
  if (value === undefined) {
    if (fallback === undefined) fail(`missing ${label}`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${label} must be a number, got '${value}'`);
  if (integer && !Number.isInteger(parsed)) fail(`${label} must be a whole number, got '${value}'`);
  if (parsed < min || parsed > max) fail(`${label} must be between ${min} and ${max}, got ${parsed}`);
  return parsed;
}

function existingFile(pathArg, label) {
  const abs = resolve(pathArg);
  if (!existsSync(abs)) fail(`${label} does not exist: ${pathArg}`);
  if (!statSync(abs).isFile()) fail(`${label} is not a file: ${pathArg}`);
  return abs;
}

function emit(values, payload, humanLines) {
  if (values.json) console.log(JSON.stringify(payload));
  else console.log(humanLines.join("\n"));
}

// ---------------------------------------------------------------------------
// GLB container
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/**
 * Split a `.glb` into its JSON manifest and its binary chunk.
 *
 * Every refusal here names what the file actually is, because "invalid GLB"
 * sends the reader back to a hex editor: a `.gltf` starts with `{`, a zip
 * starts with `PK`, and a glTF 1.0 file is a real format that this parser is
 * simply not written for.
 */
function parseGlbContainer(buffer, label) {
  if (buffer.length < 12) fail(`${label} is ${buffer.length} bytes — too short to be a GLB container`);
  const magic = buffer.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    const head = buffer.subarray(0, 4).toString("latin1");
    if (head.trimStart().startsWith("{")) {
      fail(`${label} starts with JSON — this is a .gltf document, not a .glb container. Convert it first: npx ${GLTF_TRANSFORM_PACKAGE} copy <in.gltf> <out.glb>`);
    }
    fail(`${label} does not start with the GLB magic 'glTF' (found ${JSON.stringify(head)})`);
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) fail(`${label} is GLB version ${version}; only glTF 2.0 (version 2) is supported`);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength > buffer.length) {
    fail(`${label} declares ${declaredLength} bytes but is ${buffer.length} — the file is truncated`);
  }

  let offset = 12;
  let json = null;
  let bin = null;
  const end = Math.min(declaredLength, buffer.length);
  while (offset + 8 <= end) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > end) fail(`${label} has a chunk running past the end of the file — it is truncated`);
    if (chunkType === CHUNK_JSON && json === null) {
      json = buffer.subarray(dataStart, dataEnd).toString("utf-8");
    } else if (chunkType === CHUNK_BIN && bin === null) {
      bin = buffer.subarray(dataStart, dataEnd);
    }
    // Chunks are 4-byte aligned; an unpadded length would desynchronise the walk.
    offset = dataEnd + ((4 - (chunkLength % 4)) % 4);
  }
  if (json === null) fail(`${label} has no JSON chunk`);

  let gltf;
  try {
    gltf = JSON.parse(json);
  } catch (error) {
    fail(`${label} has a JSON chunk that does not parse: ${error.message}`);
  }
  if (!gltf || typeof gltf !== "object") fail(`${label} has a JSON chunk that is not an object`);
  return { gltf, bin, declaredLength };
}

/**
 * Resolve every buffer the document declares. Buffer 0 of a GLB is the BIN
 * chunk; anything else has a URI, which in practice is either inlined base64
 * or a sibling `.bin`. An unresolved buffer is recorded rather than thrown:
 * the counts and the bounding box come from the JSON, and only the height
 * distribution needs the bytes.
 */
function resolveBuffers(gltf, bin, glbDir) {
  const buffers = [];
  const unresolved = [];
  for (const [index, buffer] of (gltf.buffers ?? []).entries()) {
    if (buffer.uri === undefined) {
      buffers.push(index === 0 ? bin : null);
      if (index === 0 && !bin) unresolved.push(`buffer ${index} (no BIN chunk)`);
      continue;
    }
    if (buffer.uri.startsWith("data:")) {
      const comma = buffer.uri.indexOf(",");
      const payload = comma === -1 ? "" : buffer.uri.slice(comma + 1);
      buffers.push(Buffer.from(decodeURIComponent(payload), "base64"));
      continue;
    }
    const sibling = resolve(glbDir, decodeURIComponent(buffer.uri));
    if (existsSync(sibling)) buffers.push(readFileSync(sibling));
    else {
      buffers.push(null);
      unresolved.push(`buffer ${index} (${buffer.uri})`);
    }
  }
  return { buffers, unresolved };
}

/** Bytes of one bufferView, or null when its buffer could not be resolved. */
function bufferViewBytes(gltf, buffers, viewIndex) {
  const view = gltf.bufferViews?.[viewIndex];
  if (!view) return null;
  const source = buffers[view.buffer ?? 0];
  if (!source) return null;
  const start = view.byteOffset ?? 0;
  return source.subarray(start, start + view.byteLength);
}

/**
 * Read an accessor as plain numbers, applying the glTF normalized-integer
 * rule. That rule is the whole reason this function exists: a quantized model
 * whose POSITION is `SHORT`+`normalized` reports a bounding box of ±32767
 * to anyone who reads the raw ints, and is then "fixed" by a scale factor of
 * 1/30000 that has nothing to do with the model.
 *
 * Returns null when the bytes are not available (compressed or missing buffer).
 */
function readAccessor(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) return null;
  const component = COMPONENT_TYPES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!component || !components) return null;
  const count = accessor.count ?? 0;
  const out = new Float64Array(count * components);

  if (accessor.bufferView !== undefined) {
    const view = gltf.bufferViews?.[accessor.bufferView];
    const bytes = bufferViewBytes(gltf, buffers, accessor.bufferView);
    if (!bytes) return null;
    const stride = view?.byteStride ?? component.bytes * components;
    const base = accessor.byteOffset ?? 0;
    for (let i = 0; i < count; i += 1) {
      const elementStart = base + i * stride;
      if (elementStart + component.bytes * components > bytes.length) return null;
      // A typed-array view needs the element start to be aligned to the
      // component size; a byte-level read never does, and a GLB written by an
      // exporter that interleaves attributes routinely breaks that alignment.
      for (let c = 0; c < components; c += 1) {
        out[i * components + c] = readComponent(bytes, elementStart + c * component.bytes, accessor.componentType);
      }
    }
  }

  if (accessor.sparse) {
    const sparse = accessor.sparse;
    const indexBytes = bufferViewBytes(gltf, buffers, sparse.indices?.bufferView);
    const valueBytes = bufferViewBytes(gltf, buffers, sparse.values?.bufferView);
    if (!indexBytes || !valueBytes) return null;
    const indexComponent = COMPONENT_TYPES[sparse.indices.componentType];
    if (!indexComponent) return null;
    const indexBase = sparse.indices.byteOffset ?? 0;
    const valueBase = sparse.values.byteOffset ?? 0;
    for (let i = 0; i < (sparse.count ?? 0); i += 1) {
      const target = readComponent(indexBytes, indexBase + i * indexComponent.bytes, sparse.indices.componentType);
      for (let c = 0; c < components; c += 1) {
        out[target * components + c] = readComponent(
          valueBytes,
          valueBase + (i * components + c) * component.bytes,
          accessor.componentType,
        );
      }
    }
  }

  if (accessor.normalized && component.normalizeDivisor !== null) {
    const divisor = component.normalizeDivisor;
    const signed = accessor.componentType === 5120 || accessor.componentType === 5122;
    for (let i = 0; i < out.length; i += 1) {
      out[i] = signed ? Math.max(out[i] / divisor, -1) : out[i] / divisor;
    }
  }
  return { values: out, count, components };
}

function readComponent(bytes, offset, componentType) {
  switch (componentType) {
    case 5120: return bytes.readInt8(offset);
    case 5121: return bytes.readUInt8(offset);
    case 5122: return bytes.readInt16LE(offset);
    case 5123: return bytes.readUInt16LE(offset);
    case 5125: return bytes.readUInt32LE(offset);
    case 5126: return bytes.readFloatLE(offset);
    default: return 0;
  }
}

/** Apply the normalized rule to an accessor's declared min/max, which are
 *  stored in raw component values exactly like the data they bound. */
function normalizedBounds(accessor, values) {
  if (!Array.isArray(values)) return null;
  const component = COMPONENT_TYPES[accessor.componentType];
  if (!accessor.normalized || !component || component.normalizeDivisor === null) return values.slice();
  const signed = accessor.componentType === 5120 || accessor.componentType === 5122;
  return values.map((v) => (signed ? Math.max(v / component.normalizeDivisor, -1) : v / component.normalizeDivisor));
}

// ---------------------------------------------------------------------------
// Node transforms (column-major, like glTF)
// ---------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** c = a * b, i.e. "apply b, then a". Column-major: m[col * 4 + row]. */
function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** A node's local matrix: the explicit `matrix` when present, otherwise
 *  T * R * S built from the TRS triple. Both are column-major. */
function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/**
 * Every node that the rendered scene actually reaches, with its world matrix.
 *
 * Nodes outside the scene graph are excluded on purpose: a glTF viewer draws
 * the default scene, so an orphan node's mesh is not on screen and must not
 * stretch the bounding box. When the document declares no scene at all,
 * everything that is not somebody's child is treated as a root.
 */
function walkScene(gltf) {
  const nodes = gltf.nodes ?? [];
  const sceneIndex = gltf.scene ?? 0;
  let roots = gltf.scenes?.[sceneIndex]?.nodes;
  if (!Array.isArray(roots)) {
    const children = new Set();
    for (const node of nodes) for (const child of node.children ?? []) children.add(child);
    roots = nodes.map((_, index) => index).filter((index) => !children.has(index));
  }
  const visited = [];
  const seen = new Set();
  const stack = roots.map((index) => ({ index, parent: IDENTITY }));
  while (stack.length) {
    const { index, parent } = stack.pop();
    const node = nodes[index];
    if (!node || seen.has(index)) continue;
    seen.add(index);
    const world = multiplyMatrix(parent, localMatrix(node));
    visited.push({ index, node, world });
    for (const child of node.children ?? []) stack.push({ index: child, parent: world });
  }
  return visited;
}

// ---------------------------------------------------------------------------
// Image headers
// ---------------------------------------------------------------------------

/**
 * Identify an embedded image and read its pixel size straight out of the
 * header. Decoding is not needed and would cost a dependency; every format a
 * glTF may carry states its dimensions in the first few dozen bytes.
 */
function readImageHeader(bytes) {
  if (!bytes || bytes.length < 16) return { mime: null, width: null, height: null };
  if (bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    // IHDR is required to be the first chunk: length, 'IHDR', width, height.
    if (bytes.length >= 24 && bytes.subarray(12, 16).toString("latin1") === "IHDR") {
      return { mime: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    return { mime: "image/png", width: null, height: null };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegSize(bytes);
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return readWebpSize(bytes);
  }
  if (bytes.subarray(0, 4).toString("latin1") === "«KTX") {
    return { mime: "image/ktx2", width: null, height: null };
  }
  return { mime: null, width: null, height: null };
}

/** Walk the JPEG marker chain to the first SOF segment, which carries the
 *  frame size. DHT/DAC/JPG share the 0xC0 block and are not frame headers. */
function readJpegSize(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xff) { offset += 1; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && offset + 9 <= bytes.length) {
      return { mime: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) break; // start of scan: no frame header found before the data
    offset += 2 + length;
  }
  return { mime: "image/jpeg", width: null, height: null };
}

/** WebP keeps the canvas size in whichever of the three sub-formats is present. */
function readWebpSize(bytes) {
  const fourcc = bytes.subarray(12, 16).toString("latin1");
  if (fourcc === "VP8 " && bytes.length >= 30) {
    // 8-byte chunk header, 3-byte frame tag, 3-byte sync code, then 14-bit w/h.
    if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        mime: "image/webp",
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
  }
  if (fourcc === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { mime: "image/webp", width, height };
  }
  return { mime: "image/webp", width: null, height: null };
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Nearest-rank percentile: with a handful of samples, interpolating invents a
 *  value that no vertex has, and this measurement is about where vertices are. */
function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const rank = Math.max(1, Math.ceil(fraction * sortedValues.length));
  return sortedValues[Math.min(rank, sortedValues.length) - 1];
}

function inspectGlb(pathArg) {
  const abs = existingFile(pathArg, "<glb>");
  const label = basename(abs);
  const buffer = readFileSync(abs);
  const { gltf, bin } = parseGlbContainer(buffer, label);
  const { buffers, unresolved } = resolveBuffers(gltf, bin, dirname(abs));
  const notes = [];
  for (const missing of unresolved) notes.push(`could not read ${missing}; measurements that need vertex data are omitted`);

  const extensionsUsed = gltf.extensionsUsed ?? [];
  const extensionsRequired = gltf.extensionsRequired ?? [];
  const decoderExtensions = DECODER_EXTENSIONS.filter((name) => extensionsRequired.includes(name));
  const compressed = decoderExtensions.length > 0;

  // --- geometry ------------------------------------------------------------
  const meshes = gltf.meshes ?? [];
  let primitives = 0;
  let triangles = 0;
  let vertices = 0;
  let hasUv = false;
  const otherModes = {};
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      const mode = primitive.mode ?? 4;
      const positionAccessor = gltf.accessors?.[primitive.attributes?.POSITION];
      const positionCount = positionAccessor?.count ?? 0;
      vertices += positionCount;
      if (primitive.attributes && primitive.attributes.TEXCOORD_0 !== undefined) hasUv = true;
      if (mode === 4) {
        const indexCount = primitive.indices === undefined ? null : gltf.accessors?.[primitive.indices]?.count ?? 0;
        triangles += Math.floor((indexCount ?? positionCount) / 3);
      } else {
        const name = PRIMITIVE_MODES[mode] ?? `MODE_${mode}`;
        otherModes[name] = (otherModes[name] ?? 0) + 1;
      }
    }
  }
  if (Object.keys(otherModes).length) {
    notes.push(`triangle count covers TRIANGLES primitives only; also present: ${Object.entries(otherModes).map(([k, v]) => `${v}x ${k}`).join(", ")}`);
  }

  // --- bounding box and height distribution --------------------------------
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const heights = [];
  let skinnedMeshNodes = 0;
  let positionsUnreadable = false;
  const totalPositions = vertices;
  const stride = Math.max(1, Math.ceil(totalPositions / MAX_SAMPLED_POSITIONS));

  let boundsFromVertices = 0;
  const expand = (point) => {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  };

  for (const { node, world } of walkScene(gltf)) {
    if (node.mesh === undefined) continue;
    if (node.skin !== undefined) skinnedMeshNodes += 1;
    for (const primitive of meshes[node.mesh]?.primitives ?? []) {
      const accessorIndex = primitive.attributes?.POSITION;
      const accessor = gltf.accessors?.[accessorIndex];
      if (!accessor) continue;
      const localMin = normalizedBounds(accessor, accessor.min);
      const localMax = normalizedBounds(accessor, accessor.max);
      const hasDeclaredBounds = Boolean(localMin && localMax && localMin.length === 3 && localMax.length === 3);
      if (hasDeclaredBounds) {
        for (let corner = 0; corner < 8; corner += 1) {
          expand(transformPoint(
            world,
            corner & 1 ? localMax[0] : localMin[0],
            corner & 2 ? localMax[1] : localMin[1],
            corner & 4 ? localMax[2] : localMin[2],
          ));
        }
      }
      if (compressed) { positionsUnreadable = true; continue; }
      const data = readAccessor(gltf, buffers, accessorIndex);
      if (!data || data.components !== 3) { positionsUnreadable = true; continue; }
      // A POSITION accessor without min/max is invalid glTF, and exporters in
      // the AI-asset chain still emit it. Measuring the vertices is slower
      // than reading two arrays, but "bbox unavailable" is not an answer.
      if (!hasDeclaredBounds) boundsFromVertices += 1;
      for (let i = 0; i < data.count; i += stride) {
        const point = transformPoint(world, data.values[i * 3], data.values[i * 3 + 1], data.values[i * 3 + 2]);
        if (!hasDeclaredBounds) expand(point);
        heights.push(point[UP_AXIS]);
      }
    }
  }
  if (boundsFromVertices) {
    notes.push(`${boundsFromVertices} POSITION accessor(s) declare no min/max (invalid glTF); their part of the box was measured from the vertex data${stride > 1 ? `, sampled 1 in ${stride}` : ""}`);
  }
  const hasBbox = Number.isFinite(min[0]) && Number.isFinite(max[0]);
  const size = hasBbox ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : null;
  let longestAxis = null;
  let longestEdge = null;
  if (size) {
    let best = 0;
    for (let axis = 1; axis < 3; axis += 1) if (size[axis] > size[best]) best = axis;
    longestAxis = AXIS_NAMES[best];
    longestEdge = size[best];
  }
  if (skinnedMeshNodes > 0) {
    notes.push(`${skinnedMeshNodes} skinned mesh node(s): the box is the bind pose through the node transform, which an animated pose can exceed`);
  }
  if (positionsUnreadable && !compressed) notes.push("some POSITION data could not be read; the height distribution is partial");

  // --- height distribution -------------------------------------------------
  let heightProfile = null;
  if (size && heights.length >= MIN_POSITIONS_FOR_HEIGHT && size[UP_AXIS] > 0) {
    const sorted = heights.map((y) => y - min[UP_AXIS]).sort((a, b) => a - b);
    heightProfile = {
      samples: sorted.length,
      total: round(size[UP_AXIS]),
      p50: round(percentile(sorted, 0.5)),
      p90: round(percentile(sorted, THIN_POLE_PERCENTILE)),
    };
  }

  // --- materials -----------------------------------------------------------
  const materialList = gltf.materials ?? [];
  const doubleSided = materialList.filter((material) => material.doubleSided === true).length;
  const materials = {
    count: materialList.length,
    doubleSided,
    items: materialList.slice(0, MAX_LISTED_MATERIALS).map((material, index) => {
      const pbr = material.pbrMetallicRoughness ?? {};
      const item = {
        index,
        name: material.name ?? null,
        doubleSided: material.doubleSided === true,
        alphaMode: material.alphaMode ?? "OPAQUE",
      };
      if (pbr.metallicFactor !== undefined) item.metallicFactor = pbr.metallicFactor;
      if (pbr.roughnessFactor !== undefined) item.roughnessFactor = pbr.roughnessFactor;
      return item;
    }),
    truncated: materialList.length > MAX_LISTED_MATERIALS,
  };

  // --- images --------------------------------------------------------------
  const images = (gltf.images ?? []).map((image, index) => {
    let bytes = null;
    let source = "unknown";
    if (image.bufferView !== undefined) {
      bytes = bufferViewBytes(gltf, buffers, image.bufferView);
      source = "bufferView";
    } else if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
      const comma = image.uri.indexOf(",");
      bytes = Buffer.from(comma === -1 ? "" : image.uri.slice(comma + 1), "base64");
      source = "data-uri";
    } else if (typeof image.uri === "string") {
      const sibling = resolve(dirname(abs), decodeURIComponent(image.uri));
      source = "file";
      if (existsSync(sibling)) bytes = readFileSync(sibling);
    }
    const header = readImageHeader(bytes);
    return {
      index,
      name: image.name ?? null,
      source,
      mime: header.mime ?? image.mimeType ?? null,
      width: header.width,
      height: header.height,
      bytes: bytes ? bytes.length : null,
    };
  });

  // --- animations ----------------------------------------------------------
  const animations = (gltf.animations ?? []).map((animation, index) => {
    let duration = 0;
    for (const sampler of animation.samplers ?? []) {
      const accessor = gltf.accessors?.[sampler.input];
      if (!accessor) continue;
      let end = Array.isArray(accessor.max) ? accessor.max[0] : null;
      if (end === null) {
        const data = readAccessor(gltf, buffers, sampler.input);
        if (data && data.count) end = data.values[data.count - 1];
      }
      if (typeof end === "number" && end > duration) duration = end;
    }
    return {
      index,
      name: animation.name ?? null,
      channels: (animation.channels ?? []).length,
      duration: round(duration, 3),
    };
  });

  const skins = gltf.skins ?? [];
  const joints = skins.reduce((sum, skin) => sum + (skin.joints ?? []).length, 0);

  // --- warnings ------------------------------------------------------------
  const warnings = [];
  if (materialList.length > 0 && doubleSided === materialList.length) {
    warnings.push({
      code: "double-sided-all",
      message: `all ${materialList.length} material(s) are doubleSided — every surface is shaded twice. Blender's glTF exporter writes this by default; turn backface culling on unless the model really has one-sided cards.`,
    });
  }
  for (const image of images) {
    const edge = Math.max(image.width ?? 0, image.height ?? 0);
    if (edge > TEXTURE_WARN_SIZE) {
      warnings.push({
        code: "texture-over-2048",
        message: `image ${image.index}${image.name ? ` (${image.name})` : ""} is ${image.width}x${image.height} — textures, not triangles, are the memory budget. Run 'resize --size ${TEXTURE_WARN_SIZE}' (or 1024 for anything that is not the hero).`,
        image: image.index,
        width: image.width,
        height: image.height,
      });
    }
  }
  if (compressed) {
    warnings.push({
      code: "needs-decoder",
      message: `extensionsRequired contains ${decoderExtensions.join(", ")} — three.js needs the matching decoder files and Blender cannot import meshopt at all. Run 'unpack <in> <out>' before anything else.`,
      extensions: decoderExtensions,
    });
  }
  if (extensionsUsed.includes("KHR_mesh_quantization")) {
    warnings.push({
      code: "quantized",
      message: "KHR_mesh_quantization is in use: positions are integers scaled by the node transform. No decoder is needed, but read sizes through the transform, never off the raw accessor.",
    });
  }
  if (primitives > 0 && !hasUv) {
    warnings.push({
      code: "no-uv",
      message: "no TEXCOORD_0 on any primitive — nothing downstream can put a texture on this model. Unwrap it in Blender or accept a flat material.",
    });
  }
  if (materialList.length === 0) {
    warnings.push({ code: "no-materials", message: "no materials: every surface will render with the viewer's default." });
  }
  if (heightProfile && heightProfile.p90 < THIN_POLE_RATIO * heightProfile.total) {
    warnings.push({
      code: "thin-pole-height",
      message: `${THIN_POLE_PERCENTILE * 100}% of the vertices sit below ${heightProfile.p90} of a ${heightProfile.total}-unit box — a pole, antenna or umbrella is carrying the bounding box. Normalize on the body, not on this height.`,
      p90: heightProfile.p90,
      total: heightProfile.total,
    });
  }
  if (longestEdge !== null && Math.abs(longestEdge - 1) <= UNIT_TOLERANCE) {
    warnings.push({
      code: "unit-normalized",
      message: `longest edge is ${round(longestEdge, 3)} — this asset was normalized to one unit and carries no real-world scale. Decide the scale in the scene.`,
      longestEdge: round(longestEdge, 3),
    });
  }

  return {
    ok: true,
    command: "inspect",
    file: pathArg,
    bytes: buffer.length,
    meshes: meshes.length,
    primitives,
    triangles,
    otherModes,
    vertices,
    nodes: (gltf.nodes ?? []).length,
    skins: skins.length,
    joints,
    animations,
    materials,
    textures: (gltf.textures ?? []).length,
    images,
    extensionsUsed,
    extensionsRequired,
    bbox: hasBbox ? { min: min.map((v) => round(v)), max: max.map((v) => round(v)) } : null,
    size: size ? size.map((v) => round(v)) : null,
    longestAxis,
    longestEdge: longestEdge === null ? null : round(longestEdge),
    heightProfile,
    generator: gltf.asset?.generator ?? null,
    warnings,
    notes,
  };
}

function inspectLines(report) {
  const lines = [];
  const kb = (report.bytes / 1024).toFixed(1);
  lines.push(`${report.file}  ${kb} KB`);
  lines.push(`  geometry   ${report.triangles} tris / ${report.vertices} verts / ${report.primitives} primitives in ${report.meshes} meshes, ${report.nodes} nodes`);
  if (report.skins) lines.push(`  rig        ${report.skins} skin(s), ${report.joints} joints`);
  if (report.animations.length) {
    lines.push(`  animation  ${report.animations.map((a) => `${a.name ?? `#${a.index}`} (${a.channels}ch, ${a.duration}s)`).join(", ")}`);
  }
  lines.push(`  materials  ${report.materials.count} (${report.materials.doubleSided} doubleSided)`);
  const largest = report.images.reduce((best, image) => {
    const edge = Math.max(image.width ?? 0, image.height ?? 0);
    return edge > best.edge ? { edge, image } : best;
  }, { edge: 0, image: null });
  lines.push(`  textures   ${report.textures} texture(s), ${report.images.length} image(s)${largest.image ? `, largest ${largest.image.width}x${largest.image.height} ${largest.image.mime ?? "?"}` : ""}`);
  if (report.extensionsUsed.length) {
    lines.push(`  extensions ${report.extensionsUsed.join(", ")}${report.extensionsRequired.length ? ` (required: ${report.extensionsRequired.join(", ")})` : ""}`);
  }
  if (report.bbox) {
    lines.push(`  bbox       min [${report.bbox.min.join(", ")}] max [${report.bbox.max.join(", ")}]`);
    lines.push(`  size       ${report.size.join(" x ")}  longest ${report.longestAxis} = ${report.longestEdge}`);
  } else {
    lines.push("  bbox       unavailable (no POSITION accessor bounds in the scene graph)");
  }
  if (report.heightProfile) {
    lines.push(`  heights    p50 ${report.heightProfile.p50} / p90 ${report.heightProfile.p90} of ${report.heightProfile.total} (${report.heightProfile.samples} samples)`);
  }
  for (const note of report.notes) lines.push(`  note       ${note}`);
  if (report.warnings.length) {
    for (const warning of report.warnings) lines.push(`  ! ${warning.code}: ${warning.message}`);
  } else {
    lines.push("  no warnings");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// gltf-transform wrappers
// ---------------------------------------------------------------------------

/**
 * Run the pinned gltf-transform CLI. The tool is fetched by npx on first use,
 * which is a network call; a missing or failing tool is reported with its own
 * stderr rather than being turned into "no output".
 */
function runGltfTransform(args, label) {
  process.stderr.write(`[gltf-transform] ${args.join(" ")}\n`);
  const result = spawnSync("npx", ["--yes", GLTF_TRANSFORM_PACKAGE, ...args], {
    encoding: "utf-8",
    // npx is a .cmd shim on Windows, which execvp cannot start directly.
    shell: process.platform === "win32",
  });
  if (result.error) {
    fail(`${label}: could not run npx (${result.error.message}). npx ships with npm; install Node.js 22+ and retry.`);
  }
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (result.status !== 0) {
    fail(`${label}: ${GLTF_TRANSFORM_PACKAGE} exited ${result.status}\n${output.slice(-STDERR_TAIL)}`);
  }
  return output;
}

function largestImage(report) {
  return report.images.reduce((best, image) => {
    const edge = Math.max(image.width ?? 0, image.height ?? 0);
    return edge > (best ? Math.max(best.width ?? 0, best.height ?? 0) : 0) ? image : best;
  }, null);
}

function describeImage(image) {
  if (!image) return "none";
  return `${image.width}x${image.height}`;
}

/** Every rewriting subcommand answers the same question — what changed —
 *  so they all measure the input, run the tool, and measure the output. */
function rewrite(inPath, outPath, buildArgs, label) {
  const before = inspectGlb(inPath);
  const absOut = resolve(outPath);
  const log = runGltfTransform(buildArgs(resolve(inPath), absOut), label);
  if (!existsSync(absOut)) {
    fail(`${label}: ${GLTF_TRANSFORM_PACKAGE} exited 0 but wrote no file at ${outPath}\n${log.slice(-STDERR_TAIL)}`);
  }
  const after = inspectGlb(outPath);
  return { before, after };
}

function deltaPayload(command, inPath, outPath, before, after, extra = {}) {
  return {
    ok: true,
    command,
    in: inPath,
    out: outPath,
    before: {
      bytes: before.bytes,
      triangles: before.triangles,
      vertices: before.vertices,
      largestTexture: describeImage(largestImage(before)),
    },
    after: {
      bytes: after.bytes,
      triangles: after.triangles,
      vertices: after.vertices,
      largestTexture: describeImage(largestImage(after)),
    },
    ...extra,
    warnings: after.warnings.map((warning) => warning.code),
  };
}

function percentChange(before, after) {
  if (!before) return "0%";
  const delta = ((after - before) / before) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`ERROR: unknown subcommand '${command}'. Expected one of: ${SUBCOMMANDS.join(", ")}`);
    console.error(USAGE);
    return 1;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: { ...COMMON_OPTIONS, ...OPTIONS[command] },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    fail(`${command}: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "inspect": {
      const report = inspectGlb(requirePositional(positionals, 0, "<glb>"));
      emit(values, report, inspectLines(report));
      break;
    }
    case "resize": {
      const inPath = requirePositional(positionals, 0, "<in>");
      const outPath = requirePositional(positionals, 1, "<out>");
      const size = num(requireFlag(values.size, "--size"), "--size", { integer: true, min: 1, max: 16384 });
      const { before, after } = rewrite(inPath, outPath, (a, b) => [
        "resize", a, b, "--width", String(size), "--height", String(size),
      ], "resize");
      const payload = deltaPayload("resize", inPath, outPath, before, after, { size });
      emit(values, payload, [
        `resize --size ${size}: ${outPath}`,
        `  bytes    ${before.bytes} -> ${after.bytes} (${percentChange(before.bytes, after.bytes)})`,
        `  texture  ${payload.before.largestTexture} -> ${payload.after.largestTexture}`,
      ]);
      break;
    }
    case "simplify": {
      const inPath = requirePositional(positionals, 0, "<in>");
      const outPath = requirePositional(positionals, 1, "<out>");
      const ratio = num(requireFlag(values.ratio, "--ratio"), "--ratio", { min: 0, max: 1 });
      const error = num(values.error, "--error", { min: 0, fallback: 1 });
      const { before, after } = rewrite(inPath, outPath, (a, b) => [
        "simplify", a, b, "--ratio", String(ratio), "--error", String(error),
      ], "simplify");
      const dropped = before.triangles - after.triangles;
      const floored = dropped <= 0;
      const payload = deltaPayload("simplify", inPath, outPath, before, after, { ratio, error, floored });
      emit(values, payload, [
        `simplify --ratio ${ratio} --error ${error}: ${outPath}`,
        `  triangles ${before.triangles} -> ${after.triangles} (${percentChange(before.triangles, after.triangles)})`,
        `  bytes     ${before.bytes} -> ${after.bytes} (${percentChange(before.bytes, after.bytes)})`,
        floored
          ? "  the geometry did not reduce. That is a real state, not a failure: a lattice, a foliage card or an already-welded mesh has no redundant vertices left. Raise --error or accept this count."
          : `  removed ${dropped} triangles`,
      ]);
      break;
    }
    case "optimize": {
      const inPath = requirePositional(positionals, 0, "<in>");
      const outPath = requirePositional(positionals, 1, "<out>");
      const textureSize = num(values["texture-size"], "--texture-size", { integer: true, min: 1, max: 16384, fallback: 1024 });
      const simplifyRatio = values["simplify-ratio"] === undefined
        ? null
        : num(values["simplify-ratio"], "--simplify-ratio", { min: 0, max: 1 });
      const simplifyError = num(values["simplify-error"], "--simplify-error", { min: 0, fallback: 1 });
      const { before, after } = rewrite(inPath, outPath, (a, b) => [
        "optimize", a, b,
        "--compress", "quantize",
        "--texture-size", String(textureSize),
        ...(simplifyRatio === null
          ? ["--simplify", "false"]
          // gltf-transform's own optimize defaults --simplify-error to 0.0001,
          // which halts the decimator long before the requested ratio and
          // makes --simplify-ratio look like it did nothing. Match the
          // 'simplify' subcommand instead: unconstrained unless asked.
          : ["--simplify", "true", "--simplify-ratio", String(simplifyRatio), "--simplify-error", String(simplifyError)]),
      ], "optimize");
      const payload = deltaPayload("optimize", inPath, outPath, before, after, {
        textureSize,
        simplifyRatio,
        simplifyError: simplifyRatio === null ? null : simplifyError,
        floored: simplifyRatio !== null && after.triangles >= before.triangles,
      });
      emit(values, payload, [
        `optimize --compress quantize --texture-size ${textureSize}${simplifyRatio === null ? "" : ` --simplify-ratio ${simplifyRatio} --simplify-error ${simplifyError}`}: ${outPath}`,
        `  bytes     ${before.bytes} -> ${after.bytes} (${percentChange(before.bytes, after.bytes)})`,
        `  triangles ${before.triangles} -> ${after.triangles} (${percentChange(before.triangles, after.triangles)})`,
        `  texture   ${payload.before.largestTexture} -> ${payload.after.largestTexture}`,
        `  extensions required: ${after.extensionsRequired.length ? after.extensionsRequired.join(", ") : "none"} (quantization needs no runtime decoder)`,
        ...(payload.floored
          ? ["  the geometry did not reduce: this mesh has no redundant vertices left to merge."]
          : []),
      ]);
      break;
    }
    case "unpack": {
      const inPath = requirePositional(positionals, 0, "<in>");
      const outPath = requirePositional(positionals, 1, "<out>");
      const { before, after } = rewrite(inPath, outPath, (a, b) => ["copy", a, b], "unpack");
      const payload = deltaPayload("unpack", inPath, outPath, before, after, {
        extensionsRequiredBefore: before.extensionsRequired,
        extensionsRequiredAfter: after.extensionsRequired,
      });
      emit(values, payload, [
        `unpack: ${outPath}`,
        `  bytes     ${before.bytes} -> ${after.bytes} (${percentChange(before.bytes, after.bytes)})`,
        `  required  ${before.extensionsRequired.join(", ") || "none"} -> ${after.extensionsRequired.join(", ") || "none"}`,
      ]);
      break;
    }
    case "ratio-for": {
      const role = requireFlag(values.role, "--role");
      const entry = ROLE_RATIOS[role];
      if (!entry) fail(`unknown --role '${role}'. Expected one of: ${Object.keys(ROLE_RATIOS).join(", ")}`);
      const payload = { ok: true, command: "ratio-for", role, ratio: entry.ratio, reason: entry.reason };
      emit(values, payload, [`${role}: --ratio ${entry.ratio} — ${entry.reason}`]);
      break;
    }
    default:
      fail(`unhandled subcommand '${command}'`);
  }
  return 0;
}

/** Node 22 has no `import.meta.main`, so the entry check is by path. Without
 *  it, importing this module (blender.mjs does, for its convert checklist)
 *  would run the CLI. */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (error instanceof GlbError) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error(`ERROR: unexpected failure: ${error?.message ?? error}`);
      if (error?.stack) console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

export { GlbError, inspectGlb, inspectLines, parseGlbContainer, readImageHeader, ROLE_RATIOS };
