export type GalaxyWebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

export function resolveWebGLContext(
  canvas: HTMLCanvasElement,
  attributes?: WebGLContextAttributes,
): GalaxyWebGLContext | null {
  return (
    canvas.getContext("webgl2", attributes) ??
    canvas.getContext("webgl", attributes)
  );
}
