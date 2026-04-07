import { describe, test, expect, beforeEach } from "bun:test";
import { HookBus } from "../hook-bus.js";
import type { SessionInfo } from "../types/plugin.js";

const mockSession: SessionInfo = {
  sessionId: "test-session",
  mode: "slide",
  workspace: "/tmp/test",
  backendType: "claude-code",
};

describe("HookBus", () => {
  let bus: HookBus;

  beforeEach(() => {
    bus = new HookBus();
  });

  test("emit returns original payload when no handlers registered", async () => {
    const payload = { files: [], projectName: "test" };
    const result = await bus.emit("deploy:before", payload, mockSession);
    expect(result).toEqual(payload);
  });

  test("handler can modify payload (waterfall)", async () => {
    bus.on("deploy:before", "test-plugin", async (ctx) => {
      return { ...ctx.payload, injected: true };
    });

    const result = await bus.emit(
      "deploy:before",
      { files: [] } as Record<string, unknown>,
      mockSession,
    );
    expect((result as any).injected).toBe(true);
    expect((result as any).files).toEqual([]);
  });

  test("multiple handlers execute in registration order", async () => {
    const order: string[] = [];

    bus.on("deploy:before", "plugin-a", async (ctx) => {
      order.push("a");
      return { ...ctx.payload, a: true };
    });

    bus.on("deploy:before", "plugin-b", async (ctx) => {
      order.push("b");
      return { ...ctx.payload, b: true };
    });

    const result = await bus.emit(
      "deploy:before",
      {} as Record<string, unknown>,
      mockSession,
    );
    expect(order).toEqual(["a", "b"]);
    expect((result as any).a).toBe(true);
    expect((result as any).b).toBe(true);
  });

  test("handler returning void does not replace payload", async () => {
    bus.on("deploy:before", "logger", async () => {
      // side effect only, no return
    });

    const payload = { value: 42 };
    const result = await bus.emit("deploy:before", payload, mockSession);
    expect(result).toEqual({ value: 42 });
  });

  test("handler error is caught — other handlers still execute", async () => {
    const errors: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => errors.push(String(args[0]));

    bus.on("deploy:before", "bad-plugin", async () => {
      throw new Error("boom");
    });

    bus.on("deploy:before", "good-plugin", async (ctx) => {
      return { ...ctx.payload, good: true };
    });

    const result = await bus.emit(
      "deploy:before",
      {} as Record<string, unknown>,
      mockSession,
    );
    expect((result as any).good).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("bad-plugin");

    console.warn = origWarn;
  });

  test("off removes a handler", async () => {
    bus.on("deploy:before", "removable", async (ctx) => {
      return { ...ctx.payload, removed: false };
    });

    bus.off("deploy:before", "removable");

    const result = await bus.emit("deploy:before", { removed: true }, mockSession);
    expect((result as any).removed).toBe(true);
  });

  test("setPluginConfig provides settings to handler", async () => {
    bus.setPluginConfig("my-plugin", { token: "abc" });

    bus.on("deploy:before", "my-plugin", async (ctx) => {
      return { ...ctx.payload, token: ctx.settings.token };
    });

    const result = await bus.emit("deploy:before", {} as Record<string, unknown>, mockSession);
    expect((result as any).token).toBe("abc");
  });
});
