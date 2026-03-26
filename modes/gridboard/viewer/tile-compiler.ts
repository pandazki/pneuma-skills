/**
 * JIT GridBoard Tile Compiler — pure functions for compiling tile TSX files.
 *
 * Pipeline: parse imports → transpile → rewrite exports → evaluate with injected APIs
 *
 * This module contains NO browser-only or React dependencies, making it testable in Bun.
 * The React hook lives in use-tile-compiler.ts.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface TileDefinition {
  label: string;
  description: string;
  minSize: { cols: number; rows: number };
  maxSize: { cols: number; rows: number };
  dataSource?: {
    refreshInterval: number;
    fetch: (ctx: { signal: AbortSignal; params: Record<string, unknown> }) => Promise<unknown>;
  };
  params?: Record<string, { type: string; default: unknown; label: string }>;
  render: (props: { data: unknown; width: number; height: number; loading: boolean; error: Error | null }) => unknown;
  /**
   * Optional: check if this tile's render function is optimized for the given pixel dimensions.
   * When a tile is resized, the viewer calls this to decide whether to notify the agent.
   * - Returns true → tile handles this size well, no agent intervention needed
   * - Returns false → tile may look bad at this size, agent is notified with a screenshot
   * - Not provided → assume tile handles all sizes within minSize/maxSize (never notify)
   */
  isOptimizedFor?: (width: number, height: number) => boolean;
}

export interface TileCompilationResult {
  tiles: Map<string, { definition: TileDefinition; error?: string }>;
  errors: { tileId: string; message: string }[];
}

export interface BoardConfig {
  board: { width: number; height: number; columns: number; rows: number };
  tiles: Record<string, { component: string; status: string; [key: string]: unknown }>;
}

// ── Transpiler Abstraction ────────────────────────────────────────────────

/**
 * Function signature for transpiling TSX/TS → JS.
 * In browser: @babel/standalone. In Bun tests: Bun.Transpiler.
 */
export type TranspileFn = (source: string, filename: string) => string;

/** Default transpiler using Bun.Transpiler (works in Bun test environment) */
let _defaultTranspile: TranspileFn | null = null;

function getDefaultTranspile(): TranspileFn {
  if (_defaultTranspile) return _defaultTranspile;
  // Bun environment — use Bun.Transpiler
  if (typeof Bun !== "undefined" && Bun.Transpiler) {
    const transpiler = new Bun.Transpiler({ loader: "tsx" });
    _defaultTranspile = (source: string, _filename: string) => {
      return transpiler.transformSync(source);
    };
    return _defaultTranspile;
  }
  throw new Error("No transpiler available. Pass a custom transpile function or run in Bun/browser.");
}

// Module-level configurable transpiler
let _transpile: TranspileFn | null = null;

/** Set the transpile function (call once at startup). Browser: pass Babel wrapper. */
export function setTranspiler(fn: TranspileFn): void {
  _transpile = fn;
}

function getTranspile(): TranspileFn {
  return _transpile ?? getDefaultTranspile();
}

// ── Import Resolution ──────────────────────────────────────────────────────

interface ImportInfo {
  source: string;
  specifiers: { imported: string; local: string }[];
  isDefault: boolean;
}

/** Parse import statements from source code */
function parseImports(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const importRegex =
    /import\s+(?:(\*\s+as\s+(\w+))|(?:\{([^}]+)\})|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(source)) !== null) {
    const src = match[6];
    const specifiers: { imported: string; local: string }[] = [];
    let isDefault = false;

    if (match[1]) {
      // import * as X from "source"
      specifiers.push({ imported: "*", local: match[2] });
    }
    if (match[3]) {
      // import { A, B as C } from "source"
      for (const spec of match[3].split(",")) {
        const parts = spec.trim().split(/\s+as\s+/);
        if (parts[0]) specifiers.push({ imported: parts[0].trim(), local: (parts[1] || parts[0]).trim() });
      }
    }
    if (match[4]) {
      // import X from "source"
      specifiers.push({ imported: "default", local: match[4] });
      isDefault = true;
    }
    if (match[5]) {
      // import X, { A, B } from "source"
      for (const spec of match[5].split(",")) {
        const parts = spec.trim().split(/\s+as\s+/);
        if (parts[0]) specifiers.push({ imported: parts[0].trim(), local: (parts[1] || parts[0]).trim() });
      }
    }

    imports.push({ source: src, specifiers, isDefault });
  }

  return imports;
}

/** Strip import/export statements, convert exports to __exports assignments */
function rewriteForEval(source: string): string {
  let code = source;

  // Remove all import statements
  code = code.replace(/import\s+(?:[\s\S]*?)\s+from\s+["'][^"']+["'];?\n?/g, "");
  // Remove type-only imports
  code = code.replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?\n?/g, "");

  // Convert: export const X = ... → __exports.X = ...
  code = code.replace(/export\s+const\s+(\w+)/g, "__exports.$1");
  // Convert: export function X → __exports.X = function X
  code = code.replace(/export\s+function\s+(\w+)/g, "__exports.$1 = function $1");
  // Convert: export class X → __exports.X = class X
  code = code.replace(/export\s+class\s+(\w+)/g, "__exports.$1 = class $1");
  // Convert: export default → __exports.default =
  code = code.replace(/export\s+default\s+/g, "__exports.default = ");
  // Convert: export { A, B } — named re-exports
  code = code.replace(/export\s+\{([^}]+)\};?/g, (_match, names: string) => {
    return names
      .split(",")
      .map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        const local = parts[0]?.trim();
        const exported = (parts[1] || parts[0])?.trim();
        return local && exported ? `__exports.${exported} = ${local};` : "";
      })
      .join("\n");
  });

  return code;
}

// ── Tile Compilation ────────────────────────────────────────────────────────

/** Known external packages that can be injected into tile evaluation */
const KNOWN_PACKAGES = new Set(["gridboard", "react", "react/jsx-runtime"]);

/**
 * Compile a single tile TSX source into a TileDefinition.
 *
 * @param source — raw TypeScript/TSX source for the tile
 * @param filename — file path (for error reporting)
 * @param externals — map of package name → module object (must include react + gridboard)
 */
export function compileTile(
  source: string,
  filename: string,
  externals: Record<string, unknown>,
): TileDefinition {
  const imports = parseImports(source);

  // Build variable declarations for imports
  const preamble: string[] = [];
  for (const imp of imports) {
    if (KNOWN_PACKAGES.has(imp.source) || imp.source in externals) {
      const moduleObj = `__ext_${imp.source.replace(/[^a-zA-Z0-9]/g, "_")}`;
      preamble.push(`var ${moduleObj} = __externals["${imp.source}"];`);

      for (const spec of imp.specifiers) {
        if (spec.imported === "*") {
          preamble.push(`var ${spec.local} = ${moduleObj};`);
        } else if (spec.imported === "default") {
          preamble.push(`var ${spec.local} = ${moduleObj}.default ?? ${moduleObj};`);
        } else {
          preamble.push(`var ${spec.local} = ${moduleObj}["${spec.imported}"];`);
        }
      }
    } else if (!imp.source.startsWith(".")) {
      throw new Error(
        `[${filename}] Unknown import "${imp.source}". Only gridboard, react, and react/jsx-runtime are supported in tile preview.`,
      );
    }
    // Local imports (starting with ".") are silently ignored for now — tiles are independent
  }

  // Always inject React into scope (Babel classic preset emits React.createElement)
  if (externals["react"] && !preamble.some((p) => p.includes("var React"))) {
    preamble.unshift('var React = __externals["react"];');
  }

  // Transpile TSX/TS → JS
  const transpile = getTranspile();
  const transpiled = transpile(source, filename);

  // Rewrite exports
  const rewritten = rewriteForEval(transpiled);

  // Capture defineTile result: defineTile is an identity function from the gridboard external,
  // so __exports.default will hold the TileDefinition object.
  const fullCode = `${preamble.join("\n")}\nvar __exports = {};\n${rewritten}\nreturn __exports;`;

  let moduleExports: Record<string, unknown>;
  try {
    const factory = new Function("__externals", fullCode);
    moduleExports = factory(externals) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[${filename}] Runtime error: ${(err as Error).message}`);
  }

  const definition = moduleExports.default as TileDefinition | undefined;
  if (!definition || typeof definition.render !== "function") {
    throw new Error(
      `[${filename}] Tile must export a defineTile() result as default export with a render function.`,
    );
  }

  return definition;
}

/**
 * Compile all tiles referenced in board.json.
 *
 * @param files — all workspace files ({ path, content })
 * @param boardConfig — parsed board.json
 * @param externals — map of package name → module object
 */
export function compileTiles(
  files: { path: string; content: string }[],
  boardConfig: BoardConfig,
  externals: Record<string, unknown>,
): TileCompilationResult {
  const tiles = new Map<string, { definition: TileDefinition; error?: string }>();
  const errors: { tileId: string; message: string }[] = [];

  const fileMap = new Map(files.map((f) => [f.path, f.content]));

  for (const [tileId, tileConfig] of Object.entries(boardConfig.tiles)) {
    // Compile all tiles (active + available + disabled) so Gallery can show metadata & previews

    const componentPath = tileConfig.component;

    // Try to find the file — accept exact match or with/without leading slash
    const content =
      fileMap.get(componentPath) ??
      fileMap.get(componentPath.replace(/^\//, "")) ??
      fileMap.get(`/${componentPath}`);

    if (content === undefined) {
      const msg = `Tile component file not found: ${componentPath}`;
      errors.push({ tileId, message: msg });
      tiles.set(tileId, { definition: null as unknown as TileDefinition, error: msg });
      continue;
    }

    try {
      const definition = compileTile(content, componentPath, externals);
      tiles.set(tileId, { definition });
    } catch (err) {
      const msg = (err as Error).message;
      errors.push({ tileId, message: msg });
      tiles.set(tileId, { definition: null as unknown as TileDefinition, error: msg });
    }
  }

  return { tiles, errors };
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
