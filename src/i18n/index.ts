import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const enModules = import.meta.glob("./locales/en/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;
const zhCNModules = import.meta.glob("./locales/zh-CN/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;
const jaModules = import.meta.glob("./locales/ja/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;

function buildResources(modules: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, content] of Object.entries(modules)) {
    const match = path.match(/\/([^/]+)\.json$/);
    if (!match) continue;
    out[match[1]] = content;
  }
  return out;
}

const enResources = buildResources(enModules);
const zhCNResources = buildResources(zhCNModules);
const jaResources = buildResources(jaModules);

export const SUPPORTED_LOCALES = ["en", "zh-CN", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
};

const LOCALE_ALIASES: Record<string, Locale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-CN",
  "zh-hk": "zh-CN",
  "zh-hant": "zh-CN",
  ja: "ja",
  "ja-jp": "ja",
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

const NAMESPACES = Array.from(new Set([
  ...Object.keys(enResources),
  ...Object.keys(zhCNResources),
  ...Object.keys(jaResources),
]));

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: enResources,
      "zh-CN": zhCNResources,
      ja: jaResources,
    },
    ns: NAMESPACES,
    defaultNS: "common",
    fallbackNS: "common",
    lng: detectBrowserLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export function currentLocale(): Locale {
  return (i18n.resolvedLanguage as Locale | undefined) ?? DEFAULT_LOCALE;
}

/**
 * Fetch the user-saved locale from the server and apply it. Falls back to
 * the browser-detected locale already initialised at module load if the
 * server has no preference saved or the request fails.
 */
export async function syncLocaleFromServer(apiBase: string = ""): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/api/user-locale`);
    if (!res.ok) return;
    const data = (await res.json()) as { locale: string | null; systemLocale: string };
    const userLocale = normalizeLocale(data.locale);
    if (userLocale && userLocale !== currentLocale()) {
      await setLocale(userLocale);
      // Notify listeners (e.g. Launcher's registry refetch hook) — the
      // initial registry fetch ran against the browser-detected locale, so
      // mode tiles / showcase carousel would otherwise stay stale until
      // a manual switch or reload.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("pneuma:locale-changed", { detail: { locale: userLocale } }),
        );
      }
    }
  } catch {
    /* network failure — keep browser-detected locale */
  }
}

export async function persistLocale(locale: Locale, apiBase: string = ""): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/user-locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    if (!res.ok) return false;
    await setLocale(locale);
    // Re-emit so non-i18n-subscribed components (e.g. registry-driven mode
    // tiles, timeAgo strings called outside useTranslation) can refresh.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pneuma:locale-changed", { detail: { locale } }));
    }
    return true;
  } catch {
    return false;
  }
}

export default i18n;
