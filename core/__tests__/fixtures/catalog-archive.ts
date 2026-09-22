/**
 * Real `.tar.gz` mode archives for the catalog tests.
 *
 * Shared by the installer tests, the route tests and the resolver's flow
 * test so all three agree on what a published archive looks like — one
 * authority for the fixture, the way `modes/distribution.json` is one
 * authority for the bundled set.
 *
 * Not a test file (bun only collects `*.test.ts`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MODE_CATALOG_FORMAT,
  MODE_PACKAGE_STAMP,
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
