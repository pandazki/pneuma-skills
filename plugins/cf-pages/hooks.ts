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
