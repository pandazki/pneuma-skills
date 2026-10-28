/**
 * Types for `chart.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export declare class ChartError extends Error {}

/** A chart spec as documented in `references/diagrams.md` §9. */
export type ChartSpec = Record<string, unknown>;

/** Render one spec to a standalone `<svg>` carrying its spec in `data-kami-spec`. */
export declare function renderChart(spec: ChartSpec): string;

/** Every generated chart (`data-kami-chart`) in a document's text. */
export declare function findCharts(text: string): string[];

/** null when the drawn chart matches its embedded spec, else the reason. */
export declare function compareChart(svg: string): string | null;

/** Check every generated chart in the given files; returns the exit code (0 / 1 / 2). */
export declare function checkCharts(files: string[], log?: (line: string) => void): number;

/** The CLI: `spec.json [-o chart.svg]` or `--check file ...`; returns the exit code. */
export declare function main(
  argv: string[],
  log?: (line: string) => void,
  write?: (svg: string) => void,
): number;

export declare function fmt(value: number, dec: number, prefix?: string, suffix?: string, sign?: boolean): string;
export declare function niceScale(lo: number, hi: number, includeZero: boolean): [number, number, number];
export declare function textWidth(text: string, size: number): number;
