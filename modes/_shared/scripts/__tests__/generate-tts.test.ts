/**
 * generate-tts.mjs — the one production synthesis path (bansho +
 * clipcraft). Three layers pinned here:
 *
 *  - pure helpers: WAV duration parsing and the `--json` stdout contract
 *    bansho's narration manifest copies from;
 *  - the network half via `synthesizeToFile` with an INJECTED fetch —
 *    every failure branch (fal non-200 with its error text, a response
 *    with no audio URL, a failed download) plus the happy path's request
 *    shape and written bytes, no real fal.ai call anywhere;
 *  - the CLI's own guard rails by spawning the real script: `--temperature`
 *    validation and the missing-FAL_KEY death, both of which die before
 *    any network I/O.
 */

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResultJson,
  formatFromPath,
  synthesizeToFile,
  wavDurationSeconds,
} from "../generate-tts.mjs";

/** Minimal valid RIFF/WAVE bytes: `byteRate` and a data chunk of `dataLen`. */
function wavBytes(byteRate: number, dataLen: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(44 + dataLen);
  const view = new DataView(buf.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24000, true); // sample rate
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataLen, true);
  return buf;
}

describe("wavDurationSeconds", () => {
  test("data bytes over byte rate, exactly", () => {
    // 48000 B/s (24kHz 16-bit mono), 96000 bytes of samples = 2 seconds.
    expect(wavDurationSeconds(wavBytes(48000, 96000))).toBe(2);
  });

  test("fractional seconds survive (no rounding in the measurement)", () => {
    expect(wavDurationSeconds(wavBytes(48000, 12000))).toBeCloseTo(0.25, 10);
  });

  test("non-WAV bytes return null, never throw", () => {
    expect(wavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
    const mp3ish = new Uint8Array(64).fill(0xff);
    expect(wavDurationSeconds(mp3ish)).toBeNull();
  });

  test("a WAV missing its data chunk returns null", () => {
    const bytes = wavBytes(48000, 0).slice(0, 36);
    expect(wavDurationSeconds(bytes)).toBeNull();
  });
});

describe("buildResultJson (--json stdout contract)", () => {
  test("path plus seconds when the audio was measurable", () => {
    expect(JSON.parse(buildResultJson("out.wav", 2.5))).toEqual({
      path: "out.wav",
      seconds: 2.5,
    });
  });

  test("path alone when duration could not be measured (mp3/ogg)", () => {
    expect(JSON.parse(buildResultJson("out.mp3", null))).toEqual({
      path: "out.mp3",
    });
  });
});

describe("formatFromPath", () => {
  test("infers wav / ogg_opus / mp3 from the extension", () => {
    expect(formatFromPath("a.wav")).toBe("wav");
    expect(formatFromPath("a.ogg")).toBe("ogg_opus");
    expect(formatFromPath("a.opus")).toBe("ogg_opus");
    expect(formatFromPath("a.mp3")).toBe("mp3");
    expect(formatFromPath("a.weird")).toBe("mp3");
  });
});

// ── The network half, with an injected fetch ────────────────────────────────

/** A fetch double answering from a queue; records every call it takes. */
function fetchQueue(
  responses: Response[],
): { impl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("fetch double: no response queued");
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

describe("synthesizeToFile — every failure names its cause, nothing exits", () => {
  const body = { prompt: "hi", voice: "Kore", output_format: "wav" };

  test("fal non-200 propagates the status and the response text", async () => {
    const { impl } = fetchQueue([
      new Response("quota exhausted", { status: 429 }),
    ]);
    await expect(
      synthesizeToFile(body, "k", "/nonexistent/out.wav", impl),
    ).rejects.toThrow(
      "fal-ai/gemini-3.1-flash-tts failed (429): quota exhausted",
    );
  });

  test("a 200 with no audio URL fails loudly, before any download", async () => {
    const { impl, calls } = fetchQueue([Response.json({ audio: {} })]);
    await expect(
      synthesizeToFile(body, "k", "/nonexistent/out.wav", impl),
    ).rejects.toThrow("fal.ai returned no audio URL");
    expect(calls.length).toBe(1); // never reached for the audio
  });

  test("a failed download carries its status", async () => {
    const { impl } = fetchQueue([
      Response.json({ audio: { url: "https://cdn.example/a.wav" } }),
      new Response("gone", { status: 404 }),
    ]);
    await expect(
      synthesizeToFile(body, "k", "/nonexistent/out.wav", impl),
    ).rejects.toThrow("Failed to download audio (404)");
  });

  test("happy path: authorized fal call, bytes written and measurable", async () => {
    const wav = wavBytes(48000, 96000); // exactly 2 seconds
    const { impl, calls } = fetchQueue([
      Response.json({ audio: { url: "https://cdn.example/a.wav" } }),
      new Response(wav),
    ]);
    const dir = mkdtempSync(join(tmpdir(), "tts-test-"));
    try {
      const out = join(dir, "nested", "out.wav");
      const bytes = await synthesizeToFile(body, "secret-key", out, impl);
      // The fal request carries the key and the body — and never leaks
      // the key anywhere else.
      expect(calls[0]!.url).toContain("fal.run/fal-ai/gemini-3.1-flash-tts");
      const headers = calls[0]!.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Key secret-key");
      expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(body);
      // Returned bytes === written bytes, and the duration measures.
      expect(new Uint8Array(readFileSync(out))).toEqual(bytes);
      expect(wavDurationSeconds(bytes)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── The CLI's own guard rails (real spawns; all die before network I/O) ─────

const SCRIPT = fileURLToPath(new URL("../generate-tts.mjs", import.meta.url));

function runCli(
  args: string[],
  envPatch: Record<string, string | undefined>,
  cwd: string,
): { exitCode: number; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const res = Bun.spawnSync({
    cmd: [process.execPath, SCRIPT, ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: res.exitCode, stderr: res.stderr.toString() };
}

describe("CLI guard rails", () => {
  test("an out-of-range or non-numeric --temperature dies with the value named", () => {
    // cwd outside the repo so no stray .env can leak a key into the run;
    // a dummy key passes the key check so the temperature branch is what
    // dies — still strictly before any network call.
    const dir = mkdtempSync(join(tmpdir(), "tts-cli-"));
    try {
      for (const bad of ["9", "abc"]) {
        const { exitCode, stderr } = runCli(
          ["--text", "hi", "--output", join(dir, "o.wav"), "--temperature", bad],
          { FAL_KEY: "dummy" },
          dir,
        );
        expect(exitCode).toBe(1);
        expect(stderr).toContain(`invalid --temperature "${bad}" (must be 0-2)`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no FAL_KEY anywhere dies with the documented message", () => {
    const dir = mkdtempSync(join(tmpdir(), "tts-cli-"));
    try {
      const { exitCode, stderr } = runCli(
        ["--text", "hi", "--output", join(dir, "o.wav")],
        { FAL_KEY: undefined },
        dir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("FAL_KEY is not set");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the skill-root .env supplies FAL_KEY like every sibling script", () => {
    // The installed geometry skill-installer.ts documents: the shared
    // script is copied to {SKILL_PATH}/scripts/<file> and the mode's .env
    // (from envMapping) sits at {SKILL_PATH}/.env — which findEnvFile
    // discovers from the SCRIPT's location, not from cwd (the agent runs
    // from the session dir). A user who hand-edits that .env after
    // session start must reach TTS too: the key check passes and the
    // script dies on the NEXT guard instead. cwd is a separate dir so
    // Bun's own cwd .env auto-loading cannot fake the pass.
    const dir = mkdtempSync(join(tmpdir(), "tts-cli-"));
    try {
      const scriptsDir = join(dir, "skill", "scripts");
      const cwd = join(dir, "elsewhere");
      mkdirSync(scriptsDir, { recursive: true });
      mkdirSync(cwd, { recursive: true });
      const installed = join(scriptsDir, "generate-tts.mjs");
      writeFileSync(installed, readFileSync(SCRIPT));
      writeFileSync(join(dir, "skill", ".env"), 'FAL_KEY="from-dotenv"\n');
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
      }
      delete env.FAL_KEY;
      const res = Bun.spawnSync({
        cmd: [process.execPath, installed],
        env,
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = res.stderr.toString();
      expect(res.exitCode).toBe(1);
      expect(stderr).not.toContain("FAL_KEY is not set");
      expect(stderr).toContain("--text is required");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
