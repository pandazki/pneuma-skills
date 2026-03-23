/**
 * React hook for JIT Remotion compilation.
 *
 * Browser-only — imports @babel/standalone, React, and remotion at top level.
 * Pure compilation logic lives in remotion-compiler.ts (testable in Bun).
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
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
 */
export function useRemotionCompiler(files: ViewerFileContent[]): CompilationResult {
  const [result, setResult] = useState<CompilationResult>({
    compositions: [],
    components: new Map(),
    errors: [],
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const cacheKeyRef = useRef<string>("");

  // Compute content hash for cache invalidation
  const contentKey = useMemo(() => {
    return files
      .filter((f) => /\.(tsx?|jsx?)$/.test(f.path))
      .map((f) => `${f.path}:${f.content.length}:${simpleHash(f.content)}`)
      .join("|");
  }, [files]);

  useEffect(() => {
    if (contentKey === cacheKeyRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      cacheKeyRef.current = contentKey;

      try {
        // Override staticFile to resolve through Pneuma's /content/ endpoint
        const apiBase = getApiBase();
        const patchedRemotion = {
          ...remotionModules,
          staticFile: (path: string) => `${apiBase}/content/public/${path.replace(/^\//, "")}`,
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
          setResult({
            compositions: [],
            components: new Map(),
            errors: [{ file: "src/Root.tsx", message: "Root.tsx not found" }],
          });
          return;
        }

        // Parse compositions metadata
        const compositions = parseCompositions(rootFile.content);
        if (compositions.length === 0) {
          setResult({
            compositions: [],
            components: new Map(),
            errors: [{ file: rootFile.path, message: "No <Composition> declarations found in Root.tsx" }],
          });
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
  }, [contentKey, files]);

  return result;
}
