import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeProjectFile } from "../api-client.js";

const originalFetch = globalThis.fetch;

describe("writeProjectFile", () => {
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: async () => response.body ?? {},
      } as Response;
    }) as typeof fetch;
  }

  it("POSTs to /api/files with path=project.json and the given content", async () => {
    mockFetch({ ok: true, body: { ok: true } });
    await writeProjectFile("{\"hello\": \"world\"}");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/files");
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(fetchCalls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
    });
    const body = JSON.parse(fetchCalls[0].init?.body as string);
    expect(body).toEqual({
      path: "project.json",
      content: "{\"hello\": \"world\"}",
    });
  });

  it("throws when the server responds with a non-OK status", async () => {
    mockFetch({ ok: false, status: 403, body: { error: "Forbidden" } });
    await expect(writeProjectFile("x")).rejects.toThrow(/403/);
  });

  it("throws when the server responds 500", async () => {
    mockFetch({ ok: false, status: 500, body: { error: "Failed to write file" } });
    await expect(writeProjectFile("x")).rejects.toThrow(/500/);
  });
});
