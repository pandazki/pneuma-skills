/**
 * The install stream is the only thing standing between "the user clicked
 * Download and open" and "the launcher opens a mode that is not there".
 *
 * `POST /api/catalog/install` answers newline-delimited JSON: zero or more
 * `progress` events, then exactly one `done` or `error`. What is pinned here
 * is the store's reading of that protocol, and in particular the two ways it
 * must refuse to lie:
 *
 *  - a stream that stops without a terminal event is a FAILURE. The installer
 *    writes its completion record last, so a dropped connection says nothing
 *    about what landed on disk; reporting success there would open a launch
 *    dialog for a half-installed mode.
 *  - the reason shown to the user is the server's own, never a generic
 *    "something went wrong" substituted for it.
 *
 * Also pinned: two surfaces asking for the same mode share one download (the
 * Quick Start tile and the gallery card render the same install), and a
 * percentage is only ever claimed once the server has announced a total.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  useCatalogInstallStore,
  installPercent,
  formatBytes,
} from "../store/catalog-install.js";

type FetchArgs = { url: string; body: unknown };

const calls: FetchArgs[] = [];
let originalFetch: typeof fetch;

function ndjson(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

/** Install the fake transport. `respond` receives the parsed request body. */
function stubFetch(respond: (body: { name?: string }) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(input), body });
    return respond(body);
  }) as typeof fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls.length = 0;
  useCatalogInstallStore.setState({ installs: {} });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const record = (name: string) => useCatalogInstallStore.getState().installs[name];

describe("catalog install stream", () => {
  test("progress events drive a percentage, done resolves true", async () => {
    stubFetch(() =>
      ndjson([
        '{"event":"progress","received":0,"total":1000}\n',
        '{"event":"progress","received":500,"total":1000}\n',
        '{"event":"done","version":"0.3.1"}\n',
      ]),
    );
    const ok = await useCatalogInstallStore.getState().install("backlot");
    expect(ok).toBe(true);
    expect(record("backlot").phase).toBe("done");
    expect(record("backlot").version).toBe("0.3.1");
    expect(calls[0].url).toContain("/api/catalog/install");
    expect(calls[0].body).toEqual({ name: "backlot" });
  });

  test("a percentage is only claimed once the server announces a total", () => {
    expect(installPercent({ phase: "installing", received: 0, total: 0 })).toBeNull();
    expect(installPercent({ phase: "installing", received: 250, total: 1000 })).toBe(25);
    expect(installPercent(undefined)).toBeNull();
  });

  test("an event split across chunks is still read once it completes", async () => {
    stubFetch(() =>
      ndjson([
        '{"event":"progress","recei',
        'ved":750,"total":1000}\n{"event":"do',
        'ne","version":"1.0.0"}',
      ]),
    );
    const ok = await useCatalogInstallStore.getState().install("bansho");
    expect(ok).toBe(true);
    expect(record("bansho").version).toBe("1.0.0");
  });

  test("an error event fails with the server's own message", async () => {
    stubFetch(() =>
      ndjson([
        '{"event":"progress","received":10,"total":1000}\n',
        '{"event":"error","message":"sha256 mismatch for backlot-0.3.1.tar.gz"}\n',
      ]),
    );
    const ok = await useCatalogInstallStore.getState().install("backlot");
    expect(ok).toBe(false);
    expect(record("backlot").phase).toBe("error");
    expect(record("backlot").error).toBe("sha256 mismatch for backlot-0.3.1.tar.gz");
  });

  test("a stream that ends without a terminal event is a failure, not a success", async () => {
    stubFetch(() => ndjson(['{"event":"progress","received":900,"total":1000}\n']));
    const ok = await useCatalogInstallStore.getState().install("lucid");
    expect(ok).toBe(false);
    expect(record("lucid").phase).toBe("error");
    expect(record("lucid").error).toBeTruthy();
  });

  test("a non-OK response surfaces the server's error body", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "unknown mode: nope" }), { status: 404 }));
    const ok = await useCatalogInstallStore.getState().install("nope");
    expect(ok).toBe(false);
    expect(record("nope").error).toBe("unknown mode: nope");
  });

  test("a transport failure keeps its own message", async () => {
    globalThis.fetch = (async () => { throw new Error("Failed to fetch"); }) as unknown as typeof fetch;
    const ok = await useCatalogInstallStore.getState().install("sprite");
    expect(ok).toBe(false);
    expect(record("sprite").error).toBe("Failed to fetch");
  });

  test("two surfaces asking for the same mode share one download", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async () => {
      await gate;
      return ndjson(['{"event":"done","version":"0.1.0"}\n']);
    });
    const first = useCatalogInstallStore.getState().install("doc");
    const second = useCatalogInstallStore.getState().install("doc");
    release!();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(calls.length).toBe(1);
  });

  test("a retry after a failure starts a new download", async () => {
    stubFetch(() => ndjson(['{"event":"error","message":"offline"}\n']));
    expect(await useCatalogInstallStore.getState().install("draw")).toBe(false);
    stubFetch(() => ndjson(['{"event":"done","version":"0.2.0"}\n']));
    expect(await useCatalogInstallStore.getState().install("draw")).toBe(true);
    expect(record("draw").phase).toBe("done");
    expect(record("draw").error).toBeUndefined();
    expect(calls.length).toBe(2);
  });

  test("clear() returns a card to its resting state", async () => {
    stubFetch(() => ndjson(['{"event":"done","version":"0.1.0"}\n']));
    await useCatalogInstallStore.getState().install("eli5");
    useCatalogInstallStore.getState().clear("eli5");
    expect(record("eli5")).toBeUndefined();
  });
});

describe("install size copy", () => {
  test("reads as a download size, not as bytes", () => {
    expect(formatBytes(19_900_000)).toBe("19 MB");
    expect(formatBytes(712_000)).toBe("695 KB");
    expect(formatBytes(4_500_000)).toBe("4.3 MB");
    expect(formatBytes(0)).toBe("0 KB");
  });
});
