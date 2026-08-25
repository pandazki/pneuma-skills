/**
 * The selection algebra for `select` / `multi-select` init parameters.
 *
 * Pure functions, no filesystem, no React, no Bun API — so the launcher form
 * (`src/components/InitParamForm.tsx`) and the interactive CLI
 * (`bin/pneuma.ts::promptInitParams`) compute the *same* stored value from the
 * same clicks. A mode must not become launchable only from the launcher, and
 * the two paths must not drift into two different serializations of "the user
 * picked these two libraries".
 *
 * ## Wire format
 *
 * A `multi-select` serializes as its selected values joined by
 * `INIT_PARAM_MULTI_SEPARATOR` in *declared option order*, never in click
 * order — so the same set always produces the same bytes. This is deliberately
 * the format a free-text box already produced: `primerLibraries` was, and
 * remains, `all` / `bundled` / `alpha,beta`, which is what
 * `modes/wordtaste/skill/scripts/lib/session.ts::primerSelection` parses.
 */
import type { InitParam, InitParamOption } from "./types/mode-manifest.js";

/** The separator a `multi-select` serializes with. */
export const INIT_PARAM_MULTI_SEPARATOR = ",";

/** Widen the `string | InitParamOption` shorthand into the object form. */
export function normalizeInitParamOptions(
  options: ReadonlyArray<string | InitParamOption> | undefined,
): InitParamOption[] {
  if (!options) return [];
  const seen = new Set<string>();
  const out: InitParamOption[] = [];
  for (const entry of options) {
    const option = typeof entry === "string" ? { value: entry } : entry;
    if (!option || typeof option.value !== "string" || option.value.length === 0) continue;
    // A duplicate value would make the selection ambiguous; first wins, the
    // same rule the resolver applies across roots.
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    out.push(option);
  }
  return out;
}

/** What to show for an option — its label, or the raw value it serializes to. */
export function initParamOptionLabel(option: InitParamOption): string {
  return option.label && option.label.length > 0 ? option.label : option.value;
}

/**
 * Split a stored value into the set it represents.
 *
 * Tolerant of a hand-edited config (`"a, b"`), which is why it trims; an empty
 * or whitespace-only value is an empty set.
 */
export function parseInitParamSelection(raw: string | number | undefined | null): string[] {
  if (raw === undefined || raw === null) return [];
  const text = String(raw);
  if (text.trim().length === 0) return [];
  const out: string[] = [];
  for (const part of text.split(INIT_PARAM_MULTI_SEPARATOR)) {
    const value = part.trim();
    if (value.length === 0 || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

/** Join a set back into the stored value. An empty set is the empty string. */
export function serializeInitParamSelection(values: ReadonlyArray<string>): string {
  return values.join(INIT_PARAM_MULTI_SEPARATOR);
}

/**
 * Put a selection into declared option order, so the serialized bytes depend
 * on *what* is selected and never on the order it was clicked. Values with no
 * matching option (a library that has since been removed, read back out of an
 * old config) keep their relative order and sort after the known ones — they
 * are surfaced, not silently dropped.
 */
export function orderInitParamSelection(
  options: ReadonlyArray<InitParamOption>,
  values: ReadonlyArray<string>,
): string[] {
  const rank = new Map<string, number>();
  options.forEach((option, index) => rank.set(option.value, index));
  const known: string[] = [];
  const unknown: string[] = [];
  for (const value of values) {
    if (rank.has(value)) known.push(value);
    else unknown.push(value);
  }
  known.sort((a, b) => rank.get(a)! - rank.get(b)!);
  return [...known, ...unknown];
}

/**
 * Toggle one value in a `multi-select` selection.
 *
 * Three rules, all of them consequences of what a set-valued parameter means:
 *
 *  1. Choosing an `exclusive` option collapses the selection to just it — that
 *     is what makes `all` a preset rather than one library among many.
 *  2. Choosing a non-exclusive option drops every exclusive one, because
 *     "all, plus this specific one" is not a thing the value can express.
 *  3. The selection never empties. Removing the last remaining value returns
 *     the selection unchanged: a parameter has to answer something, and the
 *     empty string would silently read back as the default downstream.
 */
export function toggleInitParamSelection(
  options: ReadonlyArray<InitParamOption>,
  current: ReadonlyArray<string>,
  value: string,
): string[] {
  const byValue = new Map(options.map((option) => [option.value, option]));
  if (current.includes(value)) {
    const next = current.filter((entry) => entry !== value);
    if (next.length === 0) return [...current]; // rule 3
    return orderInitParamSelection(options, next);
  }
  if (byValue.get(value)?.exclusive) return [value]; // rule 1
  const kept = current.filter((entry) => !byValue.get(entry)?.exclusive); // rule 2
  return orderInitParamSelection(options, [...kept, value]);
}

/**
 * The options a control should render: everything declared or discovered,
 * plus any selected value that matches none of them. A stale selection stays
 * visible (and de-selectable) instead of vanishing from the sheet.
 */
export function visibleInitParamOptions(
  options: ReadonlyArray<InitParamOption>,
  selected: ReadonlyArray<string>,
  missingGroup?: string,
): InitParamOption[] {
  const known = new Set(options.map((option) => option.value));
  const missing = selected
    .filter((value) => !known.has(value))
    .map<InitParamOption>((value) => ({ value, group: missingGroup }));
  return [...options, ...missing];
}

/**
 * Bucket options by `group`, preserving first-seen group order and putting
 * ungrouped options first. Renderers use this to make the
 * "presets vs specific things" distinction legible.
 */
export function groupInitParamOptions(
  options: ReadonlyArray<InitParamOption>,
): Array<{ group?: string; options: InitParamOption[] }> {
  const buckets: Array<{ group?: string; options: InitParamOption[] }> = [];
  const index = new Map<string, number>();
  for (const option of options) {
    const key = option.group ?? "";
    let at = index.get(key);
    if (at === undefined) {
      at = buckets.length;
      index.set(key, at);
      buckets.push({ group: option.group, options: [] });
    }
    buckets[at]!.options.push(option);
  }
  // Ungrouped first; the rest keep first-seen order.
  return buckets.sort((a, b) => Number(a.group !== undefined) - Number(b.group !== undefined));
}

/** True when this parameter is rendered as a set of choices. */
export function isMultiSelectParam(param: Pick<InitParam, "type">): boolean {
  return param.type === "multi-select";
}
