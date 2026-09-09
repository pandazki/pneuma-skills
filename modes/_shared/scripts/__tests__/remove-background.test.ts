/**
 * remove-background.mjs — BiRefNet v2 on fal.ai.
 *
 * The mapping from this CLI's short aliases to fal's display-name enum is
 * the whole point of the script, so every alias is pinned here; the network
 * half runs against an injected job runner and downloader, never fal.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BIREFNET_URL,
  buildRemoveBackgroundRequest,
  MODEL_ALIASES,
  removeBackground,
} from "../remove-background.mjs";

const workspace = mkdtempSync(join(tmpdir(), "birefnet-test-"));
/** 1×1 grey+alpha PNG — the same fixture the image tests use. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  "base64",
);
const sheet = join(workspace, "sheet-raw.png");
writeFileSync(sheet, PNG);
const dataUri = `data:image/png;base64,${PNG.toString("base64")}`;

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "remove-background.mjs");

function runCli(args: string[], env: Record<string, string> = {}) {
  const res = Bun.spawnSync({
    cmd: [process.execPath, "--env-file=/dev/null", SCRIPT, ...args],
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "", FAL_KEY: "fixture-key", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}

describe("birefnet request bodies", () => {
  test("the default is the heavy general model at 2048, refined", () => {
    const request = buildRemoveBackgroundRequest({ input: sheet, output: join(workspace, "out.png") });
    expect(request.url).toBe(BIREFNET_URL);
    expect(request.body).toEqual({
      image_url: dataUri,
      model: "General Use (Heavy)",
      operating_resolution: "2048x2048",
      output_format: "png",
      refine_foreground: true,
    });
  });

  test("every alias maps to fal's own spelling, and nothing else does", () => {
    expect(MODEL_ALIASES).toEqual({
      light: "General Use (Light)",
      "light-2k": "General Use (Light 2K)",
      heavy: "General Use (Heavy)",
      matting: "Matting",
      portrait: "Portrait",
      dynamic: "General Use (Dynamic)",
    });
    for (const [alias, falName] of Object.entries(MODEL_ALIASES)) {
      const request = buildRemoveBackgroundRequest({ input: sheet, output: join(workspace, "out.png"), model: alias });
      expect(request.body.model).toBe(falName);
      expect(request.model).toBe(alias);
    }
    expect(() => buildRemoveBackgroundRequest({ input: sheet, output: join(workspace, "out.png"), model: "General Use (Heavy)" })).toThrow("--model");
    expect(() => buildRemoveBackgroundRequest({ input: sheet, output: join(workspace, "out.png"), model: "best" })).toThrow("--model");
  });

  test("resolution, refinement and the output container are all checked here", () => {
    const out = join(workspace, "out.png");
    expect(buildRemoveBackgroundRequest({ input: sheet, output: out, resolution: "1024" }).body.operating_resolution).toBe("1024x1024");
    expect(buildRemoveBackgroundRequest({ input: sheet, output: out, resolution: "2304" }).body.operating_resolution).toBe("2304x2304");
    expect(buildRemoveBackgroundRequest({ input: sheet, output: out, refine: false }).body.refine_foreground).toBe(false);
    expect(() => buildRemoveBackgroundRequest({ input: sheet, output: out, resolution: "512" })).toThrow("--resolution");
    expect(() => buildRemoveBackgroundRequest({ input: sheet, output: join(workspace, "out.jpg") })).toThrow("--output");
    expect(() => buildRemoveBackgroundRequest({ input: join(workspace, "gone.png"), output: out })).toThrow("not found");
    expect(() => buildRemoveBackgroundRequest({ output: out })).toThrow("--input");
    expect(() => buildRemoveBackgroundRequest({ input: sheet })).toThrow("--output");
    expect(buildRemoveBackgroundRequest({ input: "https://example.com/a.png", output: out }).body.image_url).toBe("https://example.com/a.png");
  });
});

describe("birefnet download and result", () => {
  test("the cut-out lands on disk with the dimensions fal reported", async () => {
    const output = join(workspace, "cut", "sheet-alpha.png");
    const result = await removeBackground(
      { input: sheet, output, apiKey: "fixture-key", model: "matting" },
      {
        runJob: async (options: { url: string; body: { model: string } }) => {
          expect(options.url).toBe(BIREFNET_URL);
          expect(options.body.model).toBe("Matting");
          return { data: { image: { url: "https://cdn.fal.ai/cut.png", width: 2048, height: 1024 } }, apiMs: 5, attempts: 1 };
        },
        download: async () => PNG,
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/cut.png",
      width: 2048,
      height: 1024,
      model: "Matting",
    });
    expect(readFileSync(output)).toEqual(PNG);
  });

  test("dimensions fal omits are read back out of the PNG, and a missing image URL fails", async () => {
    const output = join(workspace, "cut", "fallback.png");
    const result = await removeBackground(
      { input: sheet, output, apiKey: "fixture-key" },
      {
        runJob: async () => ({ data: { image: { url: "https://cdn.fal.ai/cut.png" } }, apiMs: 5, attempts: 1 }),
        download: async () => PNG,
      },
    );
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);

    const missing = join(workspace, "cut", "never.png");
    await expect(
      removeBackground(
        { input: sheet, output: missing, apiKey: "fixture-key" },
        { runJob: async () => ({ data: {}, apiMs: 5, attempts: 1 }), download: async () => PNG },
      ),
    ).rejects.toThrow("no image URL");
    expect(existsSync(missing)).toBe(false);
  });
});

describe("remove-background CLI guard rails", () => {
  test("--help documents the flags and exits 0", () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    for (const flag of ["--input", "--output", "--model", "--resolution", "--no-refine", "--json", "--deadline-s"]) {
      expect(help.err + help.out).toContain(flag);
    }
    expect(help.err + help.out).toContain("light-2k");
  });

  test("missing arguments and a missing key die before any network I/O", () => {
    expect(runCli(["--output", join(workspace, "o.png")]).err).toContain("ERROR: --input is required");
    expect(runCli(["--input", sheet]).err).toContain("ERROR: --output is required");
    const noKey = runCli(["--input", sheet, "--output", join(workspace, "o.png")], { FAL_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY");
    const badModel = runCli(["--input", sheet, "--output", join(workspace, "o.png"), "--model", "best"]);
    expect(badModel.code).toBe(1);
    expect(badModel.err).toContain("--model");
  });
});
