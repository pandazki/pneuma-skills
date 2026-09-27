/**
 * Ground-truth pixel art for the lattice tests, drawn exactly the way
 * aldegad/sprite-gen's own tests draw it (tests/frames/test_pitch_ground_truth.py,
 * test_sliver_guard.py, test_pitch_runlen_crosscheck.py, curate/test_pixel_snap.py
 * @fbd1a08), so the ported assertions run on the SAME pixels upstream's did:
 *
 * - `PyRandom` is CPython's Mersenne Twister (`random.Random(seed)`: seed via
 *   init_by_array, `random()`, `choice`, `randrange` through `_randbelow`).
 *   Checked against CPython 3.14: Random(11) picks the upstream art's first
 *   row [3,4,3,3,4,4,1,1,4,3,5,4,…]; Random(7).random() starts 0.3238327648…
 * - `nearestResize` is Pillow's NEAREST resize, which walks the source with an
 *   ACCUMULATED step (x_in = ⌊0.5·a + a + a + …⌋, a = in/out), not
 *   ⌊(x + 0.5)·a⌋ — the two disagree on 17,337 pixels of the fractional
 *   fixtures, the accumulated form on none (checked against Pillow 12.3).
 *
 * Images are `{ width, height, data }` RGBA, the shape pixel-lattice.mjs takes.
 */

const N = 624;
const M = 397;

/** CPython's `random.Random`, for the members these fixtures use. */
export class PyRandom {
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    // random.seed(int): abs(seed) split into 32-bit words, little end first.
    let n = Math.abs(seed);
    const key = [];
    do {
      key.push(n % 0x100000000);
      n = Math.floor(n / 0x100000000);
    } while (n > 0);
    this.initByArray(key);
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  genrandUint32() {
    const mt = this.mt;
    const mag = (y) => (y & 1 ? 0x9908b0df : 0);
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = (mt[kk + M] ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = (mt[kk + (M - N)] ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      const y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = (mt[M - 1] ^ (y >>> 1) ^ mag(y)) >>> 0;
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) * (1.0 / 9007199254740992);
  }

  getrandbits(k) {
    return this.genrandUint32() >>> (32 - k);
  }

  randbelow(n) {
    const k = Math.floor(Math.log2(n)) + 1;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice(seq) {
    return seq[this.randbelow(seq.length)];
  }

  randrange(start, stop) {
    return start + this.randbelow(stop - start);
  }
}

/** Upstream's six-colour palette for the pitch fixtures. */
export const PALETTE = [
  [240, 210, 175], [60, 40, 30], [40, 90, 180], [230, 225, 200], [150, 90, 50], [20, 20, 20],
];

export function blank(width, height, rgba = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

export function getPixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

export function setPixel(image, x, y, rgba) {
  image.data.set(rgba.length === 3 ? [...rgba, 255] : rgba, (y * image.width + x) * 4);
}

/** Non-periodic random dots (a periodic pattern would make a divisor a real
 *  grid): upstream `_logical_art`. Opaque. */
export function logicalArt(width = 24, height = 40, seed = 11, palette = PALETTE) {
  const rng = new PyRandom(seed);
  const art = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(art, x, y, rng.choice(palette));
  }
  return art;
}

/** Pillow NEAREST resize (accumulated source step — see the header). */
export function nearestResize(image, outW, outH) {
  const table = (nIn, nOut) => {
    const a = nIn / nOut;
    const out = new Int32Array(nOut);
    let pos = a * 0.5;
    for (let i = 0; i < nOut; i++) {
      out[i] = Math.trunc(pos);
      pos += a;
    }
    return out;
  };
  const xs = table(image.width, outW);
  const ys = table(image.height, outH);
  const out = blank(outW, outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const s = (ys[y] * image.width + xs[x]) * 4;
      out.data.set(image.data.subarray(s, s + 4), (y * outW + x) * 4);
    }
  }
  return out;
}

/** Python's round(): half to even. */
export function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Whole-number upscale, k x k per pixel. */
export function upscaleBy(image, kx, ky = kx) {
  return nearestResize(image, image.width * kx, image.height * ky);
}

/** Upstream `_upscaled`: a block width that is not a whole number of pixels,
 *  colours untouched (x64 first, then NEAREST down to the fractional size). */
export function upscaledFractional(art, scale) {
  const big = upscaleBy(art, 64);
  return nearestResize(big, pyRound(art.width * scale), pyRound(art.height * scale));
}

/** Upstream `_upscale_axes`: a different fractional scale per axis. */
export function upscaledAxes(art, sx, sy) {
  const big = upscaleBy(art, 64);
  return nearestResize(big, pyRound(art.width * sx), pyRound(art.height * sy));
}

export function crop(image, x, y, w, h) {
  const out = blank(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/** Paste with full replacement (no blending). */
export function paste(canvas, sprite, x, y) {
  for (let row = 0; row < sprite.height; row++) {
    for (let col = 0; col < sprite.width; col++) {
      const tx = x + col, ty = y + row;
      if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
      const s = (row * sprite.width + col) * 4;
      canvas.data.set(sprite.data.subarray(s, s + 4), (ty * canvas.width + tx) * 4);
    }
  }
  return canvas;
}

/** Pixels whose RGB differs (upstream `_mismatch`, which compares RGB only). */
export function mismatch(a, b) {
  let bad = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      if (a.data[i] !== b.data[j] || a.data[i + 1] !== b.data[j + 1] || a.data[i + 2] !== b.data[j + 2]) bad++;
    }
  }
  return bad;
}

/** Deterministic uniform noise (a photo-like input with no grid). */
export function noiseImage(width, height, seed) {
  const rng = new PyRandom(seed);
  const img = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(img, x, y, [rng.randrange(0, 256), rng.randrange(0, 256), rng.randrange(0, 256)]);
  }
  return img;
}
