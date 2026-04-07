import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginSettings } from "./types/plugin.js";

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
      return;
    }

    try {
      const raw = readFileSync(legacyPath, "utf-8");
      let config = JSON.parse(raw);

      // Remap legacy field names to plugin settings convention
      if (pluginName === "cf-pages-deploy" && config.apiToken && !config.token) {
        config.token = config.apiToken;
        delete config.apiToken;
      }

      this.updateConfig(pluginName, config);
      this.setEnabled(pluginName, true);
    } catch {
      // Legacy file is corrupt — skip migration
    }
  }
}
