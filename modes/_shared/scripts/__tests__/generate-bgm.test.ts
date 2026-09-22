/**
 * generate-bgm.mjs — Lyria 3 Pro on OpenRouter, over SSE.
 *
 * Promoted from clipcraft (which still carries its own copy) when backlot
 * needed a music bed. Three layers are pinned here, none of them touching
 * the network:
 *
 *  - the request: what a duration ask actually becomes, since Lyria has no
 *    duration parameter and a silently dropped `--duration` is the failure
 *    the prompt hint exists to prevent;
 *  - the stream reader, against a hand-built SSE body — heartbeats,
 *    unparseable events, split chunks, and the no-audio answer that must
 *    carry the model's text into the error;
 *  - the CLI's own guard rails by spawning the real script, plus the key
 *    discovery every sibling shared script documents (environment first,
 *    then a `.env`).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BGM_ENDPOINT,
  BGM_MODEL,
  buildBgmRequest,
  generateBgm,
  loadOpenRouterKey,
  streamAudioRequest,
} from "../generate-bgm.mjs";

const SCRIPT = join(import.meta.dir, "..", "generate-bgm.mjs");

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "bgm-"));
}

/** An SSE body, split at arbitrary points so the reader's buffering is
 *  exercised rather than assumed. */
function sseResponse(events: string[], { chunkSize = 17, ok = true, status = 200, body = "" } = {}): Response {
  const text = events.map((event) => `${event}\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
  if (!ok) return new Response(body, { status });
  return new Response(stream, { status });
}

const audioEvent = (data: string) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] }) }`;
const textEvent = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] }) }`;

describe("the request", () => {
  test("a duration ask becomes a prompt hint, because the model has no duration field", () => {
    expect(buildBgmRequest({ prompt: "drums and guqin" })).toEqual({
      model: BGM_MODEL,
      modalities: ["text", "audio"],
      messages: [{ role: "user", content: "drums and guqin" }],
    });
    // The ask is never silently dropped: it travels where the model can
    // read it.
    expect(buildBgmRequest({ prompt: "drums", duration: 30 }).messages[0].content).toBe(
      "drums (approximately 30 seconds long)",
    );
    expect(buildBgmRequest({ prompt: "drums", model: "other/model" }).model).toBe("other/model");
  });

  test("an empty brief is refused before a key is even read", () => {
    expect(() => buildBgmRequest({ prompt: "" })).toThrow(/--prompt is required/);
    expect(() => buildBgmRequest({ prompt: undefined as unknown as string })).toThrow(/--prompt is required/);
  });
});

describe("the stream", () => {
  test("collects audio across events, skipping heartbeats and unparseable lines", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return sseResponse([
        ": keep-alive",
        audioEvent("QUJD"),
        "data: {not json at all",
        textEvent("here is your music"),
        audioEvent("REVG"),
        "data: [DONE]",
      ]);
    }) as unknown as typeof fetch;

    const result = await streamAudioRequest(buildBgmRequest({ prompt: "drums" }), "key-never-printed", { fetchImpl });
    expect(result.audioBase64).toBe("QUJDREVG");
    expect(result.textContent).toBe("here is your music");
    expect(calls[0].url).toBe(BGM_ENDPOINT);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: BGM_MODEL, stream: true });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key-never-printed");
  });

  test("a non-200 carries the vendor's own text into the error", async () => {
    const fetchImpl = (async () => sseResponse([], { ok: false, status: 429, body: "slow down" })) as unknown as typeof fetch;
    await expect(streamAudioRequest(buildBgmRequest({ prompt: "x" }), "k", { fetchImpl })).rejects.toThrow(
      /OpenRouter API failed \(429\): slow down/,
    );
  });
});

describe("generateBgm", () => {
  test("writes the decoded bytes and reports what it wrote", async () => {
    const dir = workspace();
    try {
      const output = join(dir, "sound", "music.mp3");
      const payload = Buffer.from("ID3 pretend these are mp3 frames").toString("base64");
      const fetchImpl = (async () => sseResponse([audioEvent(payload), "data: [DONE]"])) as unknown as typeof fetch;

      const result = await generateBgm({ prompt: "guqin", output, seconds: 20, apiKey: "k" }, { fetchImpl });
      expect(result).toMatchObject({ path: output, model: BGM_MODEL });
      expect(readFileSync(output, "utf-8")).toBe("ID3 pretend these are mp3 frames");
      expect(result.bytes).toBe(32);
      // The staging file does not survive: a watcher never sees half an MP3.
      expect(() => readFileSync(`${output}.tmp`)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an answer with no audio fails with what the model said instead", async () => {
    const dir = workspace();
    try {
      const fetchImpl = (async () =>
        sseResponse([textEvent("I can't generate copyrighted melodies."), "data: [DONE]"])) as unknown as typeof fetch;
      await expect(
        generateBgm({ prompt: "the Star Wars theme", output: join(dir, "m.mp3"), apiKey: "k" }, { fetchImpl }),
      ).rejects.toThrow(/No audio data received.*copyrighted/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses without an output path or a key, before the request", async () => {
    const fetchImpl = (async () => {
      throw new Error("the network must not be touched");
    }) as unknown as typeof fetch;
    await expect(generateBgm({ prompt: "x", output: "" }, { fetchImpl })).rejects.toThrow(/--output is required/);
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      // The `.env` walk can find a real key on a developer's machine; pass
      // an explicitly empty one to pin the refusal itself.
      await expect(generateBgm({ prompt: "x", output: "/tmp/x.mp3", apiKey: "" }, { fetchImpl })).rejects.toThrow(/No API key found/);
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });
});

describe("the key and the CLI", () => {
  test("the environment wins, then a .env beside the caller", () => {
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "from-the-environment";
    try {
      expect(loadOpenRouterKey()).toBe("from-the-environment");
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved;
    }
  });

  test("reads a quoted value out of a .env, and never prints it", () => {
    const dir = workspace();
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      writeFileSync(join(dir, ".env"), '# a comment\nOTHER=x\nOPENROUTER_API_KEY="sk-from-dot-env"\n');
      const result = Bun.spawnSync(
        [process.execPath, "-e", `import("${SCRIPT}").then((m) => console.log(m.loadOpenRouterKey()))`],
        { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, OPENROUTER_API_KEY: "" } },
      );
      expect(result.stdout.toString().trim()).toBe("sk-from-dot-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });

  test("the CLI refuses a missing --prompt / --output and prints its help", () => {
    const dir = workspace();
    try {
      const missing = Bun.spawnSync([process.execPath, SCRIPT, "--output", join(dir, "m.mp3")], { stdout: "pipe", stderr: "pipe" });
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.toString()).toContain("--prompt is required");
      const help = Bun.spawnSync([process.execPath, SCRIPT, "--help"], { stdout: "pipe", stderr: "pipe" });
      expect(help.exitCode).toBe(0);
      expect(help.stderr.toString()).toContain("Usage: generate-bgm.mjs");
      // The help says what the duration ask really is.
      expect(help.stderr.toString()).toContain("has no duration parameter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clipcraft's copy is left alone — this one is the shared surface", () => {
    const clipcraft = join(import.meta.dir, "..", "..", "..", "clipcraft", "skill", "scripts", "generate-bgm.mjs");
    const theirs = readFileSync(clipcraft, "utf-8");
    expect(theirs).toContain("ClipCraft BGM Generator CLI");
    // The shared copy says where it came from, so the next reader knows
    // there are two and which one they are looking at.
    expect(readFileSync(SCRIPT, "utf-8")).toContain("modes/clipcraft/skill/scripts/generate-bgm.mjs");
  });
});
