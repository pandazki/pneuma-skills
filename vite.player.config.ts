// vite.player.config.ts — build config for the hosted read-only player SPA.
//
// Separate from the main app build: always a production build (so
// import.meta.env.DEV === false → base URLs resolve same-origin, which the
// content service worker then serves), single entry (player.html), output to
// dist-player/ with namespaced assets so it can be deployed alongside the
// landing page on Cloudflare Pages.
//
// Build: `vite build --config vite.player.config.ts`
// Pass the R2 package base via VITE_PLAYER_PKG_BASE so /s/<id> resolves the
// package URL.

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** mode-loader.ts has prod-only `import("/mode-assets/...")` / `/vendor/...`
 *  branches that Vite's import analysis scans regardless of runtime guards.
 *  Mark them external so the build doesn't try to resolve them. */
function pneumaProdUrlsExternal(): Plugin {
  return {
    name: "pneuma-prod-urls-external",
    resolveId(source) {
      if (source.startsWith("/mode-assets/") || source.startsWith("/vendor/")) {
        return { id: source, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pneumaProdUrlsExternal()],
  resolve: {
    alias: {
      react: path.dirname(require.resolve("react/package.json")),
      "react-dom": path.dirname(require.resolve("react-dom/package.json")),
    },
  },
  build: {
    outDir: "dist-player",
    emptyOutDir: true,
    assetsDir: "player-assets",
    rollupOptions: {
      input: path.resolve(__dirname, "player.html"),
      external: (id) => id.startsWith("/mode-assets/") || id.startsWith("/vendor/"),
    },
  },
});
