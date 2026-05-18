/**
 * Locale parity test — every namespace JSON must declare the same key set
 * across all locales. A missing key falls back to the English value, which
 * looks broken in production. CI catches drift before merge.
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const LOCALES_DIR = join(dirname(__filename), "..", "locales");
const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "de"] as const;

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return [prefix];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function readNamespace(locale: string, ns: string): Record<string, unknown> {
  const path = join(LOCALES_DIR, locale, `${ns}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

const namespaces = readdirSync(join(LOCALES_DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

for (const ns of namespaces) {
  test(`namespace ${ns}: all locales have parity with en`, () => {
    const enKeys = new Set(flattenKeys(readNamespace("en", ns)));
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      const localeKeys = new Set(flattenKeys(readNamespace(locale, ns)));
      const missing = [...enKeys].filter((k) => !localeKeys.has(k));
      const extra = [...localeKeys].filter((k) => !enKeys.has(k));
      expect(missing, `${locale}/${ns}.json missing keys: ${missing.join(", ")}`).toEqual([]);
      expect(extra, `${locale}/${ns}.json has extra keys: ${extra.join(", ")}`).toEqual([]);
    }
  });
}
