import i18n from "i18next";

/**
 * Translate a chat-stream system message from a module that has to stay
 * importable outside the Vite bundle.
 *
 * `src/i18n/index.ts` builds its resources with `import.meta.glob`, which only
 * exists under Vite — importing it from `ws.ts` would break every bun test
 * that loads the socket handlers. The bare i18next singleton has no such
 * dependency: before `init()` has run it simply holds no resources, and its
 * `t()` returns `undefined` rather than a string, so callers outside the app
 * (tests, tooling) get the English source text back instead of a crash.
 */
export function systemText(
  key: string,
  fallback: string,
  vars?: Record<string, string>,
): string {
  if (i18n.isInitialized) {
    const translated = i18n.t(key, { ...vars, defaultValue: fallback });
    if (typeof translated === "string" && translated.length > 0) return translated;
  }
  return interpolate(fallback, vars);
}

/** i18next's `{{name}}` syntax, for the pre-init fallback path only. */
function interpolate(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? vars[name] : match,
  );
}
