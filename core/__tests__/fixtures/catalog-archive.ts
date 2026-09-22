/**
 * Real `.tar.gz` mode archives for the catalog tests.
 *
 * Shared by the installer tests, the route tests and the resolver's flow
 * test so all three agree on what a published archive looks like — one
 * authority for the fixture, the way `modes/distribution.json` is one
 * authority for the bundled set.
 *
 * Two builders, because they answer different questions.
 * {@link buildModeArchive} packs a real directory with the system `tar`, so
 * an honest archive is built the way the publisher builds one.
 * {@link buildHostileModeArchive} writes the tar blocks itself, because the
 * members that matter for containment — an absolute name, a `..` name, a
 * symlink or a hard link pointing anywhere the test chooses — are exactly
 * the ones `tar` refuses to create from a real tree. Both produce bytes a
 * real `tar` reads; neither ever names a path outside the caller's own
 * temporary directories, so a regression in the installer can only damage
 * the fixture the test just made.
 *
 * Not a test file (bun only collects `*.test.ts`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MODE_CATALOG_FORMAT,
  MODE_PACKAGE_STAMP,
  type ModePackageStamp,
} from "../../types/mode-catalog.js";

export interface BuildArchiveOptions {
  /** Mode name — also the directory name inside a nested archive. */
  name: string;
  /** Mode manifest version; the stamp and the catalog entry must agree. */
  version: string;
  /** The core release that built it. */
  coreVersion: string;
  /**
   * `nested` mirrors the package (`modes/<name>/…` plus the stamp at the
   * archive root); `flat` packs the mode directory's own contents with the
   * stamp beside its manifest. The installer normalizes both.
   */
  layout?: "nested" | "flat";
  /** Written to `marker.txt` so a test can tell two builds apart. */
  marker?: string;
  /** `null` builds an archive with no package stamp. */
  stamp?: Record<string, unknown> | null;
}

export function sha256Hex(bytes: Uint8Array<ArrayBuffer>): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function buildModeArchive(opts: BuildArchiveOptions): Uint8Array<ArrayBuffer> {
  const { name, version, coreVersion } = opts;
  const layout = opts.layout ?? "nested";
  const marker = opts.marker ?? version;

  const work = mkdtempSync(join(tmpdir(), "pneuma-mode-archive-"));
  const modeDir = layout === "nested" ? join(work, "modes", name) : join(work, "mode");
  mkdirSync(join(modeDir, "seed"), { recursive: true });
  writeFileSync(
    join(modeDir, "manifest.ts"),
    `const manifest = { name: "${name}", version: "${version}" };\nexport default manifest;\n`,
  );
  writeFileSync(join(modeDir, "seed", "README.md"), `# ${marker}\n`);
  writeFileSync(join(modeDir, "marker.txt"), marker);

  const stamp =
    opts.stamp === null
      ? null
      : (opts.stamp ?? {
          formatVersion: MODE_CATALOG_FORMAT,
          name,
          version,
          coreVersion,
          builtAt: "2026-09-22T00:00:00.000Z",
        });
  if (stamp) {
    writeFileSync(
      join(layout === "nested" ? work : modeDir, MODE_PACKAGE_STAMP),
      JSON.stringify(stamp, null, 2),
    );
  }

  const out = join(work, "out.tar.gz");
  const args =
    layout === "nested"
      ? ["tar", "czf", out, "-C", work, "modes", ...(stamp ? [MODE_PACKAGE_STAMP] : [])]
      : ["tar", "czf", out, "-C", modeDir, "."];
  const proc = Bun.spawnSync(args);
  if (proc.exitCode !== 0) {
    throw new Error(`tar failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(work, { recursive: true, force: true });
  return bytes;
}

// ── Hostile archives ─────────────────────────────────────────────────────────

/**
 * One member of a hand-built archive. `target` is a link target verbatim —
 * tests point it at their own temp files, never at anything on the machine.
 */
export type HostileMember =
  | { path: string; kind: "file"; content?: string }
  | { path: string; kind: "symlink"; target: string }
  | { path: string; kind: "hardlink"; target: string };

export interface HostileArchiveOptions {
  name: string;
  version: string;
  coreVersion: string;
  /** Appended after a minimal but honest `modes/<name>/` tree and its stamp. */
  members: HostileMember[];
}

/**
 * A `.tar.gz` that is a valid mode package plus the given members, written
 * block by block so member names and link targets are whatever the test
 * says — `tar czf` normalizes away `..`, absolute names and cross-tree
 * links, which are the cases worth pinning.
 */
export function buildHostileModeArchive(
  opts: HostileArchiveOptions,
): Uint8Array<ArrayBuffer> {
  const { name, version, coreVersion } = opts;
  const stamp: ModePackageStamp = {
    formatVersion: MODE_CATALOG_FORMAT,
    name,
    version,
    coreVersion,
    builtAt: "2026-09-22T00:00:00.000Z",
  };

  const blocks: Uint8Array[] = [
    ...tarEntry({ path: `modes/${name}/`, typeflag: "5" }),
    ...tarEntry({
      path: `modes/${name}/manifest.ts`,
      typeflag: "0",
      body: `const manifest = { name: "${name}", version: "${version}" };\nexport default manifest;\n`,
    }),
    ...tarEntry({
      path: MODE_PACKAGE_STAMP,
      typeflag: "0",
      body: `${JSON.stringify(stamp, null, 2)}\n`,
    }),
  ];
  for (const member of opts.members) {
    if (member.kind === "file") {
      blocks.push(...tarEntry({ path: member.path, typeflag: "0", body: member.content ?? "x\n" }));
    } else {
      blocks.push(
        ...tarEntry({
          path: member.path,
          typeflag: member.kind === "symlink" ? "2" : "1",
          linkname: member.target,
        }),
      );
    }
  }
  // Two zero blocks end a tar stream.
  blocks.push(new Uint8Array(BLOCK * 2));

  return Bun.gzipSync(concat(blocks));
}

const BLOCK = 512;

/** Header (+ padded body) blocks for one ustar member. */
function tarEntry(entry: {
  path: string;
  typeflag: "0" | "1" | "2" | "5";
  linkname?: string;
  body?: string;
}): Uint8Array[] {
  const body = new TextEncoder().encode(entry.body ?? "");
  const header = new Uint8Array(BLOCK);
  const put = (text: string, offset: number, width: number): void => {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > width) throw new Error(`fixture field too long: ${text}`);
    header.set(bytes, offset);
  };
  const octal = (value: number, width: number): string =>
    value.toString(8).padStart(width - 1, "0");

  put(entry.path, 0, 100);
  put(octal(entry.typeflag === "5" ? 0o755 : 0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8); // uid
  put(octal(0, 8), 116, 8); // gid
  put(octal(body.length, 12), 124, 12);
  put(octal(0, 12), 136, 12); // mtime — fixed, so the bytes are reproducible
  put("        ", 148, 8); // checksum placeholder: eight spaces
  put(entry.typeflag, 156, 1);
  if (entry.linkname) put(entry.linkname, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);

  // Checksum of the header with its own field read as eight spaces, stored
  // the way every tar writes it: six octal digits, NUL, space.
  let sum = 0;
  for (const byte of header) sum += byte;
  put(`${octal(sum, 7)}\0 `, 148, 8);

  const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
  return body.length > 0
    ? [header, body, new Uint8Array(padding)]
    : [header];
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
