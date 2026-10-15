import { ProjectCollaboration, responseHeaders } from "./project.js";
import { publicPath } from "./domain.js";
export { ProjectCollaboration };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const scope = /^\/projects\/([a-zA-Z0-9_-]{1,100})(\/.*)?$/.exec(url.pathname);
    const authorityPath = scope ? (scope[2] || "/") : url.pathname;
    if (authorityPath.startsWith("/api/") || authorityPath.startsWith("/internal/")
      || authorityPath.startsWith("/rooms/") || authorityPath === "/ws" || authorityPath === "/publisher/ws") {
      const projectId = scope?.[1] ?? env.PROJECT_ID;
      if (!projectId) return new Response("Project scope required", { status: 400 });
      url.pathname = authorityPath;
      const headers = new Headers(request.headers);
      headers.set("x-collaboration-project", projectId);
      headers.set("x-collaboration-scoped", scope ? "true" : "false");
      return env.PROJECTS.getByName(projectId).fetch(new Request(url, { method: request.method,
        headers, body: request.body, redirect: request.redirect }));
    }
    // The shared trusted shell and immutable assets carry no Project state.
    // Canonical project URLs must reload it even when that authority is removed.
    if (scope) { url.pathname = authorityPath; request = new Request(url, request); }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice(1)); } catch { return new Response("Not found", { status: 404 }); }
    if (path && !publicPath(path)) return new Response("Not found", { status: 404 });
    const sharedAsset = path.startsWith("assets/") || path.startsWith("viewer/");
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && sharedAsset) {
      const object = await env.BLOBS.get(`public-viewer/${path}`);
      if (object) {
        const headers = new Headers(); object.writeHttpMetadata(headers);
        response = new Response(request.method === "HEAD" ? null : object.body, { headers });
      }
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(responseHeaders())) headers.set(key, value);
    if (response.ok && sharedAsset) headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
