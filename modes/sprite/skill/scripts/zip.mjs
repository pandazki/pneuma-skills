/**
 * zip.mjs — a zero-dependency, store-only zip writer.
 *
 * The PNG sequence export ships as one zip. PNG is already compressed, so
 * deflating it again buys almost nothing; every entry is STORED (method 0),
 * which keeps this to a CRC-32 and three fixed-layout records. It is written
 * here rather than shelled out to `zip` because Windows has no `zip`, and a
 * pipeline that works on one OS and not another is a pipeline the agent
 * cannot trust.
 *
 * Limits are the classic zip ones, refused rather than silently corrupted:
 * under 65,535 entries and 4 GiB. A sprite export is at most 400 frames.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum zip stores for every entry. */
export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only clock a plain zip header has. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8_NAMES = 0x0800;
/** Version 2.0: what a stored entry with a directory in its name needs. */
const VERSION = 20;

/**
 * A zip holding `files` (`[{ name, data }]`) in order, every entry stored.
 *
 * `name` is the path inside the archive, `/`-separated. A name that is
 * absolute or climbs out with `..` is refused: an archive this pipeline hands
 * a user must not be able to write outside the folder they unzip it into.
 */
export function zipStore(files, { date = new Date() } = {}) {
  if (files.length > MAX_ENTRIES) throw new Error(`zip: ${files.length} entries is over the ${MAX_ENTRIES} a plain zip can hold`);
  const stamp = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = String(file.name);
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "")) {
      throw new Error(`zip: entry name '${name}' is not a relative path inside the archive`);
    }
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(file.data);
    const crc = crc32(data);
    if (data.length > MAX_BYTES || offset > MAX_BYTES) throw new Error("zip: over 4 GiB needs zip64, which this writer does not do");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // Made by: Unix (3), spec 2.0 — so the external attributes below read as
    // a regular file, 0644, when an unzip tool restores permissions.
    central.writeUInt16LE((3 << 8) | VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  if (offset > MAX_BYTES || centralSize > MAX_BYTES) throw new Error("zip: over 4 GiB needs zip64, which this writer does not do");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
