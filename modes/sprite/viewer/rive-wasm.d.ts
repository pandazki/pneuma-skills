// The Rive runtime's WebAssembly, imported for its URL.
//
// Both bundlers this viewer goes through emit the file as an asset and hand
// back its URL: Bun.build's `file` loader (catalog `.build/`, served under
// /mode-assets/) and Vite with `assetsInclude: ["**/*.wasm"]` (dev server and
// the hosted player). See `rive-runtime.ts`.
declare module "@rive-app/canvas/rive.wasm" {
  const url: string;
  export default url;
}
