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

  slots: {
    "deploy:provider": "./ui/StatusBadge.tsx",
  },

  routes: "./routes.ts",

  settings: {
    token: { type: "password", label: "API Token", description: "Cloudflare API token (optional if Wrangler is logged in)" },
    accountId: { type: "string", label: "Account ID", description: "Cloudflare account ID" },
  },
};

export default manifest;
