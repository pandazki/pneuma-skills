import type { Context } from "hono";
import type { ProxyRoute } from "../core/types/mode-manifest.js";

/** Mutable ref so config can be hot-reloaded without re-registering the middleware */
export interface ProxyConfigRef {
  current: Map<string, ProxyRoute>;
}

/** Headers to passthrough from the browser request to upstream */
const PASSTHROUGH_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "accept-language",
];

/**
 * Response headers to strip before forwarding to the browser.
 * Includes hop-by-hop headers plus content-encoding — Bun's fetch() auto-decompresses
 * gzip/br responses, so the body is already plain text. Forwarding the original
 * content-encoding header would cause the browser to attempt double decompression.
 */
const STRIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding",
  "content-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

/** Resolve {{ENV_VAR}} templates in a header value */
function resolveEnvTemplates(value: string): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });
}

/**
 * Merge manifest-level and workspace-level proxy configs into a single Map.
 * Workspace config wins on key collision.
 */
export function mergeProxyConfig(
  manifestProxy?: Record<string, ProxyRoute>,
  workspaceProxy?: Record<string, ProxyRoute>,
): Map<string, ProxyRoute> {
  const merged = new Map<string, ProxyRoute>();
  if (manifestProxy) {
    for (const [name, route] of Object.entries(manifestProxy)) {
      merged.set(name, route);
    }
  }
  if (workspaceProxy) {
    for (const [name, route] of Object.entries(workspaceProxy)) {
      merged.set(name, route);
    }
  }
  return merged;
}

/**
 * Create a Hono handler that reverse-proxies `/proxy/<name>/<path>` to the
 * configured upstream target.
 */
export function createProxyMiddleware(configRef: ProxyConfigRef) {
  return async (c: Context) => {
    const path = c.req.path;

    // Parse /proxy/<name>/<remaining>
    const afterProxy = path.replace(/^\/proxy\//, "");
    const slashIdx = afterProxy.indexOf("/");
    const name = slashIdx === -1 ? afterProxy : afterProxy.slice(0, slashIdx);
    const remaining = slashIdx === -1 ? "/" : afterProxy.slice(slashIdx);

    const route = configRef.current.get(name);
    if (!route) {
      return c.text("Proxy route not found", 404);
    }

    // Method check
    const allowedMethods = route.methods ?? ["GET"];
    const method = c.req.method.toUpperCase();
    if (!allowedMethods.includes(method)) {
      return c.text("Method not allowed", 405);
    }

    // Build upstream URL
    const url = new URL(c.req.url);
    const targetBase = route.target.replace(/\/+$/, "");
    const upstreamUrl = `${targetBase}${remaining}${url.search}`;

    // Build headers
    const headers = new Headers();

    // Passthrough selected browser headers
    for (const h of PASSTHROUGH_REQUEST_HEADERS) {
      const val = c.req.header(h);
      if (val) headers.set(h, val);
    }

    // Apply route-level headers (with env template resolution)
    if (route.headers) {
      for (const [key, value] of Object.entries(route.headers)) {
        headers.set(key, resolveEnvTemplates(value));
      }
    }

    // Body passthrough for methods that have a body
    const hasBody = ["POST", "PUT", "PATCH"].includes(method);
    const body = hasBody ? c.req.raw.body : undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const upstream = await fetch(upstreamUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
        // @ts-expect-error -- Bun supports duplex for streaming request bodies
        duplex: hasBody ? "half" : undefined,
      });

      clearTimeout(timeout);

      // Build response headers, filtering hop-by-hop
      const responseHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return c.text("Bad Gateway", 502);
    }
  };
}
