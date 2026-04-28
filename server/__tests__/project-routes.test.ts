import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { startServer } from "../index.js";
import { recentProjectsRegistryPath } from "../../core/project.js";

const TEST_PORT = 19891;
const TEST_WORKSPACE = join(tmpdir(), `pneuma-project-routes-workspace-${Date.now()}`);
const TEST_PROJECT = join(tmpdir(), `pneuma-project-routes-project-${Date.now()}`);
const REGISTRY_PATH = recentProjectsRegistryPath(homedir());

let server: Awaited<ReturnType<typeof startServer>>;
let registryBackup: string | null = null;
let hadRegistry = false;

function api(path: string, init?: RequestInit) {
  return fetch(`http://localhost:${TEST_PORT}${path}`, init);
}

describe("project launcher routes", () => {
  beforeAll(async () => {
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(TEST_PROJECT, { recursive: true });
    hadRegistry = existsSync(REGISTRY_PATH);
    if (hadRegistry) registryBackup = readFileSync(REGISTRY_PATH, "utf-8");

    server = await startServer({
      port: TEST_PORT,
      workspace: TEST_WORKSPACE,
      launcherMode: true,
    });
  });

  afterAll(() => {
    server?.stop?.();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    rmSync(TEST_PROJECT, { recursive: true, force: true });
    if (hadRegistry && registryBackup !== null) {
      writeFileSync(REGISTRY_PATH, registryBackup);
    } else {
      rmSync(REGISTRY_PATH, { force: true });
    }
  });

  test("GET /api/projects returns a projects array", async () => {
    const res = await api("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: unknown[] };
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test("POST /api/projects creates an explicit project", async () => {
    const res = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: TEST_PROJECT,
        name: "Route Project",
        description: "Created from the launcher API",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { project: { name: string; root: string } };
    expect(body.project.name).toBe("Route Project");
    expect(body.project.root).toBe(TEST_PROJECT);
  });

  test("GET /api/projects includes newly created projects", async () => {
    const res = await api("/api/projects");
    const body = await res.json() as { projects: Array<{ name: string; root: string }> };
    expect(body.projects.some((p) => p.name === "Route Project" && p.root === TEST_PROJECT)).toBe(true);
  });
});
