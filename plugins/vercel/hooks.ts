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
