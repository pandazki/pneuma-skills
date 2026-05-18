import { useState, useEffect, useRef } from "react";
import { getApiBase } from "../utils/api.js";

export interface SystemPreferences {
  theme: "light" | "dark";
  /** Primary locale code (lowercase, language-only, e.g. "en", "ja", "zh") */
  locale: string;
  /** Full preference list, lowercase — Pneuma overrides first, then navigator.languages */
  locales: string[];
  /**
   * False until the user's Pneuma overrides have been fetched from the
   * server at least once. Auto-selection consumers (e.g. App's default
   * content-set picker) should wait for this to flip so the browser
   * defaults don't grab the slot before "zh-CN + dark" arrives.
   */
  ready: boolean;
}

function detectFromBrowser(): Omit<SystemPreferences, "ready"> {
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const rawLocale = (typeof navigator !== "undefined" && navigator.language) || "en";

  return {
    theme: dark ? "dark" : "light",
    locale: rawLocale.toLowerCase().split("-")[0],
    locales: (
      (typeof navigator !== "undefined" && navigator.languages)
        ? Array.from(navigator.languages)
        : [rawLocale]
    ).map((l) => l.toLowerCase()),
  };
}

interface UserOverrides {
  locale?: string | null;
  theme?: "light" | "dark" | "system" | null;
}

/**
 * Combine the user's Pneuma preferences (from `~/.pneuma/settings.json`,
 * served via `/api/user-locale` + `/api/user-theme`) with the platform
 * defaults from `navigator.language` and `prefers-color-scheme`. User
 * preferences win where set; the platform fills in the rest.
 *
 * The returned shape is what `selectBestContentSet()` consumes — pinning a
 * locale and theme here is what lets slide auto-pick `zh-dark` over its
 * three siblings when the user has chosen Simplified Chinese + dark mode.
 */
function merge(
  base: Omit<SystemPreferences, "ready">,
  overrides: UserOverrides | null,
): Omit<SystemPreferences, "ready"> {
  if (!overrides) return base;
  let { theme, locale, locales } = base;

  if (overrides.locale) {
    const lc = overrides.locale.toLowerCase();
    locale = lc.split("-")[0];
    // Prepend the full BCP-47 form + bare language so fallback ordering
    // still considers the user's region preference (e.g. "zh-cn" before
    // "zh" before navigator's "en").
    locales = [lc, locale, ...locales.filter((l) => l !== lc && l !== locale)];
  }

  if (overrides.theme === "light" || overrides.theme === "dark") {
    theme = overrides.theme;
  }
  // theme === "system" leaves the platform-detected value in place.

  return { theme, locale, locales };
}

export function useSystemPreferences(): SystemPreferences {
  const [base, setBase] = useState<Omit<SystemPreferences, "ready">>(detectFromBrowser);
  const [overrides, setOverrides] = useState<UserOverrides | null>(null);
  const [ready, setReady] = useState(false);
  // Avoid duplicate fetches when the hook re-mounts in StrictMode dev.
  const fetchedRef = useRef(false);

  // Platform signals (system colour-scheme + navigator.language).
  useEffect(() => {
    const handler = () => setBase(detectFromBrowser());
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkQuery.addEventListener("change", handler);
    window.addEventListener("languagechange", handler);
    return () => {
      darkQuery.removeEventListener("change", handler);
      window.removeEventListener("languagechange", handler);
    };
  }, []);

  // Pneuma user overrides. Fetched once at mount and re-pulled when either
  // preference is changed elsewhere in the app via the custom events
  // dispatched by `persistLocale` / `useTheme`.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [localeRes, themeRes] = await Promise.all([
          fetch(`${getApiBase()}/api/user-locale`).then((r) => r.ok ? r.json() : null),
          fetch(`${getApiBase()}/api/user-theme`).then((r) => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        setOverrides({
          locale: localeRes?.locale ?? null,
          theme: themeRes?.theme ?? null,
        });
      } catch {
        if (!cancelled) setOverrides(null);
      } finally {
        // Flip ready even on failure so consumers don't wait forever.
        if (!cancelled) setReady(true);
      }
    };

    if (!fetchedRef.current) {
      fetchedRef.current = true;
      void refresh();
    }

    const onChange = () => { void refresh(); };
    window.addEventListener("pneuma:locale-changed", onChange);
    window.addEventListener("pneuma:theme-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("pneuma:locale-changed", onChange);
      window.removeEventListener("pneuma:theme-changed", onChange);
    };
  }, []);

  return { ...merge(base, overrides), ready };
}
