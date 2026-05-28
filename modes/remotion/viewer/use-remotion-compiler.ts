/**
 * React hook for JIT Remotion compilation.
 *
 * Browser-only — imports @babel/standalone, React, and remotion at top level.
 * Pure compilation logic lives in remotion-compiler.ts (testable in Bun).
 */

import React, { useCallback, useState, useEffect, useRef, useMemo } from "react";
import * as remotionModules from "remotion";
import * as jsxRuntime from "react/jsx-runtime";
import * as Babel from "@babel/standalone";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { parseCompositions, type CompositionMeta } from "./composition-parser.js";
import { getApiBase } from "../../../src/utils/api.js";
import {
  setTranspiler,
  buildModuleMap,
  simpleHash,
  type CompilationResult,
  type CompilationError,
} from "./remotion-compiler.js";

// ── Configure Babel transpiler for browser ──────────────────────────────────

setTranspiler((source: string, filename: string) => {
  const result = Babel.transform(source, {
    presets: ["react", "typescript"],
    filename,
    sourceType: "module",
  });
  return result.code ?? "";
});

// ── Re-export types ─────────────────────────────────────────────────────────

export type { CompilationResult, CompilationError };
export { resolveImportOrder, compileModule, buildModuleMap } from "./remotion-compiler.js";

// ── React Hook ──────────────────────────────────────────────────────────────

/**
 * React hook: compile workspace files into Remotion compositions.
 * Debounces recompilation on file changes. Caches by content hash.
 *
 * Returns the latest result plus `recompile`, an escape hatch that busts
 * the cache + forces a re-run on the current files. Useful for a user-
 * facing "Retry" button when the viewer somehow lags the workspace state.
 */
export function useRemotionCompiler(files: ViewerFileContent[]): CompilationResult & {
  recompile: () => void;
} {
  const [result, setResult] = useState<CompilationResult>({
    compositions: [],
    components: new Map(),
    errors: [],
  });
  const [recompileTick, setRecompileTick] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cacheKeyRef = useRef<string>("");

  // Compute content hash for cache invalidation (includes image paths to bust cache on asset changes)
  const contentKey = useMemo(() => {
    const codeKey = files
      .filter((f) => /\.(tsx?|jsx?)$/.test(f.path))
      .map((f) => `${f.path}:${f.content.length}:${simpleHash(f.content)}`)
      .join("|");
    // Include non-code file paths so image replacements trigger recompilation
    const assetKey = files
      .filter((f) => !/\.(tsx?|jsx?)$/.test(f.path))
      .map((f) => f.path)
      .join(",");
    return `${codeKey}||${assetKey}`;
  }, [files]);

  useEffect(() => {
    // Skip compilation when files haven't loaded yet (avoids flash of "Root.tsx not found")
    if (files.length === 0) return;
    if (contentKey === cacheKeyRef.current) return;
    // recompileTick is read so the effect re-runs when the user requests
    // a forced recompile (recompile() bumps the tick and clears cacheKey).
    void recompileTick;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      cacheKeyRef.current = contentKey;

      try {
        // Override staticFile to resolve through Pneuma's /content/ endpoint
        // Append cache-busting timestamp so replaced images reload immediately
        const apiBase = getApiBase();
        const cacheBust = Date.now();
        const patchedRemotion = {
          ...remotionModules,
          staticFile: (path: string) => `${apiBase}/content/public/${path.replace(/^\//, "")}?t=${cacheBust}`,
        };

        const externalModules: Record<string, unknown> = {
          remotion: patchedRemotion,
          react: React,
          "react/jsx-runtime": jsxRuntime,
        };

        // Find Root.tsx (only in src/)
        const rootFile = files.find(
          (f) => f.path === "src/Root.tsx" || f.path.endsWith("/src/Root.tsx"),
        );
        if (!rootFile) {
          // Treat "no Root.tsx yet" as a pre-setup state, NOT a compile
          // error. Showing a red Compilation Error panel here is wrong:
          // the gallery refactor (3.15.0) made fresh-session workspaces
          // empty until a seed is picked OR the agent writes scaffolding
          // (notably during Smart Handoff into Remotion), and that
          // transient window should render the friendly "No Compositions"
          // empty state — not look like the agent broke something. Also
          // emitting an error here would queue a `compilation-error`
          // notification on every recompile pass, spamming the agent
          // until the file appears.
          setResult({ compositions: [], components: new Map(), errors: [] });
          return;
        }

        // Parse compositions metadata
        const compositions = parseCompositions(rootFile.content);
        if (compositions.length === 0) {
          // Same reasoning as the missing-Root.tsx branch above: the
          // agent has created the file but hasn't declared any
          // compositions yet. That's a "still being set up" state, not
          // a build break. Fall through to the empty-state UI.
          setResult({ compositions: [], components: new Map(), errors: [] });
          return;
        }

        // Compile only src/ files, excluding index.ts (it calls registerRoot() which is CLI-only)
        const srcFiles = files.filter(
          (f) => /^src\/.*\.(tsx?|jsx?)$/.test(f.path) && !/\bindex\.(ts|tsx|js|jsx)$/.test(f.path),
        );
        const moduleMap = buildModuleMap(srcFiles, externalModules);

        // Extract components from compiled modules
        const components = new Map<string, React.ComponentType<Record<string, unknown>>>();
        const errors: CompilationError[] = [];

        // Collect compilation errors
        for (const [path, exports] of moduleMap) {
          if (exports.__error) {
            errors.push({ file: path, message: exports.__error as string });
          }
        }

        // Map composition componentName → compiled React component
        for (const comp of compositions) {
          let found = false;
          for (const [_path, exports] of moduleMap) {
            if (exports[comp.componentName] && typeof exports[comp.componentName] === "function") {
              components.set(
                comp.componentName,
                exports[comp.componentName] as React.ComponentType<Record<string, unknown>>,
              );
              found = true;
              break;
            }
          }
          if (!found && !errors.length) {
            errors.push({
              file: rootFile.path,
              message: `Component "${comp.componentName}" not found in compiled modules`,
            });
          }
        }

        setResult({ compositions, components, errors });
      } catch (err) {
        setResult({
          compositions: [],
          components: new Map(),
          errors: [{ file: "compiler", message: (err as Error).message }],
        });
      }
    }, 300); // 300ms debounce

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [contentKey, files, recompileTick]);

  const recompile = useCallback(() => {
    cacheKeyRef.current = "";
    setRecompileTick((n) => n + 1);
  }, []);

  return { ...result, recompile };
}
