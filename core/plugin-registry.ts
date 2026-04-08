import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type {
  PluginManifest,
  LoadedPlugin,
  HookName,
  HookHandler,
  SlotName,
  SlotDeclaration,
  SessionInfo,
  PluginRouteContext,
} from "./types/plugin.js";
import type { HookBus } from "./hook-bus.js";
import type { SettingsManager } from "./settings-manager.js";

export interface PluginRegistryOptions {
  builtinDir: string;
  externalDir: string;
  settingsManager: SettingsManager;
  hookBus: HookBus;
}

export interface DiscoveredManifest extends PluginManifest {
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
      // Builtin plugins: check defaultEnabled (true unless explicitly set false)
      if (m.builtin) {
        const entry = this.options.settingsManager.getAll().plugins[m.name];
        if (entry !== undefined) return entry.enabled !== false;
        // No user setting — use manifest default
        return m.defaultEnabled !== false;
      }
      return this.options.settingsManager.isEnabled(m.name);
    });
  }

  // ── Phase 3: Resolve ──────────────────────────────────────────────────

  resolveForSession(manifests: PluginManifest[], mode: string): PluginManifest[] {
    return manifests.filter((m) => {
      // Check compatibleModes for ALL scopes when specified
      if (m.compatibleModes && m.compatibleModes.length > 0) {
        if (!m.compatibleModes.includes(mode)) return false;
      }
      if (m.scope === "global") return true;
      if (m.scope === "mode") return true; // already filtered by compatibleModes above
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

      const slots = manifest.slots ?? {};
      const plugin: LoadedPlugin = { manifest, basePath, hooks, slots, routes };
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

  /** Get all slot declarations for a given slot name across all loaded plugins */
  getSlotEntries(slotName: SlotName): Array<{ pluginName: string; declaration: SlotDeclaration }> {
    const entries: Array<{ pluginName: string; declaration: SlotDeclaration }> = [];
    for (const [name, plugin] of this.loaded) {
      const decl = plugin.slots[slotName];
      if (decl) {
        entries.push({ pluginName: name, declaration: decl });
      }
    }
    return entries;
  }
}
