import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllBackendModules } from "../../backends/index.js";
import { setBackendDisabled } from "../../core/backend-prefs.js";
import type { AgentBackendType, BackendOptions } from "../../core/types/agent-backend.js";
import { registerBackendAvailabilityRoute } from "../backend-availability-route.js";

test("availability checks only requested backends, preserving legacy Settings and saved-session results", async () => {
  const originalHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "pneuma-availability-"));
  const calls: AgentBackendType[] = [];
  const modules = getAllBackendModules();
  const spies = modules.map(module => spyOn(module, "checkRequirements").mockImplementation(() => {
    calls.push(module.type);
    return module.type === "kimi-cli" ? { ok: false, reason: "Requires Kimi Code" } : { ok: true, binaryPath: "/bin/agent" };
  }));

  try {
    process.env.HOME = home;
    setBackendDisabled("kimi-cli", true);
    const app = new Hono();
    registerBackendAvailabilityRoute(app);
    expect(calls).toEqual([]);

    const read = async (query: string) => {
      calls.length = 0;
      const response = await app.request("/api/backends" + query);
      expect(response.status).toBe(200);
      return await response.json() as BackendOptions;
    };
    const enabled = await read("?scope=enabled");
    expect(calls).toEqual(["claude-code"]);
    expect(enabled.backends.map(b => b.type)).toEqual(["claude-code", "codex"]);
    expect(enabled.backends[1].available).toBeUndefined();
    const explicit = await read("?scope=enabled&preferred=codex");
    expect(calls).toEqual(["codex"]);
    expect(explicit.backends.find(b => b.type === "codex")?.available).toBe(true);

    const saved = await read("?type=kimi-cli");
    expect(calls).toEqual(["kimi-cli"]);
    expect(saved.backends).toHaveLength(1);
    expect(saved.backends[0]).toMatchObject({ type: "kimi-cli", available: false, disabled: true, reason: "Requires Kimi Code" });

    const legacy = await read("?type=default");
    expect(calls).toEqual([legacy.defaultBackendType]);

    const full = await read("");
    expect(calls).toEqual(modules.map(m => m.type));
    expect(full.defaultBackendType).toBe("claude-code");
    expect(full.backends[0]).toEqual({
      type: "claude-code", label: modules[0].label, description: modules[0].description,
      implemented: true, available: true, disabled: false,
    });
    expect(full.backends.at(-1)).toEqual(saved.backends[0]);

    calls.length = 0;
    for (const query of ["?type=missing", "?type=", "?scope=unknown", "?type=codex&scope=enabled"]) {
      expect((await app.request("/api/backends" + query)).status).toBe(400);
    }
    expect(calls).toEqual([]);
    spies[0].mockImplementation(() => {
      calls.push(modules[0].type);
      return { ok: false, reason: "missing" };
    });
    const fallback = await read("?scope=enabled");
    expect(calls).toEqual(["claude-code", "codex"]);
    expect(fallback.backends.map(b => b.available)).toEqual([false, true]);
    setBackendDisabled("codex", true);
    setBackendDisabled("claude-code", true);
    expect((await read("?scope=enabled")).backends).toEqual([]);
    expect(calls).toEqual([]);
  } finally {
    for (const spy of spies) spy.mockRestore();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  }
});
