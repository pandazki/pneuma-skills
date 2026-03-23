import { describe, test, expect } from "bun:test";
import { parseCompositions } from "../../modes/remotion/viewer/composition-parser.js";
import { resolveImportOrder, compileModule, buildModuleMap } from "../../modes/remotion/viewer/remotion-compiler.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

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

// ── JIT Compiler Tests ──────────────────────────────────────────────────────

describe("resolveImportOrder", () => {
  test("sorts files by dependency order (leaves first)", () => {
    const files: ViewerFileContent[] = [
      { path: "src/Root.tsx", content: 'import { MyComp } from "./Composition";' },
      { path: "src/Composition.tsx", content: 'import { useCurrentFrame } from "remotion";' },
      { path: "src/index.ts", content: 'import { RemotionRoot } from "./Root";' },
    ];
    const order = resolveImportOrder(files);
    const paths = order.map((f) => f.path);
    expect(paths.indexOf("src/Composition.tsx")).toBeLessThan(paths.indexOf("src/Root.tsx"));
    expect(paths.indexOf("src/Root.tsx")).toBeLessThan(paths.indexOf("src/index.ts"));
  });

  test("handles files with no local imports", () => {
    const files: ViewerFileContent[] = [
      { path: "src/A.ts", content: 'export const A = 1;' },
      { path: "src/B.ts", content: 'export const B = 2;' },
    ];
    const order = resolveImportOrder(files);
    expect(order).toHaveLength(2);
  });

  test("handles circular dependencies without infinite loop", () => {
    const files: ViewerFileContent[] = [
      { path: "src/A.ts", content: 'import { B } from "./B";' },
      { path: "src/B.ts", content: 'import { A } from "./A";' },
    ];
    const order = resolveImportOrder(files);
    expect(order).toHaveLength(2);
  });

  test("filters non-source files", () => {
    const files: ViewerFileContent[] = [
      { path: "src/A.ts", content: 'export const A = 1;' },
      { path: "src/style.css", content: 'body {}' },
      { path: "README.md", content: '# Hello' },
    ];
    const order = resolveImportOrder(files);
    expect(order).toHaveLength(1);
    expect(order[0].path).toBe("src/A.ts");
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
    expect((result.add as Function)(2, 3)).toBe(5);
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

  test("handles default exports", () => {
    const source = `
const MyComponent = () => "hello";
export default MyComponent;
`;
    const result = compileModule(source, "test.tsx", {});
    expect(typeof result.default).toBe("function");
  });

  test("handles export { name }", () => {
    const source = `
const x = 42;
export { x };
`;
    const result = compileModule(source, "test.tsx", {});
    expect(result.x).toBe(42);
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

  test("continues compiling when one file has errors", () => {
    const files: ViewerFileContent[] = [
      { path: "src/good.ts", content: 'export const A = 1;' },
      { path: "src/bad.ts", content: 'import { foo } from "nonexistent";' },
    ];
    const result = buildModuleMap(files, {});
    expect(result.get("src/good.ts")?.A).toBe(1);
    expect(result.get("src/bad.ts")?.__error).toBeDefined();
  });
});
