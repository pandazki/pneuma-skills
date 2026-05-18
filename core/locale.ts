import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const LOCALE_ALIASES: Record<string, Locale> = {
  "en": "en",
  "en-us": "en",
  "en-gb": "en",
  "zh": "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-hant": "zh-TW",
  "ja": "ja",
  "ja-jp": "ja",
  "ko": "ko",
  "ko-kr": "ko",
  "es": "es",
  "es-es": "es",
  "es-mx": "es",
  "es-ar": "es",
  "es-419": "es",
  "de": "de",
  "de-de": "de",
  "de-at": "de",
  "de-ch": "de",
};

export function normalizeLocale(raw: string | undefined | null): Locale | null {
  if (!raw) return null;
  const key = raw.toLowerCase().split(".")[0].replace("_", "-");
  if (LOCALE_ALIASES[key]) return LOCALE_ALIASES[key];
  const base = key.split("-")[0];
  if (LOCALE_ALIASES[base]) return LOCALE_ALIASES[base];
  return null;
}

function pneumaHome(): string {
  return process.env.PNEUMA_HOME || join(homedir(), ".pneuma");
}

function settingsPath(): string {
  return join(pneumaHome(), "settings.json");
}

interface SettingsFile {
  locale?: string;
  [key: string]: unknown;
}

function readSettingsRaw(): SettingsFile {
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return {};
  }
}

export function getUserLocale(): Locale | null {
  const settings = readSettingsRaw();
  return normalizeLocale(settings.locale as string | undefined);
}

export function setUserLocale(locale: Locale | null): void {
  const dir = pneumaHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const settings = readSettingsRaw();
  if (locale === null) {
    delete settings.locale;
  } else {
    settings.locale = locale;
  }
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

export function detectSystemLocale(): Locale {
  const envCandidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE,
  ];
  for (const candidate of envCandidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(): Locale {
  return getUserLocale() ?? detectSystemLocale();
}
