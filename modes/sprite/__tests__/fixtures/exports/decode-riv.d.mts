/**
 * Types for `decode-riv.mjs` — same convention as `../pipeline/make-sheet.d.mts`:
 * the helper stays plain ESM, the declaration keeps `tsc --noEmit` honest.
 */

export interface RiveObject {
  type: string;
  typeKey: number;
  /** Short field name → value. Strings are strings, bytes are Buffers. */
  props: Record<string, number | string | Buffer>;
}

export interface DecodedRiv {
  fingerprint: string;
  major: number;
  minor: number;
  fileId: number;
  toc: number[];
  objects: RiveObject[];
}

export declare const RIVE_TYPES: Map<number, string>;
export declare const RIVE_PROPERTIES: Map<number, [string, string]>;
export declare function decodeRiv(buffer: Uint8Array): DecodedRiv;
