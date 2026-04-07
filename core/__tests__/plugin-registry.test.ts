import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PluginRegistry } from "../plugin-registry.js";
import { SettingsManager } from "../settings-manager.js";
import { HookBus } from "../hook-bus.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginManifest } from "../types/plugin.js";

const TEST_DIR = join(tmpdir(), `pneuma-registry-test-${Date.now()}`);
const PLUGINS_DIR = join(TEST_DIR, "plugins");

function writePluginManifest(dir: string, manifest: PluginManifest): void {
  mkdirSync(dir, { recursive: true });
  // Write as a JS module that can be imported
  writeFileSync(
    join(dir, "manifest.ts"),
    `export default ${JSON.stringify(manifest, null, 2)};`,
  );
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry;
  let settings: SettingsManager;
  let hookBus: HookBus;

  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
    settings = new SettingsManager(TEST_DIR);
    hookBus = new HookBus();
    registry = new PluginRegistry({
      builtinDir: join(TEST_DIR, "builtin-plugins"),
      externalDir: PLUGINS_DIR,
      settingsManager: settings,
      hookBus,
    });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("discover", () => {
    test("discovers plugins from external directory", async () => {
      writePluginManifest(join(PLUGINS_DIR, "my-plugin"), {
        name: "my-plugin",
        version: "1.0.0",
        displayName: "My Plugin",
        description: "Test",
        scope: "global",
      });

      const manifests = await registry.discover();
      expect(manifests.length).toBe(1);
      expect(manifests[0].name).toBe("my-plugin");
    });

    test("returns empty array when directories don't exist", async () => {
      const emptyRegistry = new PluginRegistry({
        builtinDir: "/nonexistent/builtin",
        externalDir: "/nonexistent/external",
        settingsManager: settings,
        hookBus,
      });
      const manifests = await emptyRegistry.discover();
      expect(manifests).toEqual([]);
    });
  });

  describe("filterEnabled", () => {
    test("filters out disabled plugins", () => {
      settings.setEnabled("enabled-plugin", true);
      settings.setEnabled("disabled-plugin", false);

      const manifests: PluginManifest[] = [
        { name: "enabled-plugin", version: "1.0.0", displayName: "A", description: "A", scope: "global" },
        { name: "disabled-plugin", version: "1.0.0", displayName: "B", description: "B", scope: "global" },
      ];

      const filtered = registry.filterEnabled(manifests);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("enabled-plugin");
    });

    test("builtin plugins are enabled by default", () => {
      const manifests: PluginManifest[] = [
        { name: "builtin-one", version: "1.0.0", displayName: "B", description: "B", scope: "global", builtin: true },
      ];

      const filtered = registry.filterEnabled(manifests);
      expect(filtered).toHaveLength(1);
    });
  });

  describe("resolveForSession", () => {
    test("global scope plugins match any mode", () => {
      const manifests: PluginManifest[] = [
        { name: "global-plugin", version: "1.0.0", displayName: "G", description: "G", scope: "global" },
      ];
      const resolved = registry.resolveForSession(manifests, "slide");
      expect(resolved).toHaveLength(1);
    });

    test("mode scope plugin matches compatible mode", () => {
      const manifests: PluginManifest[] = [
        { name: "slide-plugin", version: "1.0.0", displayName: "S", description: "S", scope: "mode", compatibleModes: ["slide", "webcraft"] },
      ];
      expect(registry.resolveForSession(manifests, "slide")).toHaveLength(1);
      expect(registry.resolveForSession(manifests, "doc")).toHaveLength(0);
    });

    test("mode scope plugin with no compatibleModes matches all modes", () => {
      const manifests: PluginManifest[] = [
        { name: "any-mode-plugin", version: "1.0.0", displayName: "A", description: "A", scope: "mode" },
      ];
      expect(registry.resolveForSession(manifests, "slide")).toHaveLength(1);
      expect(registry.resolveForSession(manifests, "doc")).toHaveLength(1);
    });
  });

  describe("getSlotEntries", () => {
    test("returns slot entries from loaded plugins", async () => {
      const manifestWithSlots = {
        name: "slot-plugin",
        version: "1.0.0",
        displayName: "Slot Plugin",
        description: "Test",
        scope: "global" as const,
        slots: {
          "deploy:pre-publish": {
            type: "form" as const,
            fields: [
              { name: "tag", label: "Tag", type: "text" as const },
            ],
          },
        },
      };
      writePluginManifest(join(PLUGINS_DIR, "slot-plugin"), manifestWithSlots);
      settings.setEnabled("slot-plugin", true);

      const discovered = await registry.discover();
      const enabled = registry.filterEnabled(discovered);
      await registry.activateAll(enabled as any, {
        sessionId: "test",
        mode: "slide",
        workspace: "/tmp",
        backendType: "claude-code",
      });

      const entries = registry.getSlotEntries("deploy:pre-publish");
      expect(entries).toHaveLength(1);
      expect(entries[0].pluginName).toBe("slot-plugin");
      expect((entries[0].declaration as any).type).toBe("form");
      expect((entries[0].declaration as any).fields).toHaveLength(1);
    });

    test("returns empty array for slot with no registrations", () => {
      const entries = registry.getSlotEntries("deploy:post-result");
      expect(entries).toEqual([]);
    });
  });
});
