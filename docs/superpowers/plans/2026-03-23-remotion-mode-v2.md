# Remotion Mode v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in Remotion mode to Pneuma that renders video compositions via `@remotion/player` with JIT compilation, custom playback controls, and agent-invocable viewer actions.

**Architecture:** The viewer compiles user TSX files in-browser using `@babel/standalone`, injects Remotion APIs, and renders via `<Player>` with custom controls (timeline, play/pause, speed). No iframe — direct React rendering with ErrorBoundary for isolation. Remotion Studio available as optional "Open in Studio" via agent.

**Tech Stack:** remotion 4.0.x, @remotion/player 4.0.x, @babel/standalone 7.x, React 19, Zustand 5, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-23-remotion-mode-v2-design.md`

---

## File Structure

```
modes/remotion/
├── manifest.ts                          # ModeManifest — viewer actions, skill config, init
├── pneuma-mode.ts                       # ModeDefinition — binds manifest + viewer, extractContext
├── viewer/
│   ├── RemotionPreview.tsx              # Main viewer component (Player + layout + action dispatch)
│   ├── RemotionControls.tsx             # Playback controls (timeline, play/pause, speed)
│   ├── composition-parser.ts            # Parse Root.tsx → composition metadata
│   └── use-remotion-compiler.ts         # React hook: files → compiled components (Babel JIT)
├── skill/
│   ├── SKILL.md                         # Agent instructions (updated for v2 — no Studio startup)
│   └── rules/*.md                       # 37 official Remotion API rule files (from v1)
├── seed/
│   └── default/                         # Remotion project template (from v1)
│       ├── package.json
│       ├── remotion.config.ts
│       ├── tsconfig.json
│       ├── src/index.ts
│       ├── src/Root.tsx
│       ├── src/Composition.tsx
│       └── public/.gitkeep
└── showcase/
    └── showcase.json                    # Launcher card metadata (from v1)

core/__tests__/
└── remotion-compiler.test.ts            # Unit tests for composition-parser + compiler

# Modified files:
# core/mode-loader.ts          — Add remotion to builtinModes registry
# server/index.ts              — Add "remotion" to builtinNames array
# package.json                 — Add remotion, @remotion/player, @babel/standalone
```

---

### Task 1: Foundation — Cherry-pick v1 Assets + Add Dependencies

Cherry-pick unchanged files from `feat/remotion-mode` branch and add npm dependencies.

**Files:**
- Cherry-pick from v1: `modes/remotion/seed/`, `modes/remotion/skill/rules/`, `modes/remotion/showcase/`
- Modify: `package.json`

- [ ] **Step 1: Cherry-pick seed template, rules, and showcase from v1 branch**

```bash
git checkout feat/remotion-mode -- modes/remotion/seed/ modes/remotion/skill/rules/ modes/remotion/showcase/
```

This copies the Remotion project template (`seed/default/`), 37 official Remotion API rule files (`skill/rules/*.md` + 3 asset files), and launcher showcase metadata. These are unchanged between v1 and v2.

- [ ] **Step 2: Verify cherry-picked files**

```bash
ls modes/remotion/seed/default/src/
# Expected: Composition.tsx  Root.tsx  index.ts

ls modes/remotion/skill/rules/ | head -10
# Expected: 3d.md  animations.md  assets.md  ...

cat modes/remotion/showcase/showcase.json
# Expected: JSON with mode metadata
```

- [ ] **Step 3: Add dependencies**

Add to `package.json` `dependencies`:

```json
"remotion": "4.0.438",
"@remotion/player": "4.0.438",
"@babel/standalone": "^7.27.0"
```

Version 4.0.438 matches the seed template's `package.json`. `@babel/standalone` provides in-browser TSX compilation.

Run:
```bash
bun install
```

- [ ] **Step 4: Verify imports work**

```bash
bun -e "import { interpolate } from 'remotion'; console.log(typeof interpolate)"
# Expected: function

bun -e "import { Player } from '@remotion/player'; console.log(typeof Player)"
# Expected: function
```

- [ ] **Step 5: Commit**

```bash
git add modes/remotion/seed/ modes/remotion/skill/rules/ modes/remotion/showcase/ package.json bun.lock
git commit -m "feat(remotion): add v1 assets and remotion dependencies

Cherry-pick seed template, skill rules, and showcase from feat/remotion-mode.
Add remotion 4.0.438, @remotion/player, @babel/standalone."
```

---

### Task 2: Composition Parser — Parse Root.tsx for Metadata (TDD)

Extract `<Composition>` declarations from Root.tsx to discover composition IDs, dimensions, fps, and duration.

**Files:**
- Create: `modes/remotion/viewer/composition-parser.ts`
- Create: `core/__tests__/remotion-compiler.test.ts`

- [ ] **Step 1: Write failing tests for composition parsing**

Create `core/__tests__/remotion-compiler.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseCompositions } from "../../modes/remotion/viewer/composition-parser.js";

describe("parseCompositions", () => {
  test("extracts single composition", () => {
    const root = `
import { Composition } from "remotion";
import { MyComp } from "./MyComp";

export const RemotionRoot = () => (
  <Composition id="MyComp" component={MyComp} durationInFrames={150} fps={30} width={1920} height={1080} />
);`;
    const result = parseCompositions(root);
    expect(result).toEqual([
      { id: "MyComp", componentName: "MyComp", durationInFrames: 150, fps: 30, width: 1920, height: 1080 },
    ]);
  });

  test("extracts multiple compositions", () => {
    const root = `
export const RemotionRoot = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={90} fps={30} width={1920} height={1080} />
    <Composition id="Main" component={MainVideo} durationInFrames={300} fps={30} width={1920} height={1080} />
  </>
);`;
    const result = parseCompositions(root);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("Intro");
    expect(result[1].id).toBe("Main");
    expect(result[1].componentName).toBe("MainVideo");
  });

  test("handles multiline composition props", () => {
    const root = `
<Composition
  id="MyComp"
  component={MyComp}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
/>`;
    const result = parseCompositions(root);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("MyComp");
  });

  test("returns empty array when no compositions", () => {
    const root = `export const Root = () => <div>Hello</div>;`;
    const result = parseCompositions(root);
    expect(result).toEqual([]);
  });

  test("extracts component name from import for component={importedName}", () => {
    const root = `
<Composition id="video" component={HelloWorld} durationInFrames={60} fps={30} width={1280} height={720} />`;
    const result = parseCompositions(root);
    expect(result[0].componentName).toBe("HelloWorld");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test core/__tests__/remotion-compiler.test.ts
```

Expected: FAIL — `parseCompositions` does not exist.

- [ ] **Step 3: Implement composition parser**

Create `modes/remotion/viewer/composition-parser.ts`:

```typescript
/**
 * Parse Root.tsx to extract <Composition> metadata.
 * Uses regex — no AST parser needed for this predictable structure.
 */

export interface CompositionMeta {
  id: string;
  componentName: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * Extract all <Composition> declarations from Root.tsx source.
 * Handles both single-line and multi-line JSX prop formats.
 */
export function parseCompositions(source: string): CompositionMeta[] {
  const compositions: CompositionMeta[] = [];

  // Match <Composition ... /> blocks (single-line or multi-line, self-closing)
  const compositionRegex = /<Composition\b([\s\S]*?)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = compositionRegex.exec(source)) !== null) {
    const props = match[1];
    const id = extractProp(props, "id");
    const componentName = extractComponentProp(props);
    const durationInFrames = extractNumericProp(props, "durationInFrames");
    const fps = extractNumericProp(props, "fps");
    const width = extractNumericProp(props, "width");
    const height = extractNumericProp(props, "height");

    if (id && componentName && durationInFrames && fps && width && height) {
      compositions.push({ id, componentName, durationInFrames, fps, width, height });
    }
  }

  return compositions;
}

/** Extract a string prop value: id="value" */
function extractProp(props: string, name: string): string | null {
  const regex = new RegExp(`${name}=(?:"([^"]+)"|{["']([^"']+)["']})`);
  const match = props.match(regex);
  return match?.[1] ?? match?.[2] ?? null;
}

/** Extract component={Name} prop value */
function extractComponentProp(props: string): string | null {
  const match = props.match(/component=\{(\w+)\}/);
  return match?.[1] ?? null;
}

/** Extract a numeric prop: name={123} */
function extractNumericProp(props: string, name: string): number | null {
  const regex = new RegExp(`${name}=\\{(\\d+)\\}`);
  const match = props.match(regex);
  return match ? parseInt(match[1], 10) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test core/__tests__/remotion-compiler.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add modes/remotion/viewer/composition-parser.ts core/__tests__/remotion-compiler.test.ts
git commit -m "feat(remotion): add composition parser with tests

Regex-based parser extracts <Composition> metadata from Root.tsx.
Returns id, componentName, durationInFrames, fps, width, height."
```

---

### Task 3: JIT Compiler Hook — Compile User TSX with Babel (TDD)

The core technical piece: compile user TSX in-browser, resolve local imports, inject Remotion APIs, return React components.

**Files:**
- Create: `modes/remotion/viewer/use-remotion-compiler.ts`
- Modify: `core/__tests__/remotion-compiler.test.ts`

- [ ] **Step 1: Write failing tests for module compilation**

Add to `core/__tests__/remotion-compiler.test.ts`:

```typescript
import { compileModule, buildModuleMap, resolveImportOrder } from "../../modes/remotion/viewer/use-remotion-compiler.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

describe("resolveImportOrder", () => {
  test("sorts files by dependency order (leaves first)", () => {
    const files: ViewerFileContent[] = [
      { path: "src/Root.tsx", content: 'import { MyComp } from "./Composition";' },
      { path: "src/Composition.tsx", content: 'import { useCurrentFrame } from "remotion";' },
      { path: "src/index.ts", content: 'import { RemotionRoot } from "./Root";' },
    ];
    const order = resolveImportOrder(files);
    const paths = order.map((f) => f.path);
    // Composition has no local deps → comes first
    expect(paths.indexOf("src/Composition.tsx")).toBeLessThan(paths.indexOf("src/Root.tsx"));
    expect(paths.indexOf("src/Root.tsx")).toBeLessThan(paths.indexOf("src/index.ts"));
  });
});

describe("compileModule", () => {
  test("compiles simple TSX and returns exports", () => {
    const source = `
export const greeting = "hello";
export function add(a: number, b: number): number { return a + b; }
`;
    const result = compileModule(source, "test.tsx", {});
    expect(result.greeting).toBe("hello");
    expect(result.add(2, 3)).toBe(5);
  });

  test("injects remotion API", () => {
    const source = `
import { interpolate } from "remotion";
export const val = interpolate(5, [0, 10], [0, 100]);
`;
    const remotionApi = { interpolate: (f: number, ir: number[], or: number[]) => (f / ir[1]) * or[1] };
    const result = compileModule(source, "test.tsx", { remotion: remotionApi });
    expect(result.val).toBe(50);
  });

  test("resolves local imports from module map", () => {
    const source = `
import { greeting } from "./utils";
export const msg = greeting + " world";
`;
    const moduleMap = { "./utils": { greeting: "hello" } };
    const result = compileModule(source, "test.tsx", { remotion: {} }, moduleMap);
    expect(result.msg).toBe("hello world");
  });

  test("throws on unknown external import", () => {
    const source = `import { foo } from "unknown-package";`;
    expect(() => compileModule(source, "test.tsx", {})).toThrow(/unknown-package/);
  });
});

describe("buildModuleMap", () => {
  test("compiles workspace files into module map", () => {
    const files: ViewerFileContent[] = [
      { path: "src/utils.ts", content: 'export const X = 42;' },
      { path: "src/main.tsx", content: 'import { X } from "./utils";\nexport const Y = X + 1;' },
    ];
    const result = buildModuleMap(files, {});
    expect(result.get("src/main.tsx")?.Y).toBe(43);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test core/__tests__/remotion-compiler.test.ts
```

Expected: FAIL — new functions don't exist.

- [ ] **Step 3: Implement the JIT compiler**

Create `modes/remotion/viewer/use-remotion-compiler.ts`:

```typescript
/**
 * JIT Remotion Compiler — compile user TSX in-browser with Babel.
 *
 * Pipeline: parse imports → Babel transform → evaluate with injected APIs → cache
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import * as remotionModules from "remotion";
import * as jsxRuntime from "react/jsx-runtime";
import * as Babel from "@babel/standalone";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { parseCompositions, type CompositionMeta } from "./composition-parser.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompilationResult {
  compositions: CompositionMeta[];
  /** Map from componentName → React component */
  components: Map<string, React.ComponentType<Record<string, unknown>>>;
  errors: CompilationError[];
}

export interface CompilationError {
  file: string;
  line?: number;
  message: string;
}

// ── Import Resolution ──────────────────────────────────────────────────────

interface ImportInfo {
  source: string; // "./Composition" or "remotion"
  specifiers: { imported: string; local: string }[];
  isDefault: boolean;
}

/** Parse import statements from source code */
function parseImports(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  // Match: import { A, B } from "source"
  // Match: import X from "source"
  // Match: import * as X from "source"
  const importRegex = /import\s+(?:(\*\s+as\s+(\w+))|(?:\{([^}]+)\})|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+["']([^"']+)["']/g;
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

/** Strip import/export statements from source, convert exports to assignments on __exports */
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
  // Compute directory of importing file
  const dir = from.includes("/") ? from.substring(0, from.lastIndexOf("/")) : ".";
  const base = importPath.startsWith("./") ? `${dir}/${importPath.slice(2)}` : importPath;

  // Try with extensions
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

  // Kahn's algorithm
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
 * @param externalModules — map of external package name → module object (e.g. "remotion" → remotionApi)
 * @param localModules — map of resolved local path → exports object (already compiled)
 */
export function compileModule(
  source: string,
  filename: string,
  externalModules: Record<string, unknown>,
  localModules?: Record<string, unknown>,
): Record<string, unknown> {
  // Babel is imported at top level (tree-shaken by Vite when mode not active)

  const imports = parseImports(source);
  const available = new Set(Object.keys(localModules ?? {}));

  // Build variable declarations for imports
  const preamble: string[] = [];
  for (const imp of imports) {
    const isLocal = imp.source.startsWith(".");
    let moduleObj: string;

    if (isLocal) {
      // Resolve local path — check module map
      const key = Object.keys(localModules ?? {}).find(
        (k) => k === imp.source || k.endsWith(`/${imp.source.replace("./", "")}`) || k.endsWith(`/${imp.source.replace("./", "")}.tsx`) || k.endsWith(`/${imp.source.replace("./", "")}.ts`),
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
      throw new Error(`[${filename}] Unknown import "${imp.source}". Only core Remotion APIs and local files are supported in preview. Use "Open in Studio" for external packages.`);
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

  // Babel transform (strip TS types, convert JSX)
  const transpiled = Babel.transform(source, {
    presets: ["react", "typescript"],
    filename,
    sourceType: "module",
  }).code;

  // Rewrite exports
  const rewritten = rewriteForEval(transpiled!);

  // Evaluate
  const fullCode = `${preamble.join("\n")}\nvar __exports = {};\n${rewritten}\nreturn __exports;`;

  try {
    const factory = new Function("React", "__externalModules", "__localModules", fullCode);
    const React = externalModules["react"] ?? (typeof window !== "undefined" ? (window as any).React : require("react"));
    return factory(React, externalModules, localModules ?? {}) as Record<string, unknown>;
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
        // Use pre-loaded modules (imported at top level, available synchronously)
        const externalModules: Record<string, unknown> = {
          remotion: remotionModules,
          react: React,
          "react/jsx-runtime": jsxRuntime,
        };

        // Find Root.tsx
        const rootFile = files.find((f) => f.path.endsWith("/Root.tsx") || f.path === "src/Root.tsx" || f.path === "Root.tsx");
        if (!rootFile) {
          setResult({ compositions: [], components: new Map(), errors: [{ file: "src/Root.tsx", message: "Root.tsx not found" }] });
          return;
        }

        // Parse compositions metadata
        const compositions = parseCompositions(rootFile.content);
        if (compositions.length === 0) {
          setResult({ compositions: [], components: new Map(), errors: [{ file: rootFile.path, message: "No <Composition> declarations found in Root.tsx" }] });
          return;
        }

        // Compile all source files
        const srcFiles = files.filter((f) => /^(src\/)?.*\.(tsx?|jsx?)$/.test(f.path));
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
              components.set(comp.componentName, exports[comp.componentName] as React.ComponentType<Record<string, unknown>>);
              found = true;
              break;
            }
          }
          if (!found && !errors.length) {
            errors.push({ file: rootFile.path, message: `Component "${comp.componentName}" not found in compiled modules` });
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

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test core/__tests__/remotion-compiler.test.ts
```

Expected: All tests PASS. Note: `@babel/standalone` must be available. If Bun can't load it due to browser-only APIs, the tests for `compileModule` may need adjustment — mock Babel or use Bun's own TSX support as fallback. The composition parser and import order tests should pass regardless.

If Babel standalone doesn't work in Bun test environment, adjust `compileModule` to detect environment and use `Bun.Transpiler` as server-side fallback. The browser path remains `@babel/standalone`.

- [ ] **Step 5: Commit**

```bash
git add modes/remotion/viewer/use-remotion-compiler.ts core/__tests__/remotion-compiler.test.ts
git commit -m "feat(remotion): add JIT compiler with Babel + module resolution

Compiles user TSX in-browser, resolves local imports,
injects Remotion APIs. Debounced recompilation on file changes."
```

---

### Task 4: Viewer Component — RemotionPreview + Playback Controls

The main viewer component renders `<Player>` and custom controls.

**Files:**
- Create: `modes/remotion/viewer/RemotionControls.tsx`
- Create: `modes/remotion/viewer/RemotionPreview.tsx`

- [ ] **Step 1: Implement playback controls component**

Create `modes/remotion/viewer/RemotionControls.tsx`:

```tsx
/**
 * RemotionControls — custom playback controls for the Remotion Player.
 * Timeline scrubber, play/pause, speed selector, time display.
 */

import { useCallback, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";

interface RemotionControlsProps {
  playerRef: React.RefObject<PlayerRef | null>;
  frame: number;
  durationInFrames: number;
  fps: number;
  playing: boolean;
  playbackRate: number;
  onPlayPause: () => void;
  onSeek: (frame: number) => void;
  onRateChange: (rate: number) => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

/** Format frame number as MM:SS.FF */
function formatTime(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor(frame % fps);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}

export default function RemotionControls({
  playerRef,
  frame,
  durationInFrames,
  fps,
  playing,
  playbackRate,
  onPlayPause,
  onSeek,
  onRateChange,
}: RemotionControlsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFrames, setShowFrames] = useState(false);

  const progress = durationInFrames > 0 ? frame / (durationInFrames - 1) : 0;

  const seekFromMouse = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(Math.round(ratio * (durationInFrames - 1)));
    },
    [durationInFrames, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      seekFromMouse(e.clientX);
    },
    [seekFromMouse],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) seekFromMouse(e.clientX);
    },
    [isDragging, seekFromMouse],
  );

  const handlePointerUp = useCallback(() => setIsDragging(false), []);

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5 border-t"
      style={{ borderColor: "var(--cc-border)", background: "var(--cc-bg-secondary, #18181b)" }}>
      {/* Timeline scrubber */}
      <div
        ref={trackRef}
        className="relative h-1.5 rounded-full cursor-pointer group"
        style={{ background: "var(--cc-bg-tertiary, #27272a)" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75"
          style={{ width: `${progress * 100}%`, background: "var(--cc-primary, #f97316)" }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress * 100}% - 6px)`, background: "var(--cc-primary, #f97316)" }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--cc-text-secondary, #a1a1aa)" }}>
        {/* Play/Pause */}
        <button
          onClick={onPlayPause}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 1.5v11l9-5.5z" />
            </svg>
          )}
        </button>

        {/* Time display */}
        <button
          className="font-mono text-[11px] tabular-nums hover:text-white transition-colors min-w-[120px] text-left"
          onClick={() => setShowFrames(!showFrames)}
          title="Click to toggle frame numbers"
        >
          {showFrames
            ? `${frame} / ${durationInFrames} f`
            : `${formatTime(frame, fps)} / ${formatTime(durationInFrames, fps)}`}
        </button>

        <div className="flex-1" />

        {/* Speed selector */}
        <div className="flex items-center gap-0.5">
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              onClick={() => onRateChange(speed)}
              className="px-1.5 py-0.5 rounded text-[11px] transition-colors"
              style={{
                background: playbackRate === speed ? "var(--cc-primary, #f97316)" : "transparent",
                color: playbackRate === speed ? "white" : undefined,
              }}
            >
              {speed}×
            </button>
          ))}
        </div>

        {/* Fullscreen */}
        <button
          onClick={() => playerRef.current?.requestFullscreen()}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title="Fullscreen"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the main viewer component**

Create `modes/remotion/viewer/RemotionPreview.tsx`:

```tsx
/**
 * RemotionPreview — Main viewer component for Remotion mode.
 *
 * Renders user compositions via @remotion/player with custom playback controls.
 * Uses JIT compilation (Babel) to compile user TSX in real-time.
 */

import { useCallback, useEffect, useRef, useState, type ErrorInfo, Component, type ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type {
  ViewerPreviewProps,
  ViewerActionRequest,
  ViewerActionResult,
  ViewerNotification,
} from "../../../core/types/viewer-contract.js";
import { useRemotionCompiler } from "./use-remotion-compiler.js";
import RemotionControls from "./RemotionControls.js";

// ── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class PlayerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Reset error when children change (new compilation)
    if (prevProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full p-8 text-center"
          style={{ color: "var(--cc-text-secondary)" }}>
          <div>
            <div className="text-red-400 text-sm font-medium mb-2">Runtime Error</div>
            <pre className="text-xs text-left max-w-lg overflow-auto p-3 rounded"
              style={{ background: "var(--cc-bg-tertiary)" }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Player Canvas (aspect-ratio-preserving scale) ────────────────────────────

/** Scales the Player to fit the container while preserving aspect ratio (CSS transform). */
function PlayerCanvas({
  comp,
  ActiveComponent,
  playerRef,
  playbackRate,
  onRuntimeError,
}: {
  comp: { width: number; height: number; durationInFrames: number; fps: number; id: string };
  ActiveComponent: React.ComponentType<Record<string, unknown>>;
  playerRef: React.RefObject<PlayerRef | null>;
  playbackRate: number;
  onRuntimeError: (error: Error) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect;
      if (cw > 0 && ch > 0) {
        setScale(Math.min(cw / comp.width, ch / comp.height));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [comp.width, comp.height]);

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden min-h-0"
      style={{ background: "#000" }}>
      <div style={{
        width: comp.width,
        height: comp.height,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}>
        <PlayerErrorBoundary onError={onRuntimeError}>
          <Player
            ref={playerRef}
            component={ActiveComponent}
            compositionWidth={comp.width}
            compositionHeight={comp.height}
            durationInFrames={comp.durationInFrames}
            fps={comp.fps}
            playbackRate={playbackRate}
            controls={false}
            style={{ width: comp.width, height: comp.height }}
          />
        </PlayerErrorBoundary>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function RemotionPreview({
  files,
  actionRequest,
  onActionResult,
  onNotifyAgent,
  readonly,
}: ViewerPreviewProps) {
  const playerRef = useRef<PlayerRef | null>(null);
  const { compositions, components, errors } = useRemotionCompiler(files);

  const [activeCompId, setActiveCompId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Auto-select first composition
  const activeComp = compositions.find((c) => c.id === activeCompId) || compositions[0];
  const ActiveComponent = activeComp ? components.get(activeComp.componentName) : null;

  // ── Player event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onFrame = () => setFrame(player.getCurrentFrame());
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);

    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [ActiveComponent]); // Re-attach when component changes

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const player = playerRef.current;
      if (!player) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;
        case "[":
          setPlaybackRate((r) => Math.max(0.25, r - 0.5));
          break;
        case "]":
          setPlaybackRate((r) => Math.min(4, r + 0.5));
          break;
        case "ArrowLeft":
          player.seekTo(Math.max(0, player.getCurrentFrame() - (e.shiftKey ? 10 : 1)));
          break;
        case "ArrowRight":
          player.seekTo(Math.min((activeComp?.durationInFrames ?? 1) - 1, player.getCurrentFrame() + (e.shiftKey ? 10 : 1)));
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeComp]);

  // ── Viewer actions (Agent → Viewer) ─────────────────────────────────────

  useEffect(() => {
    if (!actionRequest || !onActionResult) return;
    const { requestId, actionId, params } = actionRequest as ViewerActionRequest & { requestId: string };
    const player = playerRef.current;

    let result: ViewerActionResult;

    switch (actionId) {
      case "get-playback-state":
        result = {
          success: true,
          data: {
            compositionId: activeComp?.id ?? null,
            frame,
            fps: activeComp?.fps ?? 30,
            durationInFrames: activeComp?.durationInFrames ?? 0,
            width: activeComp?.width ?? 0,
            height: activeComp?.height ?? 0,
            playing,
            playbackRate,
            compositions: compositions.map((c) => ({ id: c.id, durationInFrames: c.durationInFrames, fps: c.fps })),
          },
        };
        break;

      case "seek-to-frame":
        if (player && typeof params?.frame === "number") {
          player.seekTo(params.frame);
          result = { success: true };
        } else {
          result = { success: false, message: "Invalid frame parameter" };
        }
        break;

      case "set-playback-rate":
        if (typeof params?.rate === "number" && params.rate >= 0.25 && params.rate <= 4) {
          setPlaybackRate(params.rate);
          result = { success: true };
        } else {
          result = { success: false, message: "Rate must be between 0.25 and 4" };
        }
        break;

      case "set-composition":
        if (typeof params?.compositionId === "string") {
          const found = compositions.find((c) => c.id === params.compositionId);
          if (found) {
            setActiveCompId(found.id);
            result = { success: true };
          } else {
            result = { success: false, message: `Composition "${params.compositionId}" not found` };
          }
        } else {
          result = { success: false, message: "Missing compositionId parameter" };
        }
        break;

      default:
        result = { success: false, message: `Unknown action: ${actionId}` };
    }

    onActionResult(requestId, result);
  }, [actionRequest]);

  // ── Notify agent on compilation errors ─────────────────────────────────

  useEffect(() => {
    if (errors.length === 0 || !onNotifyAgent) return;
    const errorMessages = errors.map((e) => `${e.file}: ${e.message}`).join("\n");
    const notification: ViewerNotification = {
      type: "compilation-error",
      message: `Compilation error in Remotion project:\n${errorMessages}\n\nPlease fix the code to restore the preview.`,
      severity: "warning",
      summary: `Build error: ${errors[0].message.slice(0, 80)}`,
    };
    onNotifyAgent(notification);
  }, [errors, onNotifyAgent]);

  // ── Render ──────────────────────────────────────────────────────────────

  // Error state
  if (errors.length > 0) {
    return (
      <div className="flex flex-col h-full" style={{ background: "var(--cc-bg, #09090b)" }}>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full">
            <div className="text-red-400 text-sm font-medium mb-3">Compilation Error</div>
            {errors.map((err, i) => (
              <div key={i} className="mb-2">
                <div className="text-xs font-mono mb-1" style={{ color: "var(--cc-text-secondary)" }}>
                  {err.file}{err.line ? `:${err.line}` : ""}
                </div>
                <pre className="text-xs p-3 rounded overflow-auto"
                  style={{ background: "var(--cc-bg-tertiary)", color: "var(--cc-text)" }}>
                  {err.message}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (compositions.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center" style={{ background: "var(--cc-bg, #09090b)", color: "var(--cc-text-secondary)" }}>
        <div className="text-center max-w-md">
          <div className="text-lg font-medium mb-2" style={{ color: "var(--cc-text)" }}>No Compositions</div>
          <p className="text-sm">
            Define compositions in <code className="px-1 py-0.5 rounded" style={{ background: "var(--cc-bg-tertiary)" }}>src/Root.tsx</code> using{" "}
            <code className="px-1 py-0.5 rounded" style={{ background: "var(--cc-bg-tertiary)" }}>&lt;Composition&gt;</code> to see a preview.
          </p>
        </div>
      </div>
    );
  }

  if (!activeComp || !ActiveComponent) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "var(--cc-bg, #09090b)", color: "var(--cc-text-secondary)" }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--cc-bg, #09090b)" }}>
      {/* Header bar */}
      <div className="flex items-center px-3 h-10 border-b shrink-0"
        style={{ borderColor: "var(--cc-border)", background: "var(--cc-bg-secondary, #18181b)" }}>
        {/* Composition selector */}
        {compositions.length > 1 && (
          <select
            value={activeComp.id}
            onChange={(e) => setActiveCompId(e.target.value)}
            className="text-xs px-2 py-1 rounded border-0 outline-none"
            style={{ background: "var(--cc-bg-tertiary)", color: "var(--cc-text)" }}
          >
            {compositions.map((c) => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
        )}
        {compositions.length === 1 && (
          <span className="text-xs" style={{ color: "var(--cc-text-secondary)" }}>{activeComp.id}</span>
        )}

        <div className="flex-1" />

        {/* Resolution badge */}
        <span className="text-[10px] font-mono mr-3" style={{ color: "var(--cc-text-tertiary, #52525b)" }}>
          {activeComp.width}×{activeComp.height} · {activeComp.fps}fps
        </span>
      </div>

      {/* Player canvas */}
      <PlayerCanvas
        comp={activeComp}
        ActiveComponent={ActiveComponent}
        playerRef={playerRef}
        playbackRate={playbackRate}
        onRuntimeError={(error) => {
          onNotifyAgent?.({
            type: "runtime-error",
            message: `Runtime error in composition "${activeComp.id}":\n${error.message}\n\nPlease fix the component code.`,
            severity: "warning",
            summary: `Runtime error: ${error.message.slice(0, 80)}`,
          });
        }}
      />

      {/* Playback controls */}
      {!readonly && (
        <RemotionControls
          playerRef={playerRef}
          frame={frame}
          durationInFrames={activeComp.durationInFrames}
          fps={activeComp.fps}
          playing={playing}
          playbackRate={playbackRate}
          onPlayPause={() => playerRef.current?.toggle()}
          onSeek={(f) => playerRef.current?.seekTo(f)}
          onRateChange={setPlaybackRate}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add modes/remotion/viewer/RemotionControls.tsx modes/remotion/viewer/RemotionPreview.tsx
git commit -m "feat(remotion): add viewer with Player and custom controls

RemotionPreview renders compositions via @remotion/player with JIT compilation.
Custom controls: timeline scrubber, play/pause, speed, composition selector.
Error boundary + compilation error display + agent notifications."
```

---

### Task 5: Manifest + ModeDefinition + Skill

Create the v2 manifest, mode definition binding, and updated skill file.

**Files:**
- Create: `modes/remotion/manifest.ts`
- Create: `modes/remotion/pneuma-mode.ts`
- Create: `modes/remotion/skill/SKILL.md`

- [ ] **Step 1: Write the manifest**

Create `modes/remotion/manifest.ts`:

```typescript
/**
 * Remotion Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const remotionManifest: ModeManifest = {
  name: "remotion",
  version: "0.1.0",
  displayName: "Remotion",
  description: "Programmatic video creation with React — live preview with custom Player",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/><line x1="12" y1="3" x2="12" y2="21" opacity="0.3"/></svg>`,
  supportedBackends: ["claude-code"],
  layout: "app",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-remotion",
    claudeMdSection: `## Pneuma Remotion Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build content together — you edit files, the user sees live results in a browser preview panel.

This is **Remotion Mode**: programmatic video creation with React.

**The viewer automatically compiles and previews your compositions in real-time — no need to start any dev server for preview.**

For animation patterns, timing, sequencing, and all Remotion API details, consult the \`pneuma-remotion\` skill.

### Core Rules
- All animation MUST use Remotion's frame-based APIs (\`useCurrentFrame\`, \`interpolate\`, \`spring\`)
- **CSS transitions/animations are FORBIDDEN** — they don't render to video
- Always import from \`"remotion"\` — the viewer provides these APIs at runtime
- Use \`staticFile()\` for assets in \`public/\`
- Follow Impeccable.style design principles for visual quality

### Architecture
- \`src/index.ts\` — Entry point (\`registerRoot()\`)
- \`src/Root.tsx\` — Composition registry (declare all compositions here)
- \`src/*.tsx\` — Video components
- \`public/\` — Static assets (reference via \`staticFile()\`)

### Viewer Capabilities
The viewer provides these agent-callable actions:
- \`get-playback-state\` — Query current composition, frame, playing state
- \`seek-to-frame\` — Navigate to a specific frame (\`params: { frame: number }\`)
- \`set-playback-rate\` — Adjust playback speed (\`params: { rate: number }\`)
- \`set-composition\` — Switch active composition (\`params: { compositionId: string }\`)

### Preview Limitations
The live preview compiles your code in-browser with core Remotion APIs. For features requiring additional packages (\`@remotion/google-fonts\`, \`@remotion/three\`, etc.), tell the user to use Remotion Studio: \`npx remotion studio\`.

### Constraints
- Do not modify \`.claude/\`, \`.pneuma/\`, or \`node_modules/\`
- Keep compositions in \`src/\` directory
- Use descriptive composition IDs (they appear in the viewer dropdown)`,
  },

  viewer: {
    watchPatterns: [
      "**/*.tsx",
      "**/*.ts",
      "**/*.css",
      "**/*.json",
      "**/*.svg",
      "**/*.png",
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.webp",
      "**/*.gif",
      "**/*.mp4",
      "**/*.webm",
      "**/*.mp3",
      "**/*.wav",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
      "dist/**",
      "build/**",
      "out/**",
    ],
    serveDir: ".",
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "get-playback-state",
        label: "Get Playback State",
        category: "custom",
        agentInvocable: true,
        description:
          "Query the current playback state: composition, frame, duration, playing, speed, all compositions list",
      },
      {
        id: "seek-to-frame",
        label: "Seek to Frame",
        category: "navigate",
        agentInvocable: true,
        params: {
          frame: {
            type: "number",
            description: "Target frame number (0-based)",
            required: true,
          },
        },
        description: "Navigate to a specific frame",
      },
      {
        id: "set-playback-rate",
        label: "Set Playback Rate",
        category: "ui",
        agentInvocable: true,
        params: {
          rate: {
            type: "number",
            description: "Playback speed (0.25 to 4)",
            required: true,
          },
        },
        description: "Change playback speed",
      },
      {
        id: "set-composition",
        label: "Switch Composition",
        category: "navigate",
        agentInvocable: true,
        params: {
          compositionId: {
            type: "string",
            description: "Composition ID to switch to",
            required: true,
          },
        },
        description: "Switch the active composition in the viewer",
      },
    ],
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Remotion" backend="claude-code">New Remotion session started. The viewer is ready — your compositions will preview live as you write them.</system-info>`,
  },

  init: {
    contentCheckPattern: "src/Root.tsx",
    seedFiles: {
      "modes/remotion/seed/default/": "./",
    },
  },

  evolution: {
    directive:
      "Extract the user's video style preferences: motion design (easing curves, timing, transitions), typography (fonts, sizes, weights), color palettes, composition layout patterns, pacing/rhythm, and visual effects.",
  },
};

export default remotionManifest;
```

- [ ] **Step 2: Write the mode definition**

Create `modes/remotion/pneuma-mode.ts`:

```typescript
/**
 * Remotion Mode Definition — binds manifest + viewer.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../core/types/viewer-contract.js";
import RemotionPreview from "./viewer/RemotionPreview.js";
import remotionManifest from "./manifest.js";
import { parseCompositions } from "./viewer/composition-parser.js";

const remotionMode: ModeDefinition = {
  manifest: remotionManifest,

  viewer: {
    PreviewComponent: RemotionPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    },

    actions: remotionManifest.viewerApi?.actions,

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      // Find Root.tsx to extract composition list
      const rootFile = files.find(
        (f) =>
          f.path.endsWith("/Root.tsx") ||
          f.path === "src/Root.tsx" ||
          f.path === "Root.tsx",
      );

      const compositions = rootFile
        ? parseCompositions(rootFile.content)
        : [];

      const lines: string[] = [];

      if (compositions.length > 0) {
        const compList = compositions
          .map(
            (c) =>
              `${c.id} (${(c.durationInFrames / c.fps).toFixed(1)}s, ${c.fps}fps, ${c.width}×${c.height})`,
          )
          .join(", ");
        lines.push(`Compositions: ${compList}`);
      } else {
        lines.push("Compositions: none detected");
      }

      // List source files for agent awareness
      const srcFiles = files
        .filter((f) => /\.(tsx?|jsx?)$/.test(f.path))
        .map((f) => f.path);
      if (srcFiles.length > 0) {
        lines.push(`Source files: ${srcFiles.join(", ")}`);
      }

      return `<viewer-context mode="remotion">\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default remotionMode;
```

- [ ] **Step 3: Write the updated skill file**

Create `modes/remotion/skill/SKILL.md`:

Take the v1 SKILL.md content and make these changes:
1. **Remove** the entire "Startup Checklist" section (Studio startup, `.pneuma/dev-server.json`, PID tracking, restart instructions)
2. **Replace** with a simpler note: the viewer handles preview automatically
3. **Keep** everything else: Impeccable.style guidelines, typography, color, motion, anti-slop checklist, Remotion API reference index

The file should start with:

```markdown
# Remotion Video Creation

You are a Remotion expert and motion designer creating programmatic videos with React inside Pneuma.

Your videos must be **visually distinctive and intentional** — not generic AI output. Every design decision (color, typography, timing, composition) must serve a clear creative direction.

## How Preview Works

The Pneuma viewer **automatically compiles and previews** your compositions in real-time as you edit files. No dev server startup needed.

**Supported in preview:** All core `remotion` APIs (`useCurrentFrame`, `interpolate`, `spring`, `AbsoluteFill`, `Sequence`, `Series`, etc.) and local file imports within `src/`.

**Not supported in preview:** External packages like `@remotion/google-fonts`, `@remotion/three`, `@remotion/motion-blur`. If the user needs these, they should run `npx remotion studio` separately.

## Project Structure

- `src/index.ts` — Entry point (`registerRoot()`)
- `src/Root.tsx` — Composition registry (all compositions declared here with `<Composition>`)
- `src/*.tsx` — Video components (one per composition)
- `public/` — Static assets (use `staticFile()` to reference)
- `remotion.config.ts` — Remotion CLI configuration

## Design Philosophy
```

Then continue with the existing Impeccable.style content (typography, color, motion, anti-slop checklist) and the Remotion API Reference section — all unchanged from v1.

- [ ] **Step 4: Commit**

```bash
git add modes/remotion/manifest.ts modes/remotion/pneuma-mode.ts modes/remotion/skill/SKILL.md
git commit -m "feat(remotion): add v2 manifest, mode definition, and updated skill

Manifest declares Player-based viewer actions (get-playback-state, seek-to-frame,
set-playback-rate, set-composition). Skill updated to remove Studio startup —
preview is automatic via JIT compilation."
```

---

### Task 6: Registration — mode-loader + server

Register the Remotion mode as a builtin.

**Files:**
- Modify: `core/mode-loader.ts:35-85` (add to builtinModes)
- Modify: `server/index.ts:76` (add to builtinNames)

- [ ] **Step 1: Add to mode-loader builtinModes**

In `core/mode-loader.ts`, add inside the `builtinModes` object (after the `illustrate` entry):

```typescript
  remotion: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/remotion/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/remotion/pneuma-mode.js").then((m) => m.default),
  },
```

- [ ] **Step 2: Add to server builtinNames**

In `server/index.ts`, find line 76:

```typescript
const builtinNames = ["webcraft", "slide", "doc", "draw", "illustrate"];
```

Change to:

```typescript
const builtinNames = ["webcraft", "slide", "doc", "draw", "illustrate", "remotion"];
```

- [ ] **Step 3: Run existing mode-loader tests**

```bash
bun test core/__tests__/mode-loader.test.ts
```

Expected: PASS — existing tests should still pass. If the test validates the mode list, it may now include "remotion".

- [ ] **Step 4: Commit**

```bash
git add core/mode-loader.ts server/index.ts
git commit -m "feat(remotion): register as builtin mode

Add to mode-loader builtinModes and server builtinNames."
```

---

### Task 7: End-to-End Verification

Start the mode, verify the full pipeline works: seed → compile → Player → controls → actions.

**Files:** None (testing only)

- [ ] **Step 1: Start dev server in Remotion mode with a temp workspace**

```bash
mkdir -p /tmp/test-remotion-mode
cd /tmp/test-remotion-mode
bun run --cwd /Users/pandazki/Codes/pneuma-skills dev remotion --workspace /tmp/test-remotion-mode --no-open --dev
```

Expected: Server starts. Seed files are copied to workspace. `bun install` runs automatically (because `package.json` was seeded). Logs show the server URL.

- [ ] **Step 2: Verify seed files were created**

```bash
ls /tmp/test-remotion-mode/src/
# Expected: Composition.tsx  Root.tsx  index.ts

cat /tmp/test-remotion-mode/src/Root.tsx
# Expected: RemotionRoot with <Composition> for MyComposition
```

- [ ] **Step 3: Open browser and verify preview renders**

Open the server URL in browser. Expected:
1. Viewer loads RemotionPreview component
2. JIT compiler parses Root.tsx, finds "MyComposition"
3. Compiles Composition.tsx and Root.tsx
4. Player renders the "Hello, Remotion" title with fade-in animation
5. Controls bar shows: play button, timeline at 0:00, speed selector, fullscreen button

- [ ] **Step 4: Test playback controls**

1. Click Play → animation plays
2. Click timeline → seeks to that position
3. Click 2× speed → plays at double speed
4. Press Space → toggles play/pause
5. Press Arrow keys → step through frames

- [ ] **Step 5: Test compilation error recovery**

1. Edit `src/Composition.tsx` — introduce a syntax error (e.g., delete a closing bracket)
2. Viewer should show error panel with file + error message
3. Fix the error → viewer recovers and shows preview again

- [ ] **Step 6: Test viewer actions via agent**

If agent is connected, test:
- Agent calls `get-playback-state` → returns composition info
- Agent calls `seek-to-frame` with `{ frame: 60 }` → player jumps to frame 60
- Agent edits `src/Composition.tsx` → preview updates live

- [ ] **Step 7: Clean up**

```bash
rm -rf /tmp/test-remotion-mode
```

- [ ] **Step 8: Commit any fixes found during E2E testing**

If any issues were found and fixed during E2E testing, commit them:

```bash
git add -A
git commit -m "fix(remotion): address E2E testing issues"
```

---

## Notes

### Babel Standalone in Bun

`@babel/standalone` is designed for browser environments. In Bun test environment, it may work directly or may need polyfills. If tests fail due to missing browser APIs:
- The composition parser tests (`parseCompositions`) are pure regex — always work
- The compiler tests (`compileModule`) depend on Babel — may need Bun's native transpiler as fallback
- The E2E test (Task 7) is the authoritative validation — runs in real browser

### Player Aspect Ratio

The `<Player>` component maintains its own aspect ratio based on `compositionWidth`/`compositionHeight`. The viewer wraps it in a flex container with `items-center justify-center` and black background to letterbox when the composition doesn't match the viewport.

### Hot Reload vs Full Reload

`updateStrategy: "full-reload"` means the viewer re-renders fully on file changes. The JIT compiler's 300ms debounce and content-hash caching prevent unnecessary recompilation. The Player doesn't seek to frame 0 on component change — it preserves the current position.

### Future Enhancements

1. **`capture-frame` action** — Deferred from spec (requires `html2canvas` or canvas capture, adds dependency). Screenshot via Player's `getContainerNode()` + html2canvas
2. **Studio integration** — "Open in Studio" button that starts `npx remotion studio` via agent
3. **`@remotion/*` package support** — Bundle additional packages or load from Studio's webpack
4. **Audio waveform** — Render audio waveform in timeline scrubber
5. **Thumbnail strip** — Frame thumbnails in scrubber on hover
