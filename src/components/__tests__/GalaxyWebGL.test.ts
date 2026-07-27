import { describe, expect, it } from "bun:test";
import { resolveWebGLContext } from "../reactbits/webgl.js";

type ContextKind = "webgl2" | "webgl";
type TestWebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

function fakeCanvas(contexts: Partial<Record<ContextKind, TestWebGLContext>>) {
  const calls: string[] = [];
  const canvas = {
    getContext(kind: string) {
      calls.push(kind);
      return contexts[kind as ContextKind] ?? null;
    },
  } as unknown as HTMLCanvasElement;

  return { calls, canvas };
}

describe("resolveWebGLContext", () => {
  it("prefers WebGL2 without creating a second context", () => {
    const webgl2 = {} as WebGL2RenderingContext;
    const { calls, canvas } = fakeCanvas({
      webgl2,
      webgl: {} as WebGLRenderingContext,
    });

    expect(resolveWebGLContext(canvas)).toBe(webgl2);
    expect(calls).toEqual(["webgl2"]);
  });

  it("falls back to WebGL1", () => {
    const webgl = {} as WebGLRenderingContext;
    const { calls, canvas } = fakeCanvas({ webgl });

    expect(resolveWebGLContext(canvas)).toBe(webgl);
    expect(calls).toEqual(["webgl2", "webgl"]);
  });

  it("returns null when WebGL is unavailable", () => {
    const { calls, canvas } = fakeCanvas({});

    expect(resolveWebGLContext(canvas)).toBeNull();
    expect(calls).toEqual(["webgl2", "webgl"]);
  });
});
