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
