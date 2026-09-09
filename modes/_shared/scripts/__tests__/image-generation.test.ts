import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImageRequest, generateImage } from "../generate_image.mjs";
import { generateComposite } from "../storyboard.mjs";

const SUNBURST = "openai/gpt-image-2.5-sunburst";
const FLARE = "openai/gpt-image-2.5-flare";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");
const workspace = mkdtempSync(join(tmpdir(), "pneuma-image-test-"));
const reference = join(workspace, "reference.png");
writeFileSync(reference, PNG);
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const imageResponse = () => Response.json({ data: [{ b64_json: PNG.toString("base64"), media_type: "image/png" }], usage: { cost: 0.01 } });

// Run the real CLI after copying the exact shared files an installed skill needs.
// The preload intercepts all fetches, so this cannot reach a paid provider.
const installed = join(workspace, "skill", "scripts");
mkdirSync(installed, { recursive: true });
for (const script of ["generate_image.mjs", "edit_image.mjs", "storyboard.mjs"]) {
  copyFileSync(join(import.meta.dir, "..", script), join(installed, script));
}
copyFileSync(join(import.meta.dir, "..", "..", "..", "clipcraft", "skill", "scripts", "make-character-sheet.mjs"), join(installed, "make-character-sheet.mjs"));
const preload = join(workspace, "fetch-fixture.mjs");
writeFileSync(preload, `import { writeFileSync } from "node:fs";
globalThis.fetch = async (url, options) => {
  if (url !== "https://openrouter.ai/api/v1/images") throw new Error("Unexpected URL: " + url);
  writeFileSync(process.env.IMAGE_TEST_REQUEST, options.body);
  return Response.json({ data: [{ b64_json: ${JSON.stringify(PNG.toString("base64"))}, media_type: "image/png" }] });
};`);
let runId = 0;
function runCli(script: string, args: string[], withKey = true) {
  const request = join(workspace, `request-${++runId}.json`);
  const child = Bun.spawnSync([process.execPath, "--env-file=/dev/null", "--preload", preload, join(installed, script), ...args], {
    cwd: workspace,
    env: { PATH: process.env.PATH, OPENROUTER_API_KEY: withKey ? "fixture-key" : "", FAL_KEY: "fal-only", IMAGE_TEST_REQUEST: request },
    stdout: "pipe", stderr: "pipe",
  });
  return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString(), request: existsSync(request) ? JSON.parse(readFileSync(request, "utf8")) : null };
}

describe("GPT Image 2.5 Images API", () => {
  test("text generation sends Sunburst and decodes separate base64 outputs", async () => {
    let captured: { url: string; options: RequestInit } | undefined;
    const result = await generateImage({ apiKey: "fixture-key", prompt: "Two distinct pictures", numImages: 2, outputDir: workspace, filenamePrefix: "variants" }, {
      fetchImpl: async (url: string, options: RequestInit) => {
        captured = { url, options };
        return Response.json({ data: [{ b64_json: PNG.toString("base64") }, { b64_json: PNG.toString("base64") }], usage: { cost: 0.02 } });
      },
    });
    expect(captured!.url).toBe("https://openrouter.ai/api/v1/images");
    expect(captured!.options.headers).toMatchObject({ Authorization: "Bearer fixture-key" });
    expect(JSON.parse(captured!.options.body as string)).toEqual({ model: SUNBURST, prompt: "Two distinct pictures", n: 2, quality: "high", output_format: "png", aspect_ratio: "1:1" });
    expect(result.model).toBe(SUNBURST);
    expect(result.usage?.cost).toBe(0.02);
    expect(result.files).toEqual([join(workspace, "variants_1.png"), join(workspace, "variants_2.png")]);
    for (const path of result.files) expect(readFileSync(path)).toEqual(PNG);
  });

  test("reference edits select Flare, preserve image order and default to auto aspect", () => {
    const body = buildImageRequest({ prompt: "Change the sign", imageUrls: [reference, "https://example.com/style.png"] });
    expect(body.model).toBe(FLARE);
    expect(body.aspect_ratio).toBe("auto");
    expect(body.input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } },
      { type: "image_url", image_url: { url: "https://example.com/style.png" } },
    ]);
  });

  test("model overrides accept a short slug and explicit size excludes competing aspect", () => {
    const body = buildImageRequest({ prompt: "A portrait", model: "gpt-image-2.5-flare", quality: "xhigh", imageSize: "720x1280", aspectRatio: "1:1" });
    expect(body.model).toBe(FLARE);
    expect(body.quality).toBe("xhigh");
    expect(body.size).toBe("720x1280");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("resolution");
  });

  test("invalid masks, counts and unsupported models fail before a request", () => {
    expect(() => buildImageRequest({ prompt: "edit", imageUrls: [reference], maskUrl: reference })).toThrow("does not expose mask edits");
    expect(() => buildImageRequest({ prompt: "x", numImages: 1.5 })).toThrow("integer");
    expect(() => buildImageRequest({ prompt: "x", model: "unknown" })).toThrow("Invalid --model");
    expect(() => buildImageRequest({ prompt: "x", imageSize: "0x20" })).toThrow("Invalid --image-size");
  });

  test("an HTTP failure is reported once without creating output", async () => {
    let calls = 0;
    const outputDir = join(workspace, "failed");
    await expect(generateImage({ apiKey: "fixture-key", prompt: "x", outputDir }, {
      fetchImpl: async () => { calls++; return new Response("rate limit", { status: 429 }); },
    })).rejects.toThrow("429: rate limit");
    expect(calls).toBe(1);
    expect(existsSync(outputDir)).toBe(false);
  });

  test("empty and failed success responses cannot masquerade as generated files", async () => {
    for (const response of [{ data: [] }, { error: { message: "render failed" } }, { data: [{ b64_json: "" }] }]) {
      await expect(generateImage({ apiKey: "fixture-key", prompt: "x", outputDir: join(workspace, "empty") }, {
        fetchImpl: async () => Response.json(response),
      })).rejects.toThrow();
    }
    expect(existsSync(join(workspace, "empty"))).toBe(false);
  });

  test("actual response format determines the saved extension", async () => {
    const result = await generateImage({ apiKey: "fixture-key", prompt: "x", outputFormat: "jpeg", outputDir: workspace, filenamePrefix: "actual-format" }, { fetchImpl: async () => imageResponse() });
    expect(result.files[0]).toEndWith(".png");
    expect(readFileSync(result.files[0]!)).toEqual(PNG);
  });

  test("storyboard references share the Flare adapter and actual model metadata", async () => {
    let body: any;
    const result = await generateComposite({ apiKey: "fixture-key", finalPrompt: "Four panels", aspect: "16:9", refs: [reference], quality: "high", outputFormat: "png", outputDir: workspace }, {
      fetchImpl: async (_url: string, options: RequestInit) => { body = JSON.parse(options.body as string); return imageResponse(); },
    });
    expect(body.model).toBe(FLARE);
    expect(body.aspect_ratio).toBe("16:9");
    expect(result.model).toBe(FLARE);
    expect(result.compositeUrl).toBeNull();
    expect(readFileSync(result.compositePath)).toEqual(PNG);
  });
});

describe("installed image CLIs", () => {
  test("sketch generation defaults to Sunburst/low and respects explicit quality", () => {
    const args = ["A pencil tree", "--style", "sketch", "--output-dir", workspace];
    const low = runCli("generate_image.mjs", args);
    expect(low.code).toBe(0);
    expect(low.request.model).toBe(SUNBURST);
    expect(low.request.quality).toBe("low");
    expect(low.request.prompt).toContain("no shading, white background");
    expect(runCli("generate_image.mjs", [...args, "--quality", "max"]).request.quality).toBe("max");
  });

  test("annotation editing uses Flare and sends original then location guide", () => {
    const result = runCli("edit_image.mjs", ["Make the hat blue", "--input", reference, "--annotation", reference, "--output-dir", workspace]);
    expect(result.code).toBe(0);
    expect(result.request.model).toBe(FLARE);
    expect(result.request.aspect_ratio).toBe("auto");
    expect(result.request.input_references).toHaveLength(2);
    expect(result.request.prompt).toContain("Image 1 is the original");
    expect(result.request.prompt).toContain("Make the hat blue");
    expect(JSON.parse(result.out).model).toBe(FLARE);
  });

  test("character sheets use the installed Flare adapter and return the real output path", () => {
    const result = runCli("make-character-sheet.mjs", ["--source-url", reference, "--output", join(workspace, "character.jpg")]);
    expect(result.code).toBe(0);
    expect(result.request.model).toBe(FLARE);
    expect(result.request.input_references).toHaveLength(1);
    expect(result.out.trim()).toBe(join(workspace, "character.png"));
    expect(readFileSync(result.out.trim())).toEqual(PNG);
  });

  test("a fal-only configuration fails without issuing an image request", () => {
    const result = runCli("generate_image.mjs", ["A tree"], false);
    expect(result.code).toBe(1);
    expect(result.err).toContain("OPENROUTER_API_KEY not found");
    expect(result.request).toBeNull();
  });

  test("help succeeds, malformed counts and legacy flags are rejected before fetch", () => {
    expect(runCli("edit_image.mjs", ["--help"]).code).toBe(0);
    for (const args of [["x", "--num-images", "2junk"], ["x", "--resolution", "2K"], ["x", "--backend", "fal"]]) {
      const result = runCli("generate_image.mjs", args);
      expect(result.code).toBe(1);
      expect(result.request).toBeNull();
    }
  });
});
