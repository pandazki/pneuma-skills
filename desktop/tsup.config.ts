import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "main/index": "src/main/index.ts",
    "preload/index": "src/preload/index.ts",
  },
  outDir: "dist-electron",
  format: "cjs",
  target: "node22",
  platform: "node",
  external: ["electron", "electron-updater"],
  define: {
    "process.env.PNEUMA_DESKTOP_PREVIEW": JSON.stringify(process.env.PNEUMA_DESKTOP_PREVIEW === "1" ? "1" : "0"),
  },
  splitting: false,
  sourcemap: true,
  clean: true,
});
