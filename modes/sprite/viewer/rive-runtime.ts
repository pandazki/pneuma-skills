/**
 * The official Rive web runtime (`@rive-app/canvas`), loaded on first use and
 * pointed at the WebAssembly that ships WITH this mode.
 *
 * Left alone, the runtime fetches its `.wasm` from unpkg, and on failure from
 * jsDelivr. Neither is acceptable here: the desktop app and a local session
 * must preview a `.riv` offline, and a runtime quietly fetched from a CDN is
 * a dependency nobody declared. So the file is imported for its URL — both
 * bundlers emit it beside the code (see `rive-wasm.d.ts`) — and the CDN
 * fallback is switched off: a WASM that does not load is a failure the panel
 * shows, never a silent trip to the network.
 *
 * `new URL(…, import.meta.url)` makes the emitted path absolute against the
 * module that asked for it. Bun.build hands back `./rive-<hash>.wasm`, which
 * only means something next to `/mode-assets/pneuma-mode.js`; Vite hands back
 * an absolute path, which the constructor leaves as it is.
 *
 * The dynamic import is what keeps the runtime out of the page until someone
 * presses Preview — in the Vite builds (dev server, hosted player) it is a
 * separate chunk. `snapshot/mode-build.ts` does not split, so in a catalog
 * bundle the JavaScript is inlined and only the `.wasm` stays a separate
 * file, fetched on first preview.
 */

import riveWasmUrl from "@rive-app/canvas/rive.wasm";

export type RiveRuntime = typeof import("@rive-app/canvas");

let loading: Promise<RiveRuntime> | null = null;

/** The runtime module, with its WASM loaded. Rejects when either fails; a
 *  later call tries again rather than handing back the same failure. */
export function loadRiveRuntime(): Promise<RiveRuntime> {
  if (!loading) {
    loading = import("@rive-app/canvas")
      .then(async (mod) => {
        // The package is a webpack UMD bundle: a bundler's ESM interop may put
        // its exports on the namespace or on `default`.
        const runtime = ((mod as { Rive?: unknown }).Rive
          ? mod
          : (mod as unknown as { default: RiveRuntime }).default) as RiveRuntime;
        runtime.RuntimeLoader.setWasmUrl(new URL(riveWasmUrl, import.meta.url).href);
        runtime.RuntimeLoader.setWasmFallbackUrl(null);
        await runtime.RuntimeLoader.awaitInstance();
        return runtime;
      })
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}
