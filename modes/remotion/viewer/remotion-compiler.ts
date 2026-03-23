/**
 * JIT Remotion Compiler — pure functions for compiling user TSX.
 *
 * Pipeline: parse imports → transpile → rewrite exports → evaluate with injected APIs
 *
 * This module contains NO browser-only or React dependencies, making it testable in Bun.
 * The React hook lives in use-remotion-compiler.ts.
 */

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompilationResult {
  compositions: import("./composition-parser.js").CompositionMeta[];
  /** Map from componentName → React component */
  components: Map<string, unknown>;
  errors: CompilationError[];
}

export interface CompilationError {
  file: string;
  line?: number;
  message: string;
}

interface ImportInfo {
  source: string; // "./Composition" or "remotion"
  specifiers: { imported: string; local: string }[];
  isDefault: boolean;
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

/** Resolve local import path: "./Composition" → "src/Composition.tsx" */
function resolveLocalPath(from: string, importPath: string, available: Set<string>): string | null {
  const dir = from.includes("/") ? from.substring(0, from.lastIndexOf("/")) : ".";
  const base = importPath.startsWith("./") ? `${dir}/${importPath.slice(2)}` : importPath;

  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`];
  for (const c of candidates) {
    if (available.has(c)) return c;
  }
  return null;
}

// ── Topological Sort ────────────────────────────────────────────────────────

/** Sort files by dependency order (files with no local deps first) */
export function resolveImportOrder(files: ViewerFileContent[]): ViewerFileContent[] {
  const srcFiles = files.filter((f) => /\.(tsx?|jsx?)$/.test(f.path));
  const available = new Set(srcFiles.map((f) => f.path));
  const fileMap = new Map(srcFiles.map((f) => [f.path, f]));

  // Build adjacency: file → set of local dependencies
  const deps = new Map<string, Set<string>>();
  for (const file of srcFiles) {
    const imports = parseImports(file.content);
    const localDeps = new Set<string>();
    for (const imp of imports) {
      if (imp.source.startsWith(".")) {
        const resolved = resolveLocalPath(file.path, imp.source, available);
        if (resolved) localDeps.add(resolved);
      }
    }
    deps.set(file.path, localDeps);
  }

  // DFS topological sort
  const sorted: ViewerFileContent[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(path: string) {
    if (visited.has(path)) return;
    if (visiting.has(path)) return; // Circular — skip
    visiting.add(path);
    for (const dep of deps.get(path) ?? []) {
      visit(dep);
    }
    visiting.delete(path);
    visited.add(path);
    const file = fileMap.get(path);
    if (file) sorted.push(file);
  }

  for (const file of srcFiles) visit(file.path);
  return sorted;
}

// ── Module Compilation ──────────────────────────────────────────────────────

/** Known external package map — packages we can inject */
const KNOWN_PACKAGES = new Set(["remotion", "react", "react/jsx-runtime"]);

/**
 * Compile a single module. Returns its exports object.
 *
 * @param source — raw TypeScript/TSX source
 * @param filename — file path (for error reporting)
 * @param externalModules — map of external package name → module object
 * @param localModules — map of resolved local path → exports object (already compiled)
 */
export function compileModule(
  source: string,
  filename: string,
  externalModules: Record<string, unknown>,
  localModules?: Record<string, unknown>,
): Record<string, unknown> {
  const imports = parseImports(source);

  // Build variable declarations for imports
  const preamble: string[] = [];
  for (const imp of imports) {
    const isLocal = imp.source.startsWith(".");

    let moduleObj: string;

    if (isLocal) {
      const key = Object.keys(localModules ?? {}).find(
        (k) =>
          k === imp.source ||
          k.endsWith(`/${imp.source.replace("./", "")}`) ||
          k.endsWith(`/${imp.source.replace("./", "")}.tsx`) ||
          k.endsWith(`/${imp.source.replace("./", "")}.ts`),
      );
      if (!key || !localModules?.[key]) {
        throw new Error(`[${filename}] Cannot resolve local import "${imp.source}"`);
      }
      moduleObj = `__local_${imp.source.replace(/[^a-zA-Z0-9]/g, "_")}`;
      preamble.push(`var ${moduleObj} = __localModules["${key}"];`);
    } else if (KNOWN_PACKAGES.has(imp.source) || imp.source in (externalModules ?? {})) {
      moduleObj = `__ext_${imp.source.replace(/[^a-zA-Z0-9]/g, "_")}`;
      preamble.push(`var ${moduleObj} = __externalModules["${imp.source}"];`);
    } else {
      throw new Error(
        `[${filename}] Unknown import "${imp.source}". Only core Remotion APIs and local files are supported in preview.`,
      );
    }

    // Destructure specifiers
    for (const spec of imp.specifiers) {
      if (spec.imported === "*") {
        preamble.push(`var ${spec.local} = ${moduleObj};`);
      } else if (spec.imported === "default") {
        preamble.push(`var ${spec.local} = ${moduleObj}.default ?? ${moduleObj};`);
      } else {
        preamble.push(`var ${spec.local} = ${moduleObj}["${spec.imported}"];`);
      }
    }
  }

  // Transpile TSX/TS → JS
  const transpile = getTranspile();
  const transpiled = transpile(source, filename);

  // Rewrite exports
  const rewritten = rewriteForEval(transpiled);

  // Always inject React into scope (Babel classic preset emits React.createElement)
  if (externalModules["react"] && !preamble.some((p) => p.includes("var React"))) {
    preamble.unshift('var React = __externalModules["react"];');
  }

  // Evaluate
  const fullCode = `${preamble.join("\n")}\nvar __exports = {};\n${rewritten}\nreturn __exports;`;

  try {
    const factory = new Function("__externalModules", "__localModules", fullCode);
    return factory(externalModules, localModules ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[${filename}] Runtime error: ${(err as Error).message}`);
  }
}

// ── Workspace Compilation ────────────────────────────────────────────────────

/**
 * Compile all workspace source files into a module map.
 * Files are compiled in dependency order, each file's exports available to later files.
 */
export function buildModuleMap(
  files: ViewerFileContent[],
  externalModules: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const ordered = resolveImportOrder(files);
  const moduleMap = new Map<string, Record<string, unknown>>();

  // Build local module lookup (by various path forms)
  const localLookup: Record<string, unknown> = {};

  for (const file of ordered) {
    try {
      const exports = compileModule(file.content, file.path, externalModules, localLookup);
      moduleMap.set(file.path, exports);
      // Register under multiple path variants for import resolution
      localLookup[file.path] = exports;
      localLookup[`./${file.path}`] = exports;
      // Without extension
      const noExt = file.path.replace(/\.(tsx?|jsx?)$/, "");
      localLookup[noExt] = exports;
      localLookup[`./${noExt}`] = exports;
    } catch (err) {
      // Store error but continue compiling other files
      moduleMap.set(file.path, { __error: (err as Error).message });
    }
  }

  return moduleMap;
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
