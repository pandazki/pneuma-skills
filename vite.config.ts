import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { watch } from "chokidar";

const require = createRequire(import.meta.url);

// External mode path — passed from bin/pneuma.ts via env var
const externalModePath = process.env.PNEUMA_EXTERNAL_MODE_PATH;

// Mode Maker workspace — for dynamic viewer preview
const modeMakerWorkspace = process.env.VITE_MODE_MAKER_WORKSPACE;

/**
 * Vite plugin: resolve imports from mode-maker workspace files.
 *
 * Workspace files (e.g. /tmp/my-mode/viewer/Preview.tsx) use relative paths
 * like `../../../core/types/viewer-contract.js` that don't resolve from the
 * workspace directory. This plugin intercepts those imports and redirects them
 * to the pneuma-skills project root.
 *
 * Also redirects bare specifiers (npm packages like react-markdown) to resolve
 * from the project's node_modules, since the workspace has none.
 */
function pneumaWorkspaceResolve(): Plugin {
  const projectRoot = path.resolve(__dirname);

  // Directories whose imports need redirect: mode-maker workspace and external mode path
  const watchedDirs = [modeMakerWorkspace, externalModePath].filter(Boolean) as string[];

  if (watchedDirs.length === 0) {
    return { name: "pneuma-workspace-resolve-noop" };
  }

  function isInsideWatchedDir(filePath: string): boolean {
    return watchedDirs.some((dir) => filePath.startsWith(dir));
  }

  return {
    name: "pneuma-workspace-resolve",
    resolveId(source, importer) {
      if (!importer) return null;

      // Normalize: strip /@fs prefix and query params
      let cleanImporter = importer;
      if (cleanImporter.startsWith("/@fs")) cleanImporter = cleanImporter.slice(4);
      cleanImporter = cleanImporter.split("?")[0];

      // Only apply to files within watched directories
      if (!isInsideWatchedDir(cleanImporter)) return null;

      const cleanSource = source.split("?")[0];

      if (cleanSource.startsWith(".")) {
        // Relative import — check if it resolves outside workspace to a core/ or src/ path
        const resolved = path.resolve(path.dirname(cleanImporter), cleanSource);
        for (const prefix of ["/core/", "/src/"]) {
          const idx = resolved.indexOf(prefix);
          if (idx !== -1 && !resolved.startsWith(projectRoot)) {
            // Redirect: /some/random/path/core/types/... → <projectRoot>/core/types/...
            const rewritten = projectRoot + resolved.slice(idx);

            // Resolve extension against the real filesystem before returning.
            // The seed template (and other viewer code) imports with a `.js`
            // extension for `.ts` source files — a TypeScript+bundler
            // moduleResolution convention. Vite's URL-to-file extension
            // fallback only works reliably for modules already in its graph;
            // a first-time request for `/src/hooks/useSource.js` from a
            // workspace file drops through to Vite's SPA fallback (served as
            // text/html) and the browser rejects it as a module. Returning
            // the actual on-disk path here skips that trap entirely.
            if (existsSync(rewritten)) return rewritten;
            const dotIdx = rewritten.lastIndexOf(".");
            if (dotIdx > rewritten.lastIndexOf("/")) {
              const base = rewritten.slice(0, dotIdx);
              for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
                const candidate = base + ext;
                if (existsSync(candidate)) return candidate;
              }
            }
            for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
              const candidate = rewritten + ext;
              if (existsSync(candidate)) return candidate;
            }
            // Fall back to the original rewrite if none of the candidates
            // exist — Vite will then surface a clear "file not found" error.
            return rewritten;
          }
        }
      } else if (cleanSource.startsWith("pneuma-skills/")) {
        // Portable bare-specifier form emitted by mode-maker's fork
        // route — `pneuma-skills/core/...` or `pneuma-skills/src/...`.
        // Resolves to the actual project root so the same source works
        // on any machine, regardless of how the user laid out their
        // workspace relative to the pneuma-skills install.
        const rel = cleanSource.slice("pneuma-skills/".length);
        const candidate = path.join(projectRoot, rel);
        if (existsSync(candidate)) return candidate;
        const dotIdx = candidate.lastIndexOf(".");
        if (dotIdx > candidate.lastIndexOf("/")) {
          const base = candidate.slice(0, dotIdx);
          for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
            if (existsSync(base + ext)) return base + ext;
          }
        }
        return candidate;
      } else if (!cleanSource.startsWith("/") && !cleanSource.startsWith("\0")) {
        // Bare specifier (npm package) — resolve from project's node_modules
        return this.resolve(source, path.join(projectRoot, "src", "_virtual_.ts"), {
          skipSelf: true,
        });
      }

      return null;
    },

    // Watch workspace files for HMR — invalidate Vite's module transform cache
    // so the next dynamic import() gets fresh content
    configureServer(server: ViteDevServer) {
      if (!modeMakerWorkspace) return;

      const watcher = watch(modeMakerWorkspace, {
        ignoreInitial: true,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.pneuma/**",
          "**/.claude/**",
        ],
      });

      const invalidate = (filePath: string) => {
        // Invalidate the changed file and all workspace modules that might import it
        for (const [, mod] of server.moduleGraph.idToModuleMap) {
          if (mod.file?.startsWith(modeMakerWorkspace)) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        // Also try the exact file path
        const modules = server.moduleGraph.getModulesByFile(filePath);
        if (modules) {
          for (const mod of modules) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        // Notify browser via custom HMR event — PreviewTab listens for this
        server.hot.send({ type: "custom", event: "pneuma:workspace-update" });
      };

      watcher.on("change", invalidate);
      watcher.on("add", invalidate);
      watcher.on("unlink", invalidate);

      // Clean up on server close
      server.httpServer?.on("close", () => watcher.close());
    },
  };
}

/**
 * Vite plugin: mark production-only URLs as external during dev.
 *
 * mode-loader.ts has `if (isDev) ... else import("/mode-assets/...")` branches.
 * Vite's import-analysis scans ALL import() calls regardless of runtime guards,
 * so the /mode-assets/ and /vendor/ URLs fail in dev. This plugin intercepts
 * those resolve requests and marks them as external.
 */
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
  plugins: [react(), tailwindcss(), pneumaWorkspaceResolve(), pneumaProdUrlsExternal()],
  resolve: {
    alias: {
      // Ensure external modes use the project's React (prevent duplicate instances).
      // Use require.resolve to handle hoisted node_modules (e.g. bunx installs).
      react: path.dirname(require.resolve("react/package.json")),
      "react-dom": path.dirname(require.resolve("react-dom/package.json")),
    },
  },
  build: {
    rollupOptions: {
      // Don't resolve runtime-only URLs used by external mode loading in production
      external: (id) => id.startsWith("/mode-assets/") || id.startsWith("/vendor/"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 17996,
    strictPort: false,
    watch: {
      ignored: ["**/.claude/worktrees/**"],
    },
    proxy: {
      "/api": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/content": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/export": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      "/proxy": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
      // /vendor hosts snapdom.js, dom-to-pptx.bundle.js etc. served by the
      // backend. Export pages (webcraft, kami, slide) load these directly
      // via <script src="/vendor/...">, so the path needs to be proxied in
      // dev mode — otherwise Vite's SPA fallback returns index.html and the
      // page throws "snapdom is not defined" on screenshot.
      "/vendor": `http://localhost:${process.env.VITE_API_PORT || "17007"}`,
    },
    fs: {
      // Allow serving files from external mode and workspace directories (for /@fs/ imports)
      allow: [
        ".",
        ...(externalModePath ? [externalModePath] : []),
        ...(modeMakerWorkspace ? [modeMakerWorkspace] : []),
        path.join(homedir(), ".pneuma", "plugins"),
      ],
    },
  },
});
