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
