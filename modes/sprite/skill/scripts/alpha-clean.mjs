/** Original-mask alpha cleanup, adapted from aldegad/sprite-gen alpha_floor.py
 * (Apache-2.0), 4f5ccd55c7cf06685a41f954acc1e476b7772ece.
 * The ceiling is inclusive; upstream's floor is maxAlpha + 1.
 */
export function alphaProtectionMask(image, { maxAlpha, keepEdge }) {
  if (!Number.isInteger(maxAlpha) || maxAlpha < 0 || maxAlpha > 254) throw new Error("maxAlpha must be an integer between 0 and 254");
  if (!Number.isInteger(keepEdge) || keepEdge < 0 || keepEdge > 64) throw new Error("keepEdge must be an integer between 0 and 64");
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) throw new Error("expected nonempty RGBA image");
  const across = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  let strongerSupportPixels = 0;
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, keepEdge); x++) if (data[(y * width + x) * 4 + 3] > maxAlpha) count++;
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > maxAlpha) strongerSupportPixels++;
      across[y * width + x] = count > 0 ? 1 : 0;
      if (x - keepEdge >= 0 && data[(y * width + x - keepEdge) * 4 + 3] > maxAlpha) count--;
      if (x + keepEdge + 1 < width && data[(y * width + x + keepEdge + 1) * 4 + 3] > maxAlpha) count++;
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, keepEdge); y++) count += across[y * width + x];
    for (let y = 0; y < height; y++) {
      mask[y * width + x] = count > 0 ? 1 : 0;
      if (y - keepEdge >= 0) count -= across[(y - keepEdge) * width + x];
      if (y + keepEdge + 1 < height) count += across[(y + keepEdge + 1) * width + x];
    }
  }
  return { mask, strongerSupportPixels };
}

export function cleanAlphaHaze(image, options) {
  const { mask, strongerSupportPixels } = alphaProtectionMask(image, options);
  const data = new Uint8Array(image.data);
  let removedPixels = 0;
  let protectedPixels = 0;
  let faintPixels = 0;
  let minX = image.width; let minY = image.height; let maxX = -1; let maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) protectedPixels++;
    const alpha = data[i * 4 + 3];
    if (alpha > 0 && alpha <= options.maxAlpha) {
      faintPixels++;
      if (strongerSupportPixels && !mask[i]) {
        data.fill(0, i * 4, i * 4 + 4);
        removedPixels++;
        const x = i % image.width; const y = Math.floor(i / image.width);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    image: { width: image.width, height: image.height, data },
    report: {
      ...options, distance: "chebyshev", pixels: mask.length, strongerSupportPixels, protectedPixels, faintPixels,
      removedPixels, changedStrongerSupportPixels: 0, changedProtectedPixels: 0,
      bounds: removedPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
      skipped: strongerSupportPixels ? null : "no-stronger-support",
      applicability: "user-requested", artisticQuality: "unknown",
    },
  };
}
