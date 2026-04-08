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
