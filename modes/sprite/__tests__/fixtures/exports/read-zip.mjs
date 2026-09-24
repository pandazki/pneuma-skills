/**
 * Read a zip back the way an unzip tool does — from its central directory,
 * cross-checked against each local header — so the PNG-sequence export is
 * verified without a `zip` binary (Windows has none) and without trusting
 * the writer's own bookkeeping.
 */

/** `[{ name, method, crc, size, data }]` in central-directory order. */
export function readZip(buffer) {
  const zip = Buffer.from(buffer);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("readZip: no end-of-central-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  const size = zip.readUInt32LE(eocd + 12);
  let o = zip.readUInt32LE(eocd + 16);
  if (o + size !== eocd) throw new Error("readZip: the central directory does not end where the EOCD begins");
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(o) !== 0x02014b50) throw new Error(`readZip: entry ${i} has no central header`);
    const method = zip.readUInt16LE(o + 10);
    const crc = zip.readUInt32LE(o + 16);
    const compressed = zip.readUInt32LE(o + 20);
    const uncompressed = zip.readUInt32LE(o + 24);
    const nameLength = zip.readUInt16LE(o + 28);
    const extraLength = zip.readUInt16LE(o + 30);
    const commentLength = zip.readUInt16LE(o + 32);
    const local = zip.readUInt32LE(o + 42);
    const name = zip.subarray(o + 46, o + 46 + nameLength).toString("utf8");
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`readZip: ${name} has no local header`);
    const localName = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    if (zip.subarray(local + 30, local + 30 + localName).toString("utf8") !== name) {
      throw new Error(`readZip: ${name}'s local header names another file`);
    }
    const start = local + 30 + localName + localExtra;
    entries.push({
      name, method, crc, size: uncompressed, compressed,
      data: Buffer.from(zip.subarray(start, start + compressed)),
    });
    o += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
