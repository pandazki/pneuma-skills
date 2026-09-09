#!/usr/bin/env bun
/** Serve the showcase compositions locally; capture each view at 1376 × 768. */
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artwork = resolve(process.argv[2] ?? ".tmp-sprite-showcase");
const fonts = resolve(here, "../../../public/fonts");
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.SHOWCASE_PORT ?? 18143),
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(Bun.file(join(here, "layout.html")));
    const root = path.startsWith("/art/") ? artwork : path.startsWith("/fonts/") ? fonts : null;
    if (!root) return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(path.replace(/^\/(?:art|fonts)\//, ""));
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) return new Response("Not found", { status: 404 });
    const data = Bun.file(file);
    return await data.exists() ? new Response(data) : new Response("Not found", { status: 404 });
  },
});
console.log(`Showcase: ${server.url}?view=hero`);
console.log("Views: hero, character-locked, slice-align, video-preview");
