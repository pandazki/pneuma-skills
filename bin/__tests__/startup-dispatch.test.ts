import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStartupContext } from "../startup-dispatch.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pneuma-dispatch-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("resolveStartupContext", () => {
  test("workspace without project.json → quick context", async () => {
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("quick");
    expect(ctx.paths.sessionDir).toBe(tmp);
    expect(ctx.paths.projectRoot).toBeNull();
  });

  test("workspace WITH project.json → project context, generates session id", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("project");
    expect(ctx.paths.projectRoot).toBe(tmp);
    expect(ctx.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ctx.paths.sessionDir).toBe(join(tmp, ".pneuma", "sessions", ctx.sessionId));
  });

  test("explicit --project overrides workspace detection", async () => {
    const proj = join(tmp, "proj");
    await mkdir(join(proj, ".pneuma"), { recursive: true });
    await writeFile(
      join(proj, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: proj,
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("project");
    expect(ctx.paths.projectRoot).toBe(proj);
  });

  test("--session-id reuses given id", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "fixed-id",
    });
    expect(ctx.sessionId).toBe("fixed-id");
    expect(ctx.paths.sessionDir).toBe(join(tmp, ".pneuma", "sessions", "fixed-id"));
  });
});
