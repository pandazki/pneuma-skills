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
/** Active content set prefix (e.g. "blog-heroes", "en-dark"). Some viewers
 *  request assets relative to the content set, expecting the server to prepend
 *  it; we do the same here. */
let activeContentSet = null;

// A service worker is NOT a long-lived process: the browser terminates it after
// ~30 s idle and restarts it on the next fetch with a fresh module scope — and
// `controllerchange` does not fire for a restart, so the page never re-pushes.
// Keeping the checkout only in the variables above therefore meant every asset
// fetched LATE in a session answered 404 while the page still had the very same
// checkpoint open (measured against a sprite package: assets 200 right after
// load, the identical URL 404 after 95 s of no traffic). Modes that paint
// everything in the load burst never noticed; anything fetched on demand — a
// sprite motion's frames, an mp4 opened from the Video tab, bansho narration —
// did. So the checkout is mirrored into the Cache API, the storage a restarted
// worker can read back, and restored on the first request of a new lifetime.
const STATE_CACHE = "pneuma-player-state-v1";
/** Not a real route — a stable key inside our own cache. */
const STATE_KEY = "https://pneuma.invalid/__player-checkout__";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function persistState() {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(STATE_KEY, new Response(JSON.stringify({ active, activeContentSet })));
  } catch (err) {
    // Degrades to the old behaviour (assets 404 after a restart) rather than
    // failing the checkout that is about to render the page.
    console.warn("[player-sw] could not persist the checkout map:", err);
  }
}

/** Rehydrate a restarted worker. No-op once this lifetime has a checkout — a
 *  message that arrived first is always newer than what is on disk. */
async function ensureState() {
  if (active) return;
  try {
    const cache = await caches.open(STATE_CACHE);
    const stored = await cache.match(STATE_KEY);
    if (!stored) return;
    const data = await stored.json();
    if (active) return; // a checkout landed while we were reading
    active = data && data.active ? data.active : null;
    if (activeContentSet === null && data && data.activeContentSet) {
      activeContentSet = data.activeContentSet;
    }
  } catch (err) {
    console.warn("[player-sw] could not restore the checkout map:", err);
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "pneuma-player-checkout") {
    active = { baseUrl: data.baseUrl.replace(/\/$/, ""), files: data.files || {} };
    event.waitUntil(persistState());
  } else if (data && data.type === "pneuma-player-content-set") {
    activeContentSet = data.contentSet || null;
    event.waitUntil(persistState());
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
  // Viewers like illustrate/doc request assets relative to the content set
  // (e.g. "images/x.png"), expecting the server to prepend the active set.
  if (activeContentSet && active.files[`${activeContentSet}/${rel}`]) {
    return `${activeContentSet}/${rel}`;
  }
  // Progressively strip leading segments (handles requests carrying a prefix
  // the manifest doesn't use).
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join("/");
    if (active.files[candidate]) return candidate;
  }
  // Suffix match — a single file whose path ends with /rel. Safe net for
  // single-content-set packages where the prefix wasn't supplied.
  const suffix = "/" + rel;
  for (const key in active.files) {
    if (key.endsWith(suffix)) return key;
  }
  return null;
}

async function serveContent(request, rel) {
  await ensureState();
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
