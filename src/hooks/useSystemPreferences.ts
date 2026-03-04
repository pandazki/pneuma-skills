import { useState, useEffect } from "react";

export interface SystemPreferences {
  theme: "light" | "dark";
  /** Primary locale code, e.g. "en", "ja" */
  locale: string;
  /** Full navigator.languages list, lowercase */
  locales: string[];
}

function detect(): SystemPreferences {
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

export function useSystemPreferences(): SystemPreferences {
  const [prefs, setPrefs] = useState(detect);

  useEffect(() => {
    const handler = () => setPrefs(detect());

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkQuery.addEventListener("change", handler);
    window.addEventListener("languagechange", handler);

    return () => {
      darkQuery.removeEventListener("change", handler);
      window.removeEventListener("languagechange", handler);
    };
  }, []);

  return prefs;
}
