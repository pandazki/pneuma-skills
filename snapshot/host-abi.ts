/**
 * Host singleton specifiers shared by the Bun builder and Node/Vite HTML host.
 * This module has no Bun or package-loading side effects.
 */
/** The portable host-store specifier emitted by separately compiled modes. */
export const HOST_STORE_EXTERNAL_SPECIFIER = "pneuma-skills/src/store.js";

/** Bare mode imports resolve to shims backed by the host's __PNEUMA_* globals. */
export const HOST_ABI_VENDOR_URLS: Readonly<Record<string, string>> = {
  react: "/vendor/react.js",
  "react-dom": "/vendor/react-dom.js",
  "react/jsx-runtime": "/vendor/react-jsx-runtime.js",
  "react/jsx-dev-runtime": "/vendor/react-jsx-dev-runtime.js",
  i18next: "/vendor/i18n.js",
  "react-i18next": "/vendor/react-i18n.js",
  [HOST_STORE_EXTERNAL_SPECIFIER]: "/vendor/pneuma-store.js",
  // Modes written before the `.js` convention settled emit the `.ts` form.
  "pneuma-skills/src/store.ts": "/vendor/pneuma-store.js",
};

/** Bare specifiers mode bundles must leave to the host's singletons. */
export const HOST_ABI_EXTERNALS: readonly string[] = Object.keys(HOST_ABI_VENDOR_URLS);

export function hostAbiImportMap(): { imports: Record<string, string> } {
  return { imports: { ...HOST_ABI_VENDOR_URLS } };
}
