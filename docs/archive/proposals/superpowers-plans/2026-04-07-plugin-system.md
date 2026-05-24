# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a plugin system with hooks, UI slots, route extensions, and settings — then migrate Vercel/CF Pages deploy into builtin plugins.

**Architecture:** Plugin Registry discovers manifests from `plugins/` (builtin) and `~/.pneuma/plugins/` (third-party), filters by settings enabled state, resolves by mode/scope, and dynamically loads hooks (HookBus), UI slots (SlotRegistry), and routes (Hono sub-apps). A SettingsManager persists plugin config to `~/.pneuma/settings.json`.

**Tech Stack:** TypeScript, Bun, Hono 4.7, React 19, Zustand 5, bun:test

**Spec:** `docs/superpowers/specs/2026-04-07-plugin-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `core/types/plugin.ts` | PluginManifest, HookName, SlotName, SettingField, FormField types |
| `core/hook-bus.ts` | HookBus — waterfall event execution with soft error |
| `core/settings-manager.ts` | Read/write `~/.pneuma/settings.json`, migration from legacy config |
| `core/plugin-registry.ts` | Discovery, filtering, loading, activation, route mounting |
| `plugins/vercel/manifest.ts` | Vercel plugin manifest declaration |
| `plugins/vercel/routes.ts` | Vercel Hono sub-app (status, teams, binding, deploy) |
| `plugins/vercel/hooks.ts` | deploy:providers hook |
| `plugins/cf-pages/manifest.ts` | CF Pages plugin manifest declaration |
| `plugins/cf-pages/routes.ts` | CF Pages Hono sub-app (status, binding, deploy) |
| `plugins/cf-pages/hooks.ts` | deploy:providers hook |
| `src/store/plugin-slice.ts` | Zustand slice for active plugins, slot registry |
| `core/__tests__/plugin-manifest.test.ts` | Plugin manifest contract tests |
| `core/__tests__/hook-bus.test.ts` | HookBus unit tests |
| `core/__tests__/settings-manager.test.ts` | SettingsManager unit tests |
| `core/__tests__/plugin-registry.test.ts` | PluginRegistry unit tests |

### Modified Files

| File | Change |
|------|--------|
| `core/types/index.ts` | Re-export plugin types |
| `src/store/types.ts` | Add PluginSlice to AppState |
| `src/store/index.ts` | Add createPluginSlice |
| `server/index.ts` | Replace hardcoded Vercel/CF routes with plugin registry; add plugin API routes |

---

## Task 1: Plugin Type Definitions

**Files:**
- Create: `core/types/plugin.ts`
- Modify: `core/types/index.ts`
- Test: `core/__tests__/plugin-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/__tests__/plugin-manifest.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/plugin-manifest.test.ts`
Expected: FAIL — `Cannot find module "../types/plugin.js"`

- [ ] **Step 3: Write the type definitions**

Create `core/types/plugin.ts`:

```typescript
/**
 * PluginManifest — Plugin Capability Declaration
 *
 * Declarative description of a Plugin's capabilities.
 * Read by PluginRegistry to drive discovery, loading, and activation.
 */

// ── Hook Names ──────────────────────────────────────────────────────────────

export type HookName =
  | "deploy:providers"
  | "deploy:before"
  | "deploy:after"
  | "session:start"
  | "session:end"
  | "export:before"
  | "export:after";

// ── Slot Names ──────────────────────────────────────────────────────────────

export type SlotName =
  | "deploy:provider"
  | "deploy:pre-publish"
  | "deploy:post-result"
  | "settings:section";

// ── Form Fields ─────────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  label: string;
  type: "text" | "password" | "select" | "checkbox" | "textarea";
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  description?: string;
}

export interface FormSlotDeclaration {
  type: "form";
  fields: FormField[];
}

export type SlotDeclaration = string | FormSlotDeclaration;

// ── Setting Fields ──────────────────────────────────────────────────────────

export interface SettingField {
  type: "string" | "password" | "number" | "boolean" | "select";
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
}

// ── Plugin Manifest ─────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique plugin identifier, e.g. "vercel-deploy" */
  name: string;
  version: string;
  displayName: string;
  description: string;
  /** True for pre-installed plugins shipped with Pneuma */
  builtin?: boolean;

  /** "global" = all sessions; "mode" = only matching modes */
  scope: "global" | "mode";
  /** When scope is "mode", which modes this plugin supports. Omit = all modes. */
  compatibleModes?: string[];

  /** Data layer: hookName → relative path to handler module */
  hooks?: Partial<Record<HookName, string>>;

  /** UI layer: slotName → custom component path or declarative form */
  slots?: Partial<Record<SlotName, SlotDeclaration>>;

  /** Service layer: relative path to module exporting Hono sub-app factory */
  routes?: string;
  /** Route mount prefix. Default: /api/plugins/{name} */
  routePrefix?: string;

  /** Config layer: settings schema for auto-rendered settings UI */
  settings?: Record<string, SettingField>;

  /** Lifecycle: relative path to activate(context) function */
  activate?: string;
  /** Lifecycle: relative path to deactivate() function */
  deactivate?: string;
}

// ── Hook Context ────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  mode: string;
  workspace: string;
  backendType: string;
}

export interface HookContext<T = unknown> {
  payload: T;
  plugin: { name: string };
  session: SessionInfo;
  settings: Record<string, unknown>;
}

export type HookHandler<T = unknown> = (
  context: HookContext<T>,
) => Promise<T | void> | T | void;

// ── Plugin Route Context ────────────────────────────────────────────────────

export interface DeployBinding {
  vercel?: Record<string, unknown>;
  cfPages?: Record<string, unknown>;
  [key: string]: Record<string, unknown> | undefined;
}

export interface PluginRouteContext {
  workspace: string;
  session: SessionInfo;
  settings: Record<string, unknown>;
  getDeployBinding(): DeployBinding;
  saveDeployBinding(binding: DeployBinding): void;
}

// ── Loaded Plugin ───────────────────────────────────────────────────────────

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory */
  basePath: string;
  hooks: Partial<Record<HookName, HookHandler>>;
  routes: ((ctx: PluginRouteContext) => unknown) | null;
}

// ── Settings Storage ────────────────────────────────────────────────────────

export interface PluginSettingsEntry {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginSettings {
  plugins: Record<string, PluginSettingsEntry>;
}
```

- [ ] **Step 4: Add re-export to core/types/index.ts**

Add to the end of `core/types/index.ts`:

```typescript
export type {
  PluginManifest,
  HookName,
  SlotName,
  SlotDeclaration,
  FormSlotDeclaration,
  FormField,
  SettingField,
  SessionInfo,
  HookContext,
  HookHandler,
  PluginRouteContext,
  DeployBinding,
  LoadedPlugin,
  PluginSettingsEntry,
  PluginSettings,
} from "./plugin.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test core/__tests__/plugin-manifest.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add core/types/plugin.ts core/types/index.ts core/__tests__/plugin-manifest.test.ts
git commit -m "feat(plugin): add plugin type definitions and contract tests"
```

---

## Task 2: HookBus

**Files:**
- Create: `core/hook-bus.ts`
- Test: `core/__tests__/hook-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/__tests__/hook-bus.test.ts`:

```typescript
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

    bus.on("my-plugin-hook" as any, "my-plugin", async (ctx) => {
      return { ...ctx.payload, token: ctx.settings.token };
    });

    // Use a valid hook name for emit — register on deploy:before instead
    bus.off("my-plugin-hook" as any, "my-plugin");
    bus.on("deploy:before", "my-plugin", async (ctx) => {
      return { ...ctx.payload, token: ctx.settings.token };
    });

    const result = await bus.emit("deploy:before", {} as Record<string, unknown>, mockSession);
    expect((result as any).token).toBe("abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/hook-bus.test.ts`
Expected: FAIL — `Cannot find module "../hook-bus.js"`

- [ ] **Step 3: Implement HookBus**

Create `core/hook-bus.ts`:

```typescript
import type { HookName, HookHandler, SessionInfo } from "./types/plugin.js";

interface HandlerEntry {
  pluginName: string;
  handler: HookHandler;
}

export class HookBus {
  private handlers = new Map<string, HandlerEntry[]>();
  private pluginConfigs = new Map<string, Record<string, unknown>>();

  on(hook: HookName, pluginName: string, handler: HookHandler): void {
    const list = this.handlers.get(hook) ?? [];
    list.push({ pluginName, handler });
    this.handlers.set(hook, list);
  }

  off(hook: HookName, pluginName: string): void {
    const list = this.handlers.get(hook);
    if (!list) return;
    this.handlers.set(
      hook,
      list.filter((e) => e.pluginName !== pluginName),
    );
  }

  setPluginConfig(pluginName: string, config: Record<string, unknown>): void {
    this.pluginConfigs.set(pluginName, config);
  }

  async emit<T>(hook: HookName, payload: T, session: SessionInfo): Promise<T> {
    let result = payload;
    for (const { pluginName, handler } of this.handlers.get(hook) ?? []) {
      try {
        const settings = this.pluginConfigs.get(pluginName) ?? {};
        const returned = await handler({
          payload: result,
          plugin: { name: pluginName },
          session,
          settings,
        });
        if (returned !== undefined) result = returned as T;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[plugin:${pluginName}] hook ${hook} failed: ${msg}`);
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test core/__tests__/hook-bus.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/hook-bus.ts core/__tests__/hook-bus.test.ts
git commit -m "feat(plugin): implement HookBus with waterfall execution and soft error"
```

---

## Task 3: SettingsManager

**Files:**
- Create: `core/settings-manager.ts`
- Test: `core/__tests__/settings-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/__tests__/settings-manager.test.ts`:

```typescript
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
    expect(existsSync(join(TEST_DIR, "vercel.json.bak"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "vercel.json"))).toBe(false);
  });

  test("migrateIfNeeded migrates cloudflare-pages.json", () => {
    writeFileSync(
      join(TEST_DIR, "cloudflare-pages.json"),
      JSON.stringify({ token: "cftoken", accountId: "acc1" }),
    );
    manager.migrateIfNeeded();

    expect(manager.getPluginConfig("cf-pages-deploy")).toEqual({ token: "cftoken", accountId: "acc1" });
    expect(manager.isEnabled("cf-pages-deploy")).toBe(true);
    expect(existsSync(join(TEST_DIR, "cloudflare-pages.json.bak"))).toBe(true);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/settings-manager.test.ts`
Expected: FAIL — `Cannot find module "../settings-manager.js"`

- [ ] **Step 3: Implement SettingsManager**

Create `core/settings-manager.ts`:

```typescript
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginSettings, PluginSettingsEntry } from "./types/plugin.js";

export class SettingsManager {
  private settingsPath: string;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.settingsPath = join(baseDir, "settings.json");
  }

  getAll(): PluginSettings {
    try {
      const raw = readFileSync(this.settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { plugins: parsed.plugins ?? {} };
    } catch {
      return { plugins: {} };
    }
  }

  private save(settings: PluginSettings): void {
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  getPluginConfig(name: string): Record<string, unknown> {
    return this.getAll().plugins[name]?.config ?? {};
  }

  isEnabled(name: string): boolean {
    return this.getAll().plugins[name]?.enabled ?? false;
  }

  setEnabled(name: string, enabled: boolean): void {
    const settings = this.getAll();
    if (!settings.plugins[name]) {
      settings.plugins[name] = { enabled, config: {} };
    } else {
      settings.plugins[name].enabled = enabled;
    }
    this.save(settings);
  }

  updateConfig(name: string, config: Record<string, unknown>): void {
    const settings = this.getAll();
    if (!settings.plugins[name]) {
      settings.plugins[name] = { enabled: false, config: {} };
    }
    settings.plugins[name].config = { ...settings.plugins[name].config, ...config };
    this.save(settings);
  }

  migrateIfNeeded(): void {
    this.migrateLegacyFile("vercel.json", "vercel-deploy");
    this.migrateLegacyFile("cloudflare-pages.json", "cf-pages-deploy");
  }

  private migrateLegacyFile(filename: string, pluginName: string): void {
    const legacyPath = join(this.baseDir, filename);
    if (!existsSync(legacyPath)) return;

    // Don't overwrite existing plugin config
    const existing = this.getAll();
    if (existing.plugins[pluginName]?.config && Object.keys(existing.plugins[pluginName].config).length > 0) {
      // Still rename the legacy file to avoid future migration attempts
      renameSync(legacyPath, legacyPath + ".bak");
      return;
    }

    try {
      const raw = readFileSync(legacyPath, "utf-8");
      const config = JSON.parse(raw);
      this.updateConfig(pluginName, config);
      this.setEnabled(pluginName, true);
      renameSync(legacyPath, legacyPath + ".bak");
    } catch {
      // Legacy file is corrupt — skip migration
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test core/__tests__/settings-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/settings-manager.ts core/__tests__/settings-manager.test.ts
git commit -m "feat(plugin): implement SettingsManager with legacy config migration"
```

---

## Task 4: PluginRegistry

**Files:**
- Create: `core/plugin-registry.ts`
- Test: `core/__tests__/plugin-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/__tests__/plugin-registry.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/__tests__/plugin-registry.test.ts`
Expected: FAIL — `Cannot find module "../plugin-registry.js"`

- [ ] **Step 3: Implement PluginRegistry**

Create `core/plugin-registry.ts`:

```typescript
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type {
  PluginManifest,
  LoadedPlugin,
  HookName,
  HookHandler,
  SessionInfo,
  PluginRouteContext,
} from "./types/plugin.js";
import type { HookBus } from "./hook-bus.js";
import type { SettingsManager } from "./settings-manager.js";

interface PluginRegistryOptions {
  builtinDir: string;
  externalDir: string;
  settingsManager: SettingsManager;
  hookBus: HookBus;
}

interface DiscoveredManifest extends PluginManifest {
  /** Absolute path to the plugin directory */
  _basePath: string;
}

export class PluginRegistry {
  private options: PluginRegistryOptions;
  private loaded = new Map<string, LoadedPlugin>();

  constructor(options: PluginRegistryOptions) {
    this.options = options;
  }

  // ── Phase 1: Discover ─────────────────────────────────────────────────

  async discover(): Promise<DiscoveredManifest[]> {
    const manifests: DiscoveredManifest[] = [];

    for (const dir of [this.options.builtinDir, this.options.externalDir]) {
      if (!existsSync(dir)) continue;

      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pluginDir = join(dir, entry.name);
        try {
          const manifest = await this.loadManifest(pluginDir);
          if (manifest) {
            manifests.push({
              ...manifest,
              _basePath: pluginDir,
              builtin: dir === this.options.builtinDir ? true : manifest.builtin,
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[plugin-registry] failed to read ${pluginDir}: ${msg}`);
        }
      }
    }

    return manifests;
  }

  private async loadManifest(pluginDir: string): Promise<PluginManifest | null> {
    const manifestPath = join(pluginDir, "manifest.ts");
    if (!existsSync(manifestPath)) return null;

    const mod = await import(manifestPath);
    return mod.default ?? mod;
  }

  // ── Phase 2: Filter ───────────────────────────────────────────────────

  filterEnabled(manifests: PluginManifest[]): PluginManifest[] {
    return manifests.filter((m) => {
      // Builtin plugins are enabled by default unless explicitly disabled
      if (m.builtin) {
        const entry = this.options.settingsManager.getAll().plugins[m.name];
        return entry === undefined || entry.enabled !== false;
      }
      return this.options.settingsManager.isEnabled(m.name);
    });
  }

  // ── Phase 3: Resolve ──────────────────────────────────────────────────

  resolveForSession(manifests: PluginManifest[], mode: string): PluginManifest[] {
    return manifests.filter((m) => {
      if (m.scope === "global") return true;
      if (m.scope === "mode") {
        if (!m.compatibleModes || m.compatibleModes.length === 0) return true;
        return m.compatibleModes.includes(mode);
      }
      return false;
    });
  }

  // ── Phase 4: Load ─────────────────────────────────────────────────────

  async loadPlugin(manifest: DiscoveredManifest): Promise<LoadedPlugin | null> {
    const basePath = manifest._basePath;
    try {
      const hooks: Partial<Record<HookName, HookHandler>> = {};
      if (manifest.hooks) {
        for (const [hookName, relPath] of Object.entries(manifest.hooks)) {
          if (!relPath) continue;
          try {
            const mod = await import(join(basePath, relPath));
            hooks[hookName as HookName] = mod.default ?? mod;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[plugin:${manifest.name}] failed to load hook ${hookName}: ${msg}`);
          }
        }
      }

      let routes: LoadedPlugin["routes"] = null;
      if (manifest.routes) {
        try {
          const mod = await import(join(basePath, manifest.routes));
          routes = mod.default ?? mod;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[plugin:${manifest.name}] failed to load routes: ${msg}`);
        }
      }

      const plugin: LoadedPlugin = { manifest, basePath, hooks, routes };
      this.loaded.set(manifest.name, plugin);
      return plugin;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[plugin:${manifest.name}] load failed, skipping: ${msg}`);
      return null;
    }
  }

  // ── Phase 5: Activate ─────────────────────────────────────────────────

  async activateAll(manifests: DiscoveredManifest[], session: SessionInfo): Promise<void> {
    for (const manifest of manifests) {
      const plugin = await this.loadPlugin(manifest);
      if (!plugin) continue;

      // Register hooks on the bus
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          this.options.hookBus.on(hookName as HookName, manifest.name, handler);
        }
      }

      // Set plugin config on the bus
      const config = this.options.settingsManager.getPluginConfig(manifest.name);
      this.options.hookBus.setPluginConfig(manifest.name, config);
    }
  }

  // ── Phase 6: Mount routes ─────────────────────────────────────────────

  mountRoutes(app: Hono, routeCtxFactory: (pluginName: string) => PluginRouteContext): void {
    for (const [name, plugin] of this.loaded) {
      if (!plugin.routes) continue;
      const prefix = plugin.manifest.routePrefix ?? `/api/plugins/${name}`;
      try {
        const subApp = plugin.routes(routeCtxFactory(name));
        app.route(prefix, subApp as Hono);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[plugin:${name}] failed to mount routes at ${prefix}: ${msg}`);
      }
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getLoaded(): Map<string, LoadedPlugin> {
    return this.loaded;
  }

  getLoadedList(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test core/__tests__/plugin-registry.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/plugin-registry.ts core/__tests__/plugin-registry.test.ts
git commit -m "feat(plugin): implement PluginRegistry with discover, filter, resolve, load"
```

---

## Task 5: Vercel Builtin Plugin

**Files:**
- Create: `plugins/vercel/manifest.ts`
- Create: `plugins/vercel/routes.ts`
- Create: `plugins/vercel/hooks.ts`

This task moves the existing Vercel deploy logic (`server/vercel.ts`) into a plugin package. The actual deployment functions (`deployToVercel`, `checkVercelCli`, etc.) stay in `server/vercel.ts` for now — the plugin routes just re-export and wrap them. Full decoupling happens in a future cleanup pass.

- [ ] **Step 1: Create the plugin manifest**

Create `plugins/vercel/manifest.ts`:

```typescript
import type { PluginManifest } from "../../core/types/plugin.js";

const manifest: PluginManifest = {
  name: "vercel-deploy",
  version: "1.0.0",
  displayName: "Vercel",
  description: "Deploy to Vercel (CLI or API token)",
  builtin: true,
  scope: "global",
  compatibleModes: ["slide", "webcraft", "remotion", "doc", "gridboard"],

  hooks: {
    "deploy:providers": "./hooks.ts",
  },

  routes: "./routes.ts",

  settings: {
    token: { type: "password", label: "API Token", description: "Vercel API token (optional if CLI is logged in)" },
    teamId: { type: "string", label: "Team ID", description: "Vercel team/org ID" },
  },
};

export default manifest;
```

- [ ] **Step 2: Create the routes (wrapping existing functions)**

Create `plugins/vercel/routes.ts`:

```typescript
import { Hono } from "hono";
import type { PluginRouteContext } from "../../core/types/plugin.js";
import {
  getVercelStatus,
  getVercelTeams,
  deployToVercel,
} from "../../server/vercel.js";

export default function (ctx: PluginRouteContext) {
  const app = new Hono();

  app.get("/status", async (c) => {
    const status = await getVercelStatus();
    return c.json(status);
  });

  app.get("/teams", async (c) => {
    const teams = await getVercelTeams();
    return c.json({ teams });
  });

  app.get("/binding", (c) => {
    const key = c.req.query("contentSet") || "_default";
    const binding = ctx.getDeployBinding();
    return c.json(binding.vercel?.[key] ?? null);
  });

  app.post("/deploy", async (c) => {
    try {
      const body = await c.req.json<{
        files: Array<{ path: string; content: string }>;
        projectName?: string;
        projectId?: string;
        orgId?: string | null;
        teamId?: string | null;
        framework?: string | null;
        contentSet?: string;
      }>();
      const result = await deployToVercel(body);

      // Save binding
      const key = body.contentSet || "_default";
      const binding = ctx.getDeployBinding();
      if (!binding.vercel) binding.vercel = {};
      binding.vercel[key] = {
        projectId: (result as any).projectId,
        projectName: body.projectName ?? "pneuma-deploy",
        orgId: (result as any).orgId || body.orgId || null,
        teamId: body.teamId ?? null,
        url: (result as any).url,
        lastDeployedAt: new Date().toISOString(),
      };
      ctx.saveDeployBinding(binding);

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.delete("/binding", (c) => {
    const key = c.req.query("contentSet") || "_default";
    const binding = ctx.getDeployBinding();
    if (binding.vercel) delete binding.vercel[key];
    ctx.saveDeployBinding(binding);
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 3: Create the deploy:providers hook**

Create `plugins/vercel/hooks.ts`:

```typescript
import type { HookContext } from "../../core/types/plugin.js";

interface DeployProvider {
  id: string;
  name: string;
  description: string;
  routePrefix: string;
}

interface DeployProvidersPayload {
  providers: DeployProvider[];
}

export default function (ctx: HookContext<DeployProvidersPayload>) {
  return {
    ...ctx.payload,
    providers: [
      ...ctx.payload.providers,
      {
        id: "vercel",
        name: "Vercel",
        description: "Deploy to Vercel",
        routePrefix: "/api/plugins/vercel-deploy",
      },
    ],
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/vercel/manifest.ts plugins/vercel/routes.ts plugins/vercel/hooks.ts
git commit -m "feat(plugin): add Vercel as builtin plugin"
```

---

## Task 6: CF Pages Builtin Plugin

**Files:**
- Create: `plugins/cf-pages/manifest.ts`
- Create: `plugins/cf-pages/routes.ts`
- Create: `plugins/cf-pages/hooks.ts`

- [ ] **Step 1: Create the plugin manifest**

Create `plugins/cf-pages/manifest.ts`:

```typescript
import type { PluginManifest } from "../../core/types/plugin.js";

const manifest: PluginManifest = {
  name: "cf-pages-deploy",
  version: "1.0.0",
  displayName: "Cloudflare Pages",
  description: "Deploy to Cloudflare Pages (Wrangler CLI or API token)",
  builtin: true,
  scope: "global",
  compatibleModes: ["slide", "webcraft", "remotion", "doc", "gridboard"],

  hooks: {
    "deploy:providers": "./hooks.ts",
  },

  routes: "./routes.ts",

  settings: {
    token: { type: "password", label: "API Token", description: "Cloudflare API token (optional if Wrangler is logged in)" },
    accountId: { type: "string", label: "Account ID", description: "Cloudflare account ID" },
  },
};

export default manifest;
```

- [ ] **Step 2: Create the routes (wrapping existing functions)**

Create `plugins/cf-pages/routes.ts`:

```typescript
import { Hono } from "hono";
import type { PluginRouteContext } from "../../core/types/plugin.js";
import {
  getCfPagesStatus,
  deployCfPages,
} from "../../server/cloudflare-pages.js";

export default function (ctx: PluginRouteContext) {
  const app = new Hono();

  app.get("/status", async (c) => {
    const status = await getCfPagesStatus();
    return c.json(status);
  });

  app.get("/binding", (c) => {
    const key = c.req.query("contentSet") || "_default";
    const binding = ctx.getDeployBinding();
    return c.json(binding.cfPages?.[key] ?? null);
  });

  app.post("/deploy", async (c) => {
    try {
      const body = await c.req.json<{
        files: Array<{ path: string; content: string }>;
        projectName?: string;
        contentSet?: string;
      }>();
      const result = await deployCfPages(body);

      const key = body.contentSet || "_default";
      const binding = ctx.getDeployBinding();
      if (!binding.cfPages) binding.cfPages = {};
      binding.cfPages[key] = {
        projectName: (result as any).projectName,
        productionUrl: (result as any).productionUrl,
        dashboardUrl: (result as any).dashboardUrl,
        lastDeployedAt: new Date().toISOString(),
      };
      ctx.saveDeployBinding(binding);

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
```

- [ ] **Step 3: Create the deploy:providers hook**

Create `plugins/cf-pages/hooks.ts`:

```typescript
import type { HookContext } from "../../core/types/plugin.js";

interface DeployProvider {
  id: string;
  name: string;
  description: string;
  routePrefix: string;
}

interface DeployProvidersPayload {
  providers: DeployProvider[];
}

export default function (ctx: HookContext<DeployProvidersPayload>) {
  return {
    ...ctx.payload,
    providers: [
      ...ctx.payload.providers,
      {
        id: "cf-pages",
        name: "Cloudflare Pages",
        description: "Deploy to Cloudflare Pages",
        routePrefix: "/api/plugins/cf-pages-deploy",
      },
    ],
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/cf-pages/manifest.ts plugins/cf-pages/routes.ts plugins/cf-pages/hooks.ts
git commit -m "feat(plugin): add Cloudflare Pages as builtin plugin"
```

---

## Task 7: Integrate Plugin Registry into Server

**Files:**
- Modify: `server/index.ts`

This task wires the PluginRegistry into the server startup, mounts plugin routes, and replaces the hardcoded Vercel/CF route blocks with plugin-provided routes.

- [ ] **Step 1: Add plugin imports to server/index.ts**

At the top of `server/index.ts`, add these imports (near the existing vercel/cf imports):

```typescript
import { PluginRegistry } from "../core/plugin-registry.js";
import { SettingsManager } from "../core/settings-manager.js";
import { HookBus } from "../core/hook-bus.js";
import { join } from "node:path";
import { homedir } from "node:os";
```

- [ ] **Step 2: Initialize plugin system in the server setup**

In the server setup section (before route registration, around where `workspace` is defined), add plugin initialization:

```typescript
// ── Plugin System ─────────────────────────────────────────────────────────
const pneumaHome = join(homedir(), ".pneuma");
const settingsManager = new SettingsManager(pneumaHome);
settingsManager.migrateIfNeeded();
const hookBus = new HookBus();

const pluginRegistry = new PluginRegistry({
  builtinDir: join(import.meta.dir, "..", "plugins"),
  externalDir: join(pneumaHome, "plugins"),
  settingsManager,
  hookBus,
});
```

- [ ] **Step 3: Add plugin discovery and activation after session setup**

After the session/mode is resolved and before route registration:

```typescript
// Discover and activate plugins for this session
const discoveredPlugins = await pluginRegistry.discover();
const enabledPlugins = pluginRegistry.filterEnabled(discoveredPlugins);
const activePlugins = pluginRegistry.resolveForSession(enabledPlugins, options.mode ?? "");

const sessionInfo = {
  sessionId: options.sessionId ?? "",
  mode: options.mode ?? "",
  workspace,
  backendType: options.backendType ?? "claude-code",
};

await pluginRegistry.activateAll(activePlugins as any, sessionInfo);

// Mount plugin routes
pluginRegistry.mountRoutes(app, (pluginName) => ({
  workspace,
  session: sessionInfo,
  settings: settingsManager.getPluginConfig(pluginName),
  getDeployBinding: () => getDeployBinding(workspace),
  saveDeployBinding: (b) => saveDeployBinding(workspace, b),
}));
```

- [ ] **Step 4: Remove hardcoded Vercel/CF route blocks**

Remove the following blocks from `server/index.ts` (lines 1169-1263 in the normal mode section):
- `// --- Vercel Deploy ---` block (lines 1169-1225)
- `// --- Cloudflare Pages Deploy ---` block (lines 1227-1263)

These are now served by the plugin routes at `/api/plugins/vercel-deploy/*` and `/api/plugins/cf-pages-deploy/*`.

- [ ] **Step 5: Add a plugin list API endpoint**

Add a new route for the frontend to discover active plugins:

```typescript
app.get("/api/plugins", (c) => {
  const plugins = pluginRegistry.getLoadedList().map((p) => ({
    name: p.manifest.name,
    displayName: p.manifest.displayName,
    description: p.manifest.description,
    version: p.manifest.version,
    builtin: p.manifest.builtin ?? false,
    scope: p.manifest.scope,
    hasRoutes: !!p.routes,
    hooks: Object.keys(p.hooks),
    slots: p.manifest.slots ? Object.keys(p.manifest.slots) : [],
    settings: p.manifest.settings ? Object.keys(p.manifest.settings) : [],
  }));
  return c.json({ plugins });
});
```

- [ ] **Step 6: Add hookBus emit to the deploy flow (if central deploy endpoint exists)**

Add a `/api/deploy` orchestrator route that runs hooks:

```typescript
app.post("/api/deploy", async (c) => {
  try {
    const body = await c.req.json<{
      provider: string;
      files: Array<{ path: string; content: string }>;
      projectName?: string;
      formValues?: Record<string, Record<string, unknown>>;
      contentSet?: string;
      [key: string]: unknown;
    }>();

    // Run deploy:before hooks (waterfall)
    const enrichedPayload = await hookBus.emit("deploy:before", body, sessionInfo);

    // Forward to provider's deploy endpoint
    const plugin = pluginRegistry.getLoaded().get(body.provider);
    if (!plugin) {
      return c.json({ error: `Unknown deploy provider: ${body.provider}` }, 400);
    }

    const prefix = plugin.manifest.routePrefix ?? `/api/plugins/${body.provider}`;
    // Internal fetch to the plugin's deploy route
    const deployUrl = new URL(`${prefix}/deploy`, c.req.url);
    const deployResp = await app.fetch(
      new Request(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enrichedPayload),
      }),
    );
    const result = await deployResp.json();

    // Run deploy:after hooks
    await hookBus.emit("deploy:after", { result, provider: body.provider }, sessionInfo);

    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
```

- [ ] **Step 7: Update launcher mode Vercel/CF routes similarly**

In the launcher mode section (lines 679-735), replace the hardcoded Vercel/CF config routes with plugin settings routes:

```typescript
// Plugin settings routes (replaces /api/vercel/config, /api/cf-pages/config)
app.get("/api/plugin-settings/:name", (c) => {
  const name = c.req.param("name");
  return c.json({
    enabled: settingsManager.isEnabled(name),
    config: settingsManager.getPluginConfig(name),
  });
});

app.post("/api/plugin-settings/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ enabled?: boolean; config?: Record<string, unknown> }>();
  if (body.enabled !== undefined) settingsManager.setEnabled(name, body.enabled);
  if (body.config) settingsManager.updateConfig(name, body.config);
  return c.json({ ok: true });
});
```

- [ ] **Step 8: Verify the server still builds**

Run: `bun run build`
Expected: Build succeeds without errors

- [ ] **Step 9: Commit**

```bash
git add server/index.ts
git commit -m "feat(plugin): integrate PluginRegistry into server, replace hardcoded deploy routes"
```

---

## Task 8: Frontend Plugin Slice

**Files:**
- Create: `src/store/plugin-slice.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: Create the plugin slice**

Create `src/store/plugin-slice.ts`:

```typescript
import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

export interface PluginInfo {
  name: string;
  displayName: string;
  description: string;
  version: string;
  builtin: boolean;
  scope: string;
  hasRoutes: boolean;
  hooks: string[];
  slots: string[];
  settings: string[];
}

export interface PluginSlice {
  activePlugins: PluginInfo[];
  setActivePlugins: (plugins: PluginInfo[]) => void;
}

export const createPluginSlice: StateCreator<AppState, [], [], PluginSlice> = (set) => ({
  activePlugins: [],
  setActivePlugins: (activePlugins) => set({ activePlugins }),
});
```

- [ ] **Step 2: Add PluginSlice to AppState**

In `src/store/types.ts`, add:

After line 47 (`export type { ReplaySlice } from "./replay-slice.js";`):
```typescript
export type { PluginSlice } from "./plugin-slice.js";
```

After line 56 (`import type { ReplaySlice } from "./replay-slice.js";`):
```typescript
import type { PluginSlice } from "./plugin-slice.js";
```

Update line 58:
```typescript
export type AppState = UiSlice & SessionSlice & AgentDataSlice & ChatSlice & ModeSlice & ViewerSlice & WorkspaceSlice & ReplaySlice & PluginSlice;
```

- [ ] **Step 3: Add createPluginSlice to store composition**

In `src/store/index.ts`, add import after line 11:
```typescript
import { createPluginSlice } from "./plugin-slice.js";
```

Add to the store creator (line 22, after `...createReplaySlice(...a),`):
```typescript
  ...createPluginSlice(...a),
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/store/plugin-slice.ts src/store/types.ts src/store/index.ts
git commit -m "feat(plugin): add Zustand plugin slice to frontend store"
```

---

## Task 9: Update deploy-ui.ts for Plugin Providers

**Files:**
- Modify: `server/routes/deploy-ui.ts`

The deploy UI currently hardcodes Vercel and CF Pages as deploy targets. Update the JavaScript helpers to dynamically fetch providers from `/api/plugins` and use plugin route prefixes.

- [ ] **Step 1: Read the current deploy-ui.ts JavaScript section**

Read `server/routes/deploy-ui.ts` fully to understand the `getDeployJS()` function and how providers are referenced in the frontend code.

- [ ] **Step 2: Update getDeployJS to fetch providers dynamically**

In the `getDeployJS()` function, replace hardcoded provider references. The key change is that instead of checking `/api/vercel/status` and `/api/cf-pages/status` separately, the UI should:

1. Fetch `/api/plugins` to get active deploy plugins
2. For each plugin with `deploy:provider` in its slots, fetch `{routePrefix}/status`
3. Render provider tabs dynamically

This is a larger UI change. The minimal approach for this task: update the API URLs from `/api/vercel/*` to `/api/plugins/vercel-deploy/*` and `/api/cf-pages/*` to `/api/plugins/cf-pages-deploy/*`. This keeps the existing UI working with the new plugin routes.

In `deploy-ui.ts`, find all occurrences of:
- `/api/vercel/` → replace with `/api/plugins/vercel-deploy/`
- `/api/cf-pages/` → replace with `/api/plugins/cf-pages-deploy/`

- [ ] **Step 3: Verify deploy UI still works**

Run dev server: `bun run dev slide`
Navigate to export page and verify deploy dropdown still appears with Vercel/CF options.

- [ ] **Step 4: Commit**

```bash
git add server/routes/deploy-ui.ts
git commit -m "feat(plugin): update deploy UI to use plugin route prefixes"
```

---

## Task 10: Plugin Settings in Launcher

**Files:**
- Modify: `src/components/Launcher.tsx`

Add a "Plugins" section to the Launcher that shows discovered plugins with enable/disable toggles and settings forms.

- [ ] **Step 1: Read Launcher.tsx to understand the tab/section structure**

Read the Launcher component to identify where to add the plugins section. Look for how "Built-in Modes", "Local Modes", etc. are rendered.

- [ ] **Step 2: Add Plugins section to Launcher**

After the existing sections (Built-in Modes, Local Modes, Published Modes), add a "Plugins" section that:

1. Fetches `/api/plugins` on mount to get plugin list
2. Fetches `/api/plugin-settings/{name}` for each plugin's current config
3. Renders each plugin as a card with:
   - Name, description, version, "(Built-in)" badge
   - Enable/disable toggle
   - Expandable settings form (auto-rendered from plugin's settings schema)
   - Save button for settings

The settings form should use the same input patterns already in the Launcher (look at how Backend Picker or API key inputs are styled).

- [ ] **Step 3: Test the plugins section**

Run: `bun run dev` (launcher mode)
Verify: Plugins section shows Vercel and CF Pages as built-in, toggles work, settings save.

- [ ] **Step 4: Commit**

```bash
git add src/components/Launcher.tsx
git commit -m "feat(plugin): add Plugins settings section to Launcher"
```

---

## Task 11: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass, including new plugin tests

- [ ] **Step 2: Run dev server and verify end-to-end**

Run: `bun run dev slide --workspace /tmp/test-plugin`
Verify:
- Server starts without errors
- Plugin system logs show discovery of vercel-deploy and cf-pages-deploy
- Deploy UI works through plugin routes
- No regressions in existing functionality

- [ ] **Step 3: Commit any fixes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix(plugin): address test and integration issues"
```

---

## Summary

| Task | Description | Key Output |
|------|-------------|------------|
| 1 | Plugin type definitions | `core/types/plugin.ts` |
| 2 | HookBus | `core/hook-bus.ts` — waterfall events with soft error |
| 3 | SettingsManager | `core/settings-manager.ts` — config persistence + migration |
| 4 | PluginRegistry | `core/plugin-registry.ts` — discover/filter/resolve/load/activate |
| 5 | Vercel plugin | `plugins/vercel/` — manifest + routes + hooks |
| 6 | CF Pages plugin | `plugins/cf-pages/` — manifest + routes + hooks |
| 7 | Server integration | Wire registry into `server/index.ts`, replace hardcoded routes |
| 8 | Frontend plugin slice | `src/store/plugin-slice.ts` + store composition |
| 9 | Deploy UI update | Update API URLs to plugin route prefixes |
| 10 | Launcher plugins UI | Plugin management in Launcher settings |
| 11 | Verification | Full test suite + manual E2E check |
