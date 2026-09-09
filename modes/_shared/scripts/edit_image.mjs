#!/usr/bin/env node
/** Edit a local image with GPT Image 2.5, optionally guided by a highlighter annotation. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_EDIT_IMAGE_MODEL, IMAGE_MODELS, IMAGE_ASPECTS, IMAGE_BACKGROUNDS, IMAGE_QUALITIES, generateImage, loadEnvKeys } from "./generate_image.mjs";

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, options: {
    input: { type: "string", short: "i" },
    annotation: { type: "string", short: "a" },
    model: { type: "string", default: DEFAULT_EDIT_IMAGE_MODEL },
    "aspect-ratio": { type: "string", default: "auto" },
    "image-size": { type: "string" },
    quality: { type: "string", default: "high" },
    "output-format": { type: "string", default: "png" },
    background: { type: "string" },
    "output-dir": { type: "string", default: "." },
    "filename-prefix": { type: "string", default: "edited" },
    help: { type: "boolean", short: "h" },
  }, allowPositionals: true });
  if (values.help) {
    console.error(`Usage: edit_image.mjs <modification prompt> --input <image> [options]

  --input, -i <path>          Original image to modify
  --annotation, -a <path>     Highlighter region crop (second reference image)
  --model <name>             ${IMAGE_MODELS.join(", ")} (openai/ prefix optional)
  --aspect-ratio <ratio>     ${IMAGE_ASPECTS.join(", ")} (default: auto)
  --image-size <preset|WxH>  Explicit output size
  --quality <level>         ${IMAGE_QUALITIES.join(", ")} (default: high)
  --output-format <fmt>     png, jpeg, webp (default: png)
  --background <mode>       ${IMAGE_BACKGROUNDS.join(", ")} (omitted unless passed)
                            transparent requires --output-format png or webp
  --output-dir <path>       Output directory (default: .)
  --filename-prefix <name>  Filename prefix (default: edited)

Default: ${DEFAULT_EDIT_IMAGE_MODEL}. Requires OPENROUTER_API_KEY.
Annotations are visual guides, not pixel masks. For multiple references use generate_image.mjs --image-urls.`);
    return;
  }
  if (positionals.length !== 1 || !values.input) throw new Error("Usage: edit_image.mjs <modification prompt> --input <image> [options]");
  const imageUrls = [values.input];
  let prompt = positionals[0];
  if (values.annotation) {
    imageUrls.push(values.annotation);
    prompt = `Image 1 is the original to edit. Image 2 is a highlighter annotation or crop identifying the area to change; use it only as a location guide and do not reproduce the annotation marks. Preserve everything outside the requested change.\n\n${prompt}`;
  }
  const result = await generateImage({
    apiKey: loadEnvKeys().OPENROUTER_API_KEY, prompt, imageUrls,
    model: values.model, aspectRatio: values["aspect-ratio"], imageSize: values["image-size"],
    quality: values.quality, outputFormat: values["output-format"], background: values.background,
    outputDir: values["output-dir"], filenamePrefix: values["filename-prefix"],
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main ?? (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
