import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { createProxyMiddleware, type ProxyConfigRef } from "../proxy-middleware.js";

// Start a tiny upstream server for integration tests
let upstreamServer: ReturnType<typeof Bun.serve>;
let upstreamPort: number;

beforeAll(() => {
  upstreamServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/echo") {
        return Response.json({
          method: req.method,
          path: url.pathname,
          query: url.search,
          authHeader: req.headers.get("authorization") ?? null,
          acceptHeader: req.headers.get("accept") ?? null,
        });
      }
      if (url.pathname === "/status/418") {
        return new Response("I'm a teapot", { status: 418 });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  upstreamPort = upstreamServer.port;
});

afterAll(() => {
  upstreamServer.stop();
});

function createTestApp(configRef: ProxyConfigRef) {
  const app = new Hono();
  app.all("/proxy/*", createProxyMiddleware(configRef));
  return app;
}

describe("proxy middleware", () => {
  test("forwards GET request to upstream", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo?foo=bar");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("/echo");
    expect(body.query).toBe("?foo=bar");
    expect(body.method).toBe("GET");
  });

  test("returns 404 for unknown proxy name", async () => {
    const configRef: ProxyConfigRef = { current: new Map() };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/unknown/path");
    expect(res.status).toBe(404);
  });

  test("returns 405 for disallowed HTTP method", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}`, methods: ["GET"] }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", { method: "POST" });
    expect(res.status).toBe(405);
  });

  test("allows configured methods", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}`, methods: ["GET", "POST"] }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("POST");
  });

  test("resolves {{ENV_VAR}} in headers", async () => {
    process.env.__TEST_PROXY_TOKEN = "secret123";
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", {
          target: `http://localhost:${upstreamPort}`,
          headers: { Authorization: "Bearer {{__TEST_PROXY_TOKEN}}" },
        }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo");
    const body = await res.json();
    expect(body.authHeader).toBe("Bearer secret123");
    delete process.env.__TEST_PROXY_TOKEN;
  });

  test("passes through accept header from client", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/echo", {
      headers: { Accept: "application/xml" },
    });
    const body = await res.json();
    expect(body.acceptHeader).toBe("application/xml");
  });

  test("transparently passes upstream status codes", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["test", { target: `http://localhost:${upstreamPort}` }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/test/status/418");
    expect(res.status).toBe(418);
  });

  test("returns 502 when upstream is unreachable", async () => {
    const configRef: ProxyConfigRef = {
      current: new Map([
        ["dead", { target: "http://localhost:1" }],
      ]),
    };
    const app = createTestApp(configRef);
    const res = await app.request("/proxy/dead/path");
    expect(res.status).toBe(502);
  });

  test("reads latest config on each request (hot reload)", async () => {
    const configRef: ProxyConfigRef = { current: new Map() };
    const app = createTestApp(configRef);

    // Initially no config -> 404
    let res = await app.request("/proxy/test/echo");
    expect(res.status).toBe(404);

    // Add config at runtime
    configRef.current = new Map([
      ["test", { target: `http://localhost:${upstreamPort}` }],
    ]);

    // Now it should work
    res = await app.request("/proxy/test/echo");
    expect(res.status).toBe(200);
  });
});
