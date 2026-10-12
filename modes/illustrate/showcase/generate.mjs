#!/usr/bin/env bun
/** Regenerate the artwork used by the showcase. Requires OPENROUTER_API_KEY. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { generateImage, loadEnvKeys, resolveImageModel, DEFAULT_IMAGE_MODEL, DEFAULT_EDIT_IMAGE_MODEL } from "../../_shared/scripts/generate_image.mjs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { model: { type: "string" }, help: { type: "boolean", short: "h" } },
  allowPositionals: true, strict: true,
});
if (values.help) {
  console.log("Usage: bun modes/illustrate/showcase/generate.mjs [output-dir] [--model flare|sunburst]");
  console.log("New images default to Flare through OpenRouter; --model sunburst upgrades them. The scarf edit always uses Sunburst.");
  process.exit(0);
}
if (positionals.length > 1) throw new Error("Expected at most one output directory");
const generationModel = resolveImageModel(values.model ?? DEFAULT_IMAGE_MODEL);
const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(positionals[0] ?? ".tmp-illustrate-showcase");
const prompts = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const apiKey = loadEnvKeys().OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY before generating showcase artwork");
mkdirSync(outputDir, { recursive: true });
const records = {};

async function generate(name, imageUrls = [], model = generationModel) {
  const result = await generateImage({
    apiKey, model, prompt: prompts[name], imageUrls, imageSize: "1024x1024",
    quality: "high", outputFormat: "png", outputDir, filenamePrefix: name,
  });
  records[name] = {
    model: result.model, endpoint: result.endpoint, prompt: prompts[name],
    file: result.files[0], sha256: createHash("sha256").update(readFileSync(result.files[0])).digest("hex"),
    input: imageUrls.length ? "editorial" : null, usage: result.usage,
  };
  writeFileSync(join(outputDir, "generation.json"), JSON.stringify(records, null, 2) + "\n");
  return result.files[0];
}

// Each independent concept gets a separate request; there are no automatic retries.
const settled = await Promise.allSettled(["editorial", "paper", "clay", "poster"].map((name) => generate(name)));
const failures = settled.filter((result) => result.status === "rejected");
if (failures.length) {
  for (const failure of failures) console.error(failure.reason);
  process.exitCode = 1;
} else {
  await generate("scarf-edit", [settled[0].value], DEFAULT_EDIT_IMAGE_MODEL);
  console.log(`Showcase artwork and generation.json saved in ${outputDir}`);
}
