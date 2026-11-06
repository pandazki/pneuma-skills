/**
 * Types for `zip.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export declare function crc32(data: Uint8Array): number;

export interface ZipEntry {
  /** Relative, `/`-separated path inside the archive. */
  name: string;
  data: Uint8Array;
}

export declare function zipStore(files: ZipEntry[], options?: { date?: Date }): Buffer;
