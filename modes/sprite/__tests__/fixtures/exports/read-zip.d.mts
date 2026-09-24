/** Types for `read-zip.mjs`. */

export interface ZipEntryRead {
  name: string;
  /** 0 = stored. */
  method: number;
  crc: number;
  size: number;
  compressed: number;
  data: Buffer;
}

export declare function readZip(buffer: Uint8Array): ZipEntryRead[];
