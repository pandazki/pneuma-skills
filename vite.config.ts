import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// External mode path — passed from bin/pneuma.ts via env var
const externalModePath = process.env.PNEUMA_EXTERNAL_MODE_PATH;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Ensure external modes use the project's React (prevent duplicate instances)
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 17996,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:17007",
      "/content": "http://localhost:17007",
    },
    fs: {
      // Allow serving files from external mode directories (for /@fs/ imports)
      allow: [
        ".",
        ...(externalModePath ? [externalModePath] : []),
      ],
    },
  },
});
