/**
 * `/api/launch/prepare` enrichment — the one seam where a declared init
 * parameter becomes a parameter this machine can actually answer.
 *
 * Two decorations ride the same path:
 *
 *  1. **Auto-fill from stored API keys** — a param whose name matches a key in
 *     `~/.pneuma/api-keys.json` (exactly, or across the UPPER_SNAKE ↔ camelCase
 *     boundary) comes back with the real value plus `autoFilled` +
 *     `maskedPreview` so the form can show a masked, clearable field.
 *  2. **Resolved options** — a param declaring an `optionsSource` comes back
 *     with `options` filled in from disk (`core/init-param-resolver.ts`).
 *
 * Both launcher-scope and per-session `/api/launch/prepare` routes call this,
 * so the launcher grid and ProjectPanel's launch sheet cannot drift apart. The
 * CLI's own launch path reads the same store from the other end — see
 * `resolveBackfilledParams`, which shares this module's name matching so a key
 * saved through the launcher is still found by a `--no-prompt` CLI launch.
 */
import type { InitParam } from "../core/types/mode-manifest.js";
import {
  withResolvedInitParamOptions,
  type InitParamOptionsContext,
} from "../core/init-param-resolver.js";
import { getApiKeys } from "./share.js";

/** An `InitParam` plus the annotations this module adds. */
export type PreparedInitParam = InitParam & {
  autoFilled?: boolean;
  maskedPreview?: string;
};

const camelFromSnake = (s: string): string =>
  s.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
const snakeFromCamel = (s: string): string =>
  s.replace(/[A-Z]/g, (c: string) => `_${c}`).toUpperCase();

/** The stored key for a param name, or null. Exported for its own test. */
export function matchStoredKey(
  storedKeys: Record<string, string>,
  paramName: string,
): string | null {
  if (storedKeys[paramName]) return storedKeys[paramName];
  for (const [storedName, storedValue] of Object.entries(storedKeys)) {
    if (camelFromSnake(storedName) === paramName || snakeFromCamel(paramName) === storedName) {
      return storedValue;
    }
  }
  return null;
}

/**
 * The API-key params a mode's `envMapping` can answer out of the global store.
 *
 * The two launch paths reach `~/.pneuma/api-keys.json` from opposite ends. The
 * launcher's prepare route knows only the *param* name (`falApiKey`) and so
 * matches across the UPPER_SNAKE ↔ camelCase boundary — a key it stores lands
 * under `FAL_API_KEY`. A mode's `envMapping`, by contrast, names the *env*
 * variable it will write into the session `.env` (`FAL_KEY`), which no store
 * entry ever spells. Keying the CLI backfill on the env name alone therefore
 * misses exactly the keys the launcher saved, and a `--no-prompt` launch of
 * sprite / plotwise / clipcraft starts with an empty `falApiKey`. So: try the
 * declared env name first (an exact, mode-authored intent), then fall back to
 * the param name through `matchStoredKey`.
 *
 * Returns ONLY the entries that were backfilled — an empty object means the
 * caller has nothing to persist. A param that already carries a non-empty
 * value is never overwritten: an answer the user gave outranks the store.
 */
export function resolveBackfilledParams(
  resolvedParams: Record<string, number | string>,
  envMapping: Record<string, string>,
  globalKeys: Record<string, string>,
): Record<string, string> {
  const backfilled: Record<string, string> = {};
  for (const [envVar, paramName] of Object.entries(envMapping)) {
    const current = resolvedParams[paramName];
    if (current !== undefined && String(current).trim() !== "") continue;
    const value = globalKeys[envVar] || matchStoredKey(globalKeys, paramName) || "";
    if (!value) continue;
    backfilled[paramName] = value;
  }
  return backfilled;
}

/**
 * Decorate a mode's declared init params for the launch sheet.
 *
 * `storedKeys` is injected so a test can exercise the matching without writing
 * to the real `~/.pneuma/api-keys.json`; production passes nothing and gets
 * the user's actual store.
 */
export function prepareInitParams(
  params: ReadonlyArray<InitParam> | undefined,
  ctx: InitParamOptionsContext & { storedKeys?: Record<string, string> } = {},
): PreparedInitParam[] {
  const storedKeys = ctx.storedKeys ?? getApiKeys();
  const resolved = withResolvedInitParamOptions(params ?? [], ctx);
  return resolved.map((param) => {
    const matchedValue = matchStoredKey(storedKeys, param.name);
    if (!matchedValue) return param;
    const masked = matchedValue.slice(0, 4) + "****" + matchedValue.slice(-4);
    return { ...param, defaultValue: matchedValue, autoFilled: true, maskedPreview: masked };
  });
}
