import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SettingsManager } from "../settings-manager.js";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `pneuma-settings-test-${Date.now()}`);

describe("SettingsManager", () => {
  let manager: SettingsManager;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new SettingsManager(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("getAll returns empty plugins when no settings file exists", () => {
    const all = manager.getAll();
    expect(all.plugins).toEqual({});
  });

  test("isEnabled returns false for unknown plugin", () => {
    expect(manager.isEnabled("unknown")).toBe(false);
  });

  test("setEnabled creates entry and persists", () => {
    manager.setEnabled("test-plugin", true);
    expect(manager.isEnabled("test-plugin")).toBe(true);

    // Re-read from disk
    const fresh = new SettingsManager(TEST_DIR);
    expect(fresh.isEnabled("test-plugin")).toBe(true);
  });

  test("setEnabled can disable a plugin", () => {
    manager.setEnabled("test-plugin", true);
    manager.setEnabled("test-plugin", false);
    expect(manager.isEnabled("test-plugin")).toBe(false);
  });

  test("getPluginConfig returns empty object for unknown plugin", () => {
    expect(manager.getPluginConfig("unknown")).toEqual({});
  });

  test("updateConfig persists config", () => {
    manager.updateConfig("my-plugin", { token: "abc", teamId: "t1" });
    expect(manager.getPluginConfig("my-plugin")).toEqual({ token: "abc", teamId: "t1" });

    // Re-read from disk
    const fresh = new SettingsManager(TEST_DIR);
    expect(fresh.getPluginConfig("my-plugin")).toEqual({ token: "abc", teamId: "t1" });
  });

  test("updateConfig merges with existing config", () => {
    manager.updateConfig("my-plugin", { token: "abc" });
    manager.updateConfig("my-plugin", { teamId: "t1" });
    expect(manager.getPluginConfig("my-plugin")).toEqual({ token: "abc", teamId: "t1" });
  });

  test("migrateIfNeeded migrates vercel.json", () => {
    writeFileSync(join(TEST_DIR, "vercel.json"), JSON.stringify({ token: "vtoken", teamId: "vteam" }));
    manager.migrateIfNeeded();

    expect(manager.getPluginConfig("vercel-deploy")).toEqual({ token: "vtoken", teamId: "vteam" });
    expect(manager.isEnabled("vercel-deploy")).toBe(true);
    expect(existsSync(join(TEST_DIR, "vercel.json"))).toBe(true);
  });

  test("migrateIfNeeded migrates cloudflare-pages.json", () => {
    writeFileSync(
      join(TEST_DIR, "cloudflare-pages.json"),
      JSON.stringify({ token: "cftoken", accountId: "acc1" }),
    );
    manager.migrateIfNeeded();

    expect(manager.getPluginConfig("cf-pages-deploy")).toEqual({ token: "cftoken", accountId: "acc1" });
    expect(manager.isEnabled("cf-pages-deploy")).toBe(true);
    expect(existsSync(join(TEST_DIR, "cloudflare-pages.json"))).toBe(true);
  });

  test("migrateIfNeeded does nothing when no legacy files exist", () => {
    manager.migrateIfNeeded();
    expect(manager.getAll().plugins).toEqual({});
  });

  test("migrateIfNeeded does not overwrite existing plugin config", () => {
    manager.updateConfig("vercel-deploy", { token: "existing" });
    manager.setEnabled("vercel-deploy", true);
    writeFileSync(join(TEST_DIR, "vercel.json"), JSON.stringify({ token: "legacy" }));

    manager.migrateIfNeeded();
    // Existing config preserved
    expect(manager.getPluginConfig("vercel-deploy").token).toBe("existing");
  });
});
