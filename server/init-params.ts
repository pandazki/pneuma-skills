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
 * so the launcher grid and ProjectPanel's launch sheet cannot drift apart.
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
