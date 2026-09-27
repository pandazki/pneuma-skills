/**
 * Types for `mirror.mjs` — the script stays plain ESM; the declaration keeps
 * `tsc --noEmit` honest for the tests that import it.
 */

export declare const MIRRORED: Readonly<{ left: "right"; right: "left" }>;

/** A motion of the sprite sidecar, as far as the mirror rules read it. */
export interface MirrorSourceMotion {
  id: string;
  kind?: string;
  source?: string;
  mirrorOf?: string;
  status?: string;
  direction?: string;
}

/** Why `source` cannot be mirrored, or null when it can. */
export declare function mirrorRefusal(source: MirrorSourceMotion): string | null;

/** `character.asymmetric`, trimmed, or null when there is none. */
export declare function asymmetry(character: { asymmetric?: unknown } | null | undefined): string | null;

export interface MirrorAnchorRecord {
  anchor: "bottom" | "center";
  cell: { width: number; height: number };
  anchorPoint: { x: number; y: number };
  mirrorOf: string;
  /** "atlas" when the point came from the source's atlas alone. */
  from?: "atlas";
  [field: string]: unknown;
}

/** The flipped frames' align record, or null when the source's atlas
 *  declares no measured anchor point. */
export declare function mirrorAnchorRecord(input: {
  record: Record<string, any> | null;
  atlas: Record<string, any> | null;
  cell: { width: number; height: number };
  anchor: "bottom" | "center";
  mirrorOf: string;
}): MirrorAnchorRecord | null;

/** The source atlas's anchor, scale and columns; null where it says nothing. */
export declare function atlasLayout(atlas: Record<string, any> | null | undefined): {
  anchor: "bottom" | "center" | null;
  scale: number | null;
  cols: number | null;
};
