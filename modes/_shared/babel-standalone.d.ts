// Ambient declaration for @babel/standalone (ships no types).
// Used by the Remotion and GridBoard in-browser tile/composition compilers.
declare module "@babel/standalone" {
  export interface BabelTransformOptions {
    presets?: unknown[];
    plugins?: unknown[];
    filename?: string;
    sourceType?: "module" | "script" | "unambiguous";
    [key: string]: unknown;
  }
  export interface BabelTransformResult {
    code: string | null;
    map?: unknown;
    ast?: unknown;
  }
  export function transform(code: string, options?: BabelTransformOptions): BabelTransformResult;
  export function registerPlugin(name: string, plugin: unknown): void;
  export function registerPreset(name: string, preset: unknown): void;
  export const availablePlugins: Record<string, unknown>;
  export const availablePresets: Record<string, unknown>;
}
