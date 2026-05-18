import i18next from "i18next";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLocale, type Locale } from "../core/locale.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
const LOCALES_DIR = join(REPO_ROOT, "src", "i18n", "locales");

const SUPPORTED: Locale[] = ["en", "zh-CN", "ja"];

function loadNamespace(locale: Locale, ns: string): Record<string, unknown> {
  const filePath = join(LOCALES_DIR, locale, `${ns}.json`);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function discoverNamespaces(): string[] {
  const dir = join(LOCALES_DIR, "en");
  if (!existsSync(dir)) return ["cli", "common"];
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  return found.length ? found : ["cli", "common"];
}

const namespaces = discoverNamespaces();

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const locale of SUPPORTED) {
  resources[locale] = {};
  for (const ns of namespaces) {
    resources[locale][ns] = loadNamespace(locale, ns);
  }
}

await i18next.init({
  resources,
  ns: namespaces,
  defaultNS: "cli",
  fallbackNS: "common",
  lng: resolveLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const t = i18next.t.bind(i18next);
export { i18next };
export function currentCliLocale(): Locale {
  return (i18next.resolvedLanguage as Locale) ?? "en";
}
