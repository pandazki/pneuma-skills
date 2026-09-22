/**
 * fal-queue.mjs::uploadFalFile — the leg that turns a local clip into a URL
 * fal can fetch.
 *
 * It exists because a data URI is not a general input path: the video
 * endpoints validate `video_url` as a URL and reject anything past 2083
 * characters (measured 2026-09-22 — VEED answers 422 `url_too_long`, Topaz
 * 400 `Invalid URL: URL too long`). The video scripts inject a stub for
 * this helper, so without this file nothing pins the flow itself: that the
 * intent is POSTed with the key and the file's own MIME type, that the
 * bytes then go to the pre-signed URL WITHOUT the key, that the returned
 * URL is the `file_url` and not the `upload_url`, and that either half
 * failing is reported with its status and the head of its body.
 *
 * No network: `fetchImpl` is injected.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAL_UPLOAD_INITIATE_URL, uploadFalFile } from "../fal-queue.mjs";

const workspace = mkdtempSync(join(tmpdir(), "fal-upload-test-"));
const CLIP_BYTES = Buffer.from("fake mp4 payload, big enough to never be a data URI in production");
const clip = join(workspace, "loop.mp4");
writeFileSync(clip, CLIP_BYTES);

const UPLOAD_URL = "https://storage.googleapis.com/fal-cdn-v3/upload?signature=abc";
const FILE_URL = "https://v3b.fal.media/files/b/0a847700/loop.mp4";

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal };
}

/** Records every call and answers initiate → PUT, unless told otherwise. */
function fetchStub(
  answers: { initiate?: () => Response; put?: () => Response } = {},
  calls: Call[] = [],
) {
  const impl = async (url: string, init: Call["init"] = {}) => {
    calls.push({ url, init });
    if (url === FAL_UPLOAD_INITIATE_URL) {
      return answers.initiate?.() ?? Response.json({ upload_url: UPLOAD_URL, file_url: FILE_URL });
    }
    return answers.put?.() ?? new Response("", { status: 200 });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("uploadFalFile", () => {
  test("initiates with the key and the file's MIME type, then PUTs the bytes without it", async () => {
    const { impl, calls } = fetchStub();
    const notes: string[] = [];
    const url = await uploadFalFile(clip, { key: "fixture-key", label: "--input", fetchImpl: impl, onNote: (m: string) => notes.push(m) });

    // The URL a caller passes on is the file's, never the pre-signed one.
    expect(url).toBe(FILE_URL);
    expect(calls).toHaveLength(2);

    const [initiate, put] = calls;
    expect(initiate.url).toBe(FAL_UPLOAD_INITIATE_URL);
    expect(initiate.url).toContain("storage_type=fal-cdn-v3");
    expect(initiate.init.method).toBe("POST");
    expect(initiate.init.headers).toEqual({ Authorization: "Key fixture-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(initiate.init.body))).toEqual({ content_type: "video/mp4", file_name: "loop.mp4" });

    expect(put.url).toBe(UPLOAD_URL);
    expect(put.init.method).toBe("PUT");
    // The pre-signed URL points at a storage host with no business seeing
    // the key; only the content type travels with the bytes.
    expect(put.init.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(Buffer.from(put.init.body)).toEqual(CLIP_BYTES);

    // The transfer is announced with its size — it is the slow part.
    expect(notes.join("\n")).toMatch(/uploading loop\.mp4 \(0\.0 MB\) to fal storage/);
  });

  test("the caller's signal reaches both calls", async () => {
    const controller = new AbortController();
    const { impl, calls } = fetchStub();
    await uploadFalFile(clip, { key: "k", fetchImpl: impl, onNote: () => {}, signal: controller.signal });
    expect(calls.map((call) => call.init.signal)).toEqual([controller.signal, controller.signal]);
  });

  test("a refused initiate says so with its status and the head of its body", async () => {
    const { impl, calls } = fetchStub({ initiate: () => new Response("x".repeat(500), { status: 401 }) });
    await expect(uploadFalFile(clip, { key: "bad", label: "--input", fetchImpl: impl, onNote: () => {} }))
      .rejects.toThrow(/--input: fal storage refused the upload \(HTTP 401\): x{300}$/);
    // Nothing was PUT: there is no URL to PUT to.
    expect(calls).toHaveLength(1);
  });

  test("a failed PUT says which half lost it", async () => {
    const { impl } = fetchStub({ put: () => new Response("upstream rejected the object", { status: 503 }) });
    await expect(uploadFalFile(clip, { key: "k", label: "--input", fetchImpl: impl, onNote: () => {} }))
      .rejects.toThrow(/--input: fal storage upload failed \(HTTP 503\): upstream rejected the object/);
  });

  test("an initiate that answers something else is refused rather than half-followed", async () => {
    const notJson = fetchStub({ initiate: () => new Response("<html>gateway</html>", { status: 200 }) });
    await expect(uploadFalFile(clip, { key: "k", fetchImpl: notJson.impl, onNote: () => {} }))
      .rejects.toThrow(/was not JSON/);

    const noUrls = fetchStub({ initiate: () => Response.json({ upload_url: UPLOAD_URL }) });
    await expect(uploadFalFile(clip, { key: "k", fetchImpl: noUrls.impl, onNote: () => {} }))
      .rejects.toThrow(/no upload_url\/file_url/);
    expect(noUrls.calls).toHaveLength(1);
  });

  test("a missing key, a missing file and an unknown extension never reach the network", async () => {
    const { impl, calls } = fetchStub();
    await expect(uploadFalFile(clip, { key: "", fetchImpl: impl, onNote: () => {} })).rejects.toThrow("fal API key");
    await expect(uploadFalFile(join(workspace, "gone.mp4"), { key: "k", label: "--input", fetchImpl: impl, onNote: () => {} }))
      .rejects.toThrow("--input: file not found");

    const odd = join(workspace, "loop.xyz");
    writeFileSync(odd, CLIP_BYTES);
    await expect(uploadFalFile(odd, { key: "k", label: "--input", fetchImpl: impl, onNote: () => {} }))
      .rejects.toThrow("--input: unsupported file extension");

    await expect(uploadFalFile("", { key: "k", label: "--input", fetchImpl: impl, onNote: () => {} }))
      .rejects.toThrow("--input: a file path is required");

    expect(calls).toEqual([]);
  });
});
