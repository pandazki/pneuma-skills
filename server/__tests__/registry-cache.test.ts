import { expect, test } from "bun:test";
import { createRegistryCache } from "../registry-cache.js";

const mode = { name: "demo", displayName: "Demo", version: "1", publishedAt: "2026-11-02", archiveUrl: "https://example.com/demo.tgz" };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("cold local buckets and concurrent locales never wait for the published request", async () => {
  const remote = Promise.withResolvers<Response>();
  let requests = 0;
  const cache = createRegistryCache(async (locale) => ({ builtins: [locale], catalog: ["pinned"], local: ["installed"] }), {
    fetch: (() => { requests++; return remote.promise; }),
  });
  const [en, zh] = await Promise.all([cache.get("en"), cache.get("zh-CN")]);
  expect(en.builtins).toEqual(["en"]);
  expect(zh.builtins).toEqual(["zh-CN"]);
  expect(en.catalog).toEqual(["pinned"]);
  expect(en.local).toEqual(["installed"]);
  expect(en.publishedStatus.state).toBe("loading");
  expect(en.published).toEqual([]);
  expect(requests).toBe(1);
  remote.resolve(Response.json({ modes: [mode] }));
  await settle();
  const ready = await cache.get("zh-CN");
  expect(ready.publishedStatus.state).toBe("ready");
  expect(ready.published).toEqual([mode]);
});

test("failed refresh preserves last-good published modes and supports explicit retry", async () => {
  let now = 0;
  let remote = Promise.withResolvers<Response>();
  let requests = 0;
  const cache = createRegistryCache(async () => ({ local: ["installed"] }), {
    fetch: (() => { requests++; return remote.promise; }), now: () => now, ttlMs: 10,
  });
  await cache.get("en");
  remote.resolve(Response.json({ modes: [mode] }));
  await settle();
  remote = Promise.withResolvers<Response>();
  now = 11;
  const refreshing = await cache.get("en");
  expect(refreshing.published).toEqual([mode]);
  expect(refreshing.publishedStatus.state).toBe("loading");
  remote.resolve(new Response("offline", { status: 503 }));
  await settle();
  const failed = await cache.get("en");
  expect(failed.published).toEqual([mode]);
  expect(failed.publishedStatus).toEqual({ state: "error", error: "Published mode registry returned HTTP 503" });
  expect(requests).toBe(2);
  remote = Promise.withResolvers<Response>();
  expect((await cache.get("en", true)).publishedStatus.state).toBe("loading");
  expect(requests).toBe(3);
  remote.resolve(Response.json({ modes: [] }));
  await settle();
  expect((await cache.get("en")).published).toEqual([]);
  expect((await cache.get("en")).publishedStatus.state).toBe("ready");
});

test("invalidation cannot restore an older in-flight local snapshot", async () => {
  const oldLocal = Promise.withResolvers<{ local: string[] }>();
  let builds = 0;
  const cache = createRegistryCache(async () => ++builds === 1 ? oldLocal.promise : { local: ["new"] }, {
    fetch: (async () => Response.json({ modes: [] })),
  });
  const oldRequest = cache.get("en");
  await settle();
  cache.invalidate();
  expect((await cache.get("en")).local).toEqual(["new"]);
  oldLocal.resolve({ local: ["old"] });
  expect((await oldRequest).local).toEqual(["new"]);
  expect((await cache.get("en")).local).toEqual(["new"]);
  expect(builds).toBe(2);
});

test("local SWR deduplicates stale revalidation and keeps locale buckets separate", async () => {
  let now = 0;
  let builds = 0;
  const next = Promise.withResolvers<{ local: string[] }>();
  const cache = createRegistryCache(async (locale) => ++builds <= 2 ? { local: [locale] } : next.promise, {
    fetch: (async () => Response.json({ modes: [] })), now: () => now, ttlMs: 10,
  });
  await cache.get("en");
  await cache.get("ja");
  now = 11;
  expect((await cache.get("en")).local).toEqual(["en"]);
  expect((await cache.get("en")).local).toEqual(["en"]);
  expect(builds).toBe(3);
  next.resolve({ local: ["en-updated"] });
  await settle();
  expect((await cache.get("en")).local).toEqual(["en-updated"]);
});

test("invalid remote records fail visibly instead of replacing a usable list", async () => {
  const cache = createRegistryCache(async () => ({}), {
    fetch: (async () => Response.json({ modes: [{ name: "broken" }] })),
  });
  await cache.get("en");
  await settle();
  expect((await cache.get("en")).publishedStatus.state).toBe("error");
});

test("a synchronous fetch failure releases the in-flight attempt for retry", async () => {
  let requests = 0;
  const cache = createRegistryCache(async () => ({}), {
    fetch: (() => {
      if (++requests === 1) throw new Error("offline before request");
      return Promise.resolve(Response.json({ modes: [] }));
    }),
  });
  await cache.get("en");
  await settle();
  expect((await cache.get("en")).publishedStatus.state).toBe("error");
  await cache.get("en", true);
  await settle();
  expect(requests).toBe(2);
  expect((await cache.get("en")).publishedStatus.state).toBe("ready");
});
