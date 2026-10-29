/**
 * Types for `prompt-locales.mjs` — the per-language scaffolding table.
 */
export interface PromptLocale {
  readonly [key: string]: string | readonly string[] | Readonly<Record<number, string>>;
  readonly copyLine: string;
  readonly boardClosing: string;
  readonly defaultContinuity: readonly string[];
}
export declare const PROMPT_LOCALES: Readonly<{ en: PromptLocale; zh: PromptLocale }>;
export declare const PROMPT_LANGS: readonly ("en" | "zh")[];
