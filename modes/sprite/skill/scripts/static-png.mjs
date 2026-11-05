/** Validate the static RGBA8 precision boundary before the codec decodes PNG. */
export function assertStaticPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("PNG signature mismatch");
  if (bytes.length >= 25 && bytes[24] === 16) throw Error("16-bit PNG is unsupported; decoded RGBA8 precision is required");
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    if (type === "acTL") throw Error("Animated PNG is unsupported; provide decoded frames instead");
    at += size + 12;
    if (type === "IEND") break;
  }
}
