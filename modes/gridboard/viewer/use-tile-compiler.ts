/**
 * React hook for JIT GridBoard tile compilation.
 *
 * Browser-only — imports @babel/standalone, React, and react/jsx-runtime at top level.
 * Pure compilation logic lives in tile-compiler.ts (testable in Bun).
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as Babel from "@babel/standalone";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  setTranspiler,
  compileTiles,
  simpleHash,
  type TileDefinition,
  type TileCompilationResult,
  type BoardConfig,
} from "./tile-compiler.js";

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

export type { TileDefinition, TileCompilationResult, BoardConfig };
export { compileTile, compileTiles, simpleHash } from "./tile-compiler.js";

// ── React Hook ──────────────────────────────────────────────────────────────

/**
 * React hook: compile tile TSX files into TileDefinitions.
 * Debounces recompilation on file changes. Caches by content hash.
 */
export function useTileCompiler(files: ViewerFileContent[]): TileCompilationResult {
  const [result, setResult] = useState<TileCompilationResult>({
    tiles: new Map(),
    errors: [],
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const cacheKeyRef = useRef<string>("");

  // Compute content hash from tile TSX files for cache invalidation
  const contentKey = useMemo(() => {
    return files
      .filter((f) => /\.(tsx?|jsx?)$/.test(f.path) || f.path.endsWith("board.json"))
      .map((f) => `${f.path}:${f.content.length}:${simpleHash(f.content)}`)
      .join("|");
  }, [files]);

  useEffect(() => {
    // Skip compilation when files haven't loaded yet
    if (files.length === 0) return;
    if (contentKey === cacheKeyRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      cacheKeyRef.current = contentKey;

      try {
        // Find board.json
        const boardFile = files.find((f) => f.path === "board.json" || f.path.endsWith("/board.json"));
        if (!boardFile) {
          setResult({
            tiles: new Map(),
            errors: [{ tileId: "board", message: "board.json not found" }],
          });
          return;
        }

        let boardConfig: BoardConfig;
        try {
          boardConfig = JSON.parse(boardFile.content) as BoardConfig;
        } catch (err) {
          setResult({
            tiles: new Map(),
            errors: [{ tileId: "board", message: `Failed to parse board.json: ${(err as Error).message}` }],
          });
          return;
        }

        if (!boardConfig.tiles || typeof boardConfig.tiles !== "object") {
          setResult({
            tiles: new Map(),
            errors: [{ tileId: "board", message: "board.json has no tiles section" }],
          });
          return;
        }

        // Build externals map — defineTile is an identity function that returns the definition object
        const externals: Record<string, unknown> = {
          react: React,
          "react/jsx-runtime": jsxRuntime,
          gridboard: { defineTile: (def: TileDefinition) => def },
        };

        // Convert ViewerFileContent[] to plain { path, content }[] for the pure compiler
        const plainFiles = files.map((f) => ({ path: f.path, content: f.content }));

        const compiled = compileTiles(plainFiles, boardConfig, externals);
        setResult(compiled);
      } catch (err) {
        setResult({
          tiles: new Map(),
          errors: [{ tileId: "compiler", message: (err as Error).message }],
        });
      }
    }, 800); // 800ms debounce — longer than default to avoid compiling mid-edit

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [contentKey, files]);

  return result;
}
