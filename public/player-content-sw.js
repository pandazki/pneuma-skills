// public/player-content-sw.js
//
// Content service worker for the hosted player. Iframe-based viewers (webcraft,
// slide, kami, …) and image-backed viewers (illustrate, doc) fetch their assets
// over HTTP at `/content/<content-set>/<rel>` — paths that, in the live app, the
// Bun server serves from the workspace. There is no Bun server in the hosted
// player, so this worker intercepts those requests and resolves them against the
// active checkpoint's blob manifest, streaming bytes from the play package on R2.
//
// The page pushes the active checkpoint via postMessage (see content-sw-client.ts):
//   { type: "pneuma-player-checkout", baseUrl, files: { "<workspace path>": "<blobSha>" } }

/** @type {{ baseUrl: string, files: Record<string,string> } | null} */
let active = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "pneuma-player-checkout") {
    active = { baseUrl: data.baseUrl.replace(/\/$/, ""), files: data.files || {} };
  }
});

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  pdf: "application/pdf", wasm: "application/wasm",
};

function contentTypeFor(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/** Resolve a `/content/...` (or `/api/file?path=...`) request to a workspace path
 *  key present in the active manifest. Tries the path as-is and without a leading
 *  content-set segment so both `<base href>`-relative and bare paths resolve. */
function resolveKey(rel) {
  if (!active) return null;
  if (active.files[rel]) return rel;
  // Some viewers reference assets relative to a content-set root that may or may
  // not be encoded in the request; try progressively stripping leading segments.
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join("/");
    if (active.files[candidate]) return candidate;
  }
  return null;
}

async function serveContent(request, rel) {
  const key = resolveKey(rel);
  if (!key) return new Response("Not found in play package", { status: 404 });

  const blobUrl = `${active.baseUrl}/blobs/${active.files[key]}`;
  const upstream = await fetch(blobUrl, { cache: "force-cache" });
  if (!upstream.ok) return new Response("Blob fetch failed", { status: 502 });

  const buf = await upstream.arrayBuffer();
  const type = contentTypeFor(key);
  const baseHeaders = {
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  // Minimal Range support (media scrubbing).
  const range = request.headers.get("Range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const total = buf.byteLength;
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      const slice = buf.slice(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(slice.byteLength),
        },
      });
    }
  }

  return new Response(buf, { status: 200, headers: { ...baseHeaders, "Accept-Ranges": "bytes" } });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // only same-origin asset fetches

  if (url.pathname.startsWith("/content/")) {
    const rel = decodeURIComponent(url.pathname.slice("/content/".length));
    event.respondWith(serveContent(event.request, rel));
    return;
  }
  if (url.pathname === "/api/file") {
    const p = url.searchParams.get("path");
    if (p) {
      event.respondWith(serveContent(event.request, decodeURIComponent(p).replace(/^\/+/, "")));
      return;
    }
  }
});
