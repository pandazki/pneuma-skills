import { Hono } from "hono";
import type { PluginRouteContext } from "../../core/types/plugin.js";
import { ObsidianMemorySource } from "./obsidian-api.js";

export default function (ctx: PluginRouteContext) {
  const app = new Hono();

  function getSource(): ObsidianMemorySource | null {
    const { apiUrl, apiKey } = ctx.settings as Record<string, string>;
    if (!apiKey) return null;
    return new ObsidianMemorySource({
      apiUrl: apiUrl || "https://localhost:27124",
      apiKey,
    });
  }

  app.get("/status", async (c) => {
    const source = getSource();
    if (!source) return c.json({ available: false, reason: "not configured" });
    const available = await source.available();
    return c.json({ available });
  });

  app.post("/search", async (c) => {
    const source = getSource();
    if (!source) return c.json({ results: [] });
    const { query, limit } = await c.req.json<{ query: string; limit?: number }>();
    const results = await source.search(query, { limit });
    return c.json({ results });
  });

  app.get("/read/*", async (c) => {
    const source = getSource();
    if (!source) return c.json({ entry: null });
    const path = c.req.path.replace(/^\/read\//, "");
    const entry = await source.read(decodeURIComponent(path));
    return c.json({ entry });
  });

  app.post("/write", async (c) => {
    const source = getSource();
    if (!source) return c.json({ error: "not configured" }, 400);
    const { path, content, tags } = await c.req.json<{ path: string; content: string; tags?: string[] }>();
    try {
      await source.write(path, content, { tags });
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
