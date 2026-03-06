import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { watch } from "chokidar";

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

  if (!modeMakerWorkspace) {
    return { name: "pneuma-workspace-resolve-noop" };
  }

  return {
    name: "pneuma-workspace-resolve",
    resolveId(source, importer) {
      if (!importer) return null;

      // Normalize: strip /@fs prefix and query params
      let cleanImporter = importer;
      if (cleanImporter.startsWith("/@fs")) cleanImporter = cleanImporter.slice(4);
      cleanImporter = cleanImporter.split("?")[0];

      // Only apply to files within the mode-maker workspace
      if (!cleanImporter.startsWith(modeMakerWorkspace)) return null;

      const cleanSource = source.split("?")[0];

      if (cleanSource.startsWith(".")) {
        // Relative import — check if it resolves outside workspace to a core/ path
        const resolved = path.resolve(path.dirname(cleanImporter), cleanSource);
        const coreIdx = resolved.indexOf("/core/");
        if (coreIdx !== -1 && !resolved.startsWith(projectRoot)) {
          // Redirect: /some/random/path/core/types/... → <projectRoot>/core/types/...
          return projectRoot + resolved.slice(coreIdx);
        }
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
        server.ws.send({ type: "custom", event: "pneuma:workspace-update" });
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
      // Ensure external modes use the project's React (prevent duplicate instances)
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
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
    },
    fs: {
      // Allow serving files from external mode and workspace directories (for /@fs/ imports)
      allow: [
        ".",
        ...(externalModePath ? [externalModePath] : []),
        ...(modeMakerWorkspace ? [modeMakerWorkspace] : []),
      ],
    },
  },
});
