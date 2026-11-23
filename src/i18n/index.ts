import i18n, { type BackendModule, type ResourceLanguage } from "i18next";
import { initReactI18next } from "react-i18next";
import english from "./bundles/en.js";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  de: "Deutsch",
};

const LOCALE_ALIASES: Record<string, Locale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-hant": "zh-TW",
  ja: "ja",
  "ja-jp": "ja",
  ko: "ko",
  "ko-kr": "ko",
  es: "es",
  "es-es": "es",
  "es-mx": "es",
  "es-ar": "es",
  "es-419": "es",
  de: "de",
  "de-de": "de",
  "de-at": "de",
  "de-ch": "de",
};

export function normalizeLocale(raw: string | undefined | null): Locale | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace("_", "-");
  if (LOCALE_ALIASES[key]) return LOCALE_ALIASES[key];
  const base = key.split("-")[0];
  if (LOCALE_ALIASES[base]) return LOCALE_ALIASES[base];
  return null;
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

// These import boundaries keep all namespaces for one optional language in one chunk.
const loadBundle = {
  de: () => import("./bundles/de.js"),
  es: () => import("./bundles/es.js"),
  ja: () => import("./bundles/ja.js"),
  ko: () => import("./bundles/ko.js"),
  "zh-CN": () => import("./bundles/zh-CN.js"),
  "zh-TW": () => import("./bundles/zh-TW.js"),
} satisfies Record<Exclude<Locale, "en">, () => Promise<{ default: ResourceLanguage }>>;

i18n
  .use<BackendModule>({
    type: "backend",
    init() {},
    async read(language: string, namespace: string) {
      const locale = normalizeLocale(language);
      if (!locale || locale === "en" || locale !== language) return {};
      const { default: resources } = await loadBundle[locale]();
      return resources[namespace] ?? {};
    },
  })
  .use(initReactI18next)
  .init({
    resources: { en: english },
    partialBundledLanguages: true,
    // The module loader coalesces namespaces into one request per language.
    // Let a second language start even while the first chunk is outstanding.
    maxParallelReads: Infinity,
    ns: Object.keys(english),
    defaultNS: "common",
    fallbackNS: "common",
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export function currentLocale(): Locale {
  return normalizeLocale(i18n.resolvedLanguage) ?? DEFAULT_LOCALE;
}

let requestedLanguage = i18n.language;
i18n.on("languageChanging", language => { requestedLanguage = language; });
i18n.on("languageChanged", () => {
  const locale = currentLocale();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("pneuma:locale-changed", { detail: { locale } }));
  }
});

export async function setLocale(locale: Locale): Promise<void> {
  // i18next retains every loaded bundle and commits only the latest language
  // request, including requests made directly through the viewer host ABI.
  await new Promise<void>((resolve, reject) => {
    void i18n.changeLanguage(locale, (error) => error ? reject(error) : resolve());
  });
}

const browserLocale = detectBrowserLocale();
// A saved language can become ready before the browser's bundle. Mount with
// the first resolved choice while route code loads in parallel.
export const initialLocaleReady = browserLocale === DEFAULT_LOCALE ? Promise.resolve() : new Promise<void>(resolve => {
  function ready() {
    i18n.off("languageChanged", ready);
    resolve();
  }
  i18n.on("languageChanged", ready);
  void setLocale(browserLocale).catch(error => {
    console.warn("[i18n] Could not load browser language", error);
    ready();
  });
});

let preferenceRevision = 0;
let lastWrite = Promise.resolve();

/** A saved preference supersedes even an in-flight browser language load. */
export async function syncLocaleFromServer(apiBase: string = ""): Promise<void> {
  const revision = preferenceRevision;
  try {
    const res = await fetch(`${apiBase}/api/user-locale`);
    if (!res.ok) return;
    const data = await res.json();
    const locale = normalizeLocale(data.locale);
    if (locale && locale !== requestedLanguage && revision === preferenceRevision) await setLocale(locale);
  } catch {
    /* Keep the browser preference if the server is unavailable. */
  }
}

export async function persistLocale(locale: Locale, apiBase: string = ""): Promise<boolean> {
  // Order saves at the server, but never hold the next save behind a chunk
  // download. A failed save leaves the last successful preference in effect.
  const write = lastWrite.then(() => fetch(`${apiBase}/api/user-locale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  }));
  lastWrite = write.then(() => {}, () => {});
  try {
    if (!(await write).ok) return false;
    preferenceRevision++;
    await setLocale(locale);
    return true;
  } catch {
    return false;
  }
}

export default i18n;
