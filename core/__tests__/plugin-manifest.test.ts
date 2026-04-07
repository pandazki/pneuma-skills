/**
 * PluginManifest contract tests
 *
 * Validates PluginManifest type constraints:
 * - Required field completeness
 * - Optional field semantics
 * - FormField and SettingField shapes
 */

import { describe, test, expect } from "bun:test";
import type {
  PluginManifest,
  HookName,
  SlotName,
  FormSlotDeclaration,
  SettingField,
} from "../types/plugin.js";

// ── Helper: create minimal valid manifest ─────────────────────────────────

function createMinimalManifest(overrides?: Partial<PluginManifest>): PluginManifest {
  return {
    name: "test-plugin",
    version: "1.0.0",
    displayName: "Test Plugin",
    description: "A test plugin",
    scope: "global",
    ...overrides,
  };
}

// ── PluginManifest required fields ──────────────────────────────────────────

describe("PluginManifest required fields", () => {
  test("minimal manifest has all required fields", () => {
    const manifest = createMinimalManifest();
    expect(manifest.name).toBe("test-plugin");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.displayName).toBe("Test Plugin");
    expect(manifest.description).toBe("A test plugin");
    expect(manifest.scope).toBe("global");
  });

  test("name should be a non-empty string", () => {
    const manifest = createMinimalManifest({ name: "my-plugin" });
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  test("scope must be global or mode", () => {
    const global = createMinimalManifest({ scope: "global" });
    const mode = createMinimalManifest({ scope: "mode" });
    expect(["global", "mode"]).toContain(global.scope);
    expect(["global", "mode"]).toContain(mode.scope);
  });
});

// ── Optional fields ─────────────────────────────────────────────────────────

describe("PluginManifest optional fields", () => {
  test("compatibleModes defaults to undefined (all modes)", () => {
    const manifest = createMinimalManifest();
    expect(manifest.compatibleModes).toBeUndefined();
  });

  test("compatibleModes can be set to specific modes", () => {
    const manifest = createMinimalManifest({ compatibleModes: ["slide", "webcraft"] });
    expect(manifest.compatibleModes).toEqual(["slide", "webcraft"]);
  });

  test("builtin defaults to undefined", () => {
    const manifest = createMinimalManifest();
    expect(manifest.builtin).toBeUndefined();
  });

  test("hooks is optional record of HookName to path", () => {
    const manifest = createMinimalManifest({
      hooks: { "deploy:before": "./hooks/deploy.ts" },
    });
    expect(manifest.hooks!["deploy:before"]).toBe("./hooks/deploy.ts");
  });

  test("slots supports string (custom component) declaration", () => {
    const manifest = createMinimalManifest({
      slots: { "deploy:provider": "./ui/Panel.tsx" },
    });
    expect(manifest.slots!["deploy:provider"]).toBe("./ui/Panel.tsx");
  });

  test("slots supports FormSlotDeclaration", () => {
    const formSlot: FormSlotDeclaration = {
      type: "form",
      fields: [
        { name: "tag", label: "Tag", type: "select", options: [{ label: "Prod", value: "prod" }] },
        { name: "note", label: "Note", type: "textarea" },
      ],
    };
    const manifest = createMinimalManifest({
      slots: { "deploy:pre-publish": formSlot },
    });
    const slot = manifest.slots!["deploy:pre-publish"] as FormSlotDeclaration;
    expect(slot.type).toBe("form");
    expect(slot.fields).toHaveLength(2);
    expect(slot.fields[0].name).toBe("tag");
    expect(slot.fields[0].type).toBe("select");
    expect(slot.fields[0].options).toHaveLength(1);
  });

  test("settings field types are correct", () => {
    const settings: Record<string, SettingField> = {
      token: { type: "password", label: "API Token", required: true },
      teamId: { type: "string", label: "Team ID" },
      enabled: { type: "boolean", label: "Enabled", defaultValue: true },
    };
    const manifest = createMinimalManifest({ settings });
    expect(manifest.settings!.token.type).toBe("password");
    expect(manifest.settings!.token.required).toBe(true);
    expect(manifest.settings!.enabled.defaultValue).toBe(true);
  });

  test("routes and routePrefix are optional", () => {
    const manifest = createMinimalManifest({
      routes: "./routes.ts",
      routePrefix: "/api/plugins/custom",
    });
    expect(manifest.routes).toBe("./routes.ts");
    expect(manifest.routePrefix).toBe("/api/plugins/custom");
  });
});
