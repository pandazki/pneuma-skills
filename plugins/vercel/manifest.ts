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

  slots: {
    "deploy:provider": "./ui/StatusBadge.tsx",
    "deploy:pre-publish": {
      type: "form",
      fields: [
        { name: "alias", label: "Production Alias", type: "text", placeholder: "e.g. my-app.vercel.app", description: "Custom domain alias for this deployment" },
      ],
    },
  },

  routes: "./routes.ts",

  settings: {
    token: { type: "password", label: "API Token", description: "Vercel API token (optional if CLI is logged in)" },
    teamId: { type: "string", label: "Team ID", description: "Vercel team/org ID" },
  },
};

export default manifest;
