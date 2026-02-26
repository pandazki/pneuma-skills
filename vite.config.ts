import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 17996,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:17007",
      "/content": "http://localhost:17007",
    },
  },
});
