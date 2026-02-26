import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:3210",
      "/content": "http://localhost:3210",
    },
  },
});
