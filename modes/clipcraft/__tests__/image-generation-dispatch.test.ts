import { describe, expect, test } from "bun:test";
import { buildGenerationNotification } from "../viewer/generation/dispatchGeneration.js";
// The viewer cannot import the Node adapter, so it names the ids itself;
// these pins keep its copy equal to the adapter's defaults.
import { DEFAULT_EDIT_IMAGE_MODEL, DEFAULT_IMAGE_MODEL } from "../../_shared/scripts/generate_image.mjs";

function payload(notification: ReturnType<typeof buildGenerationNotification>) {
  return JSON.parse(notification.message.match(/```json\n([\s\S]*?)\n```/)![1]!);
}

describe("ClipCraft image model dispatch", () => {
  test("new images request Flare with the composition dimensions", () => {
    const result = payload(buildGenerationNotification({ mode: "create", params: { kind: "image", prompt: "A landscape", width: 1280, height: 720 } }));
    expect(result.provenance_hint.model).toBe("openai/gpt-image-2.6-flare");
    expect(result.provenance_hint.model).toBe(DEFAULT_IMAGE_MODEL);
    expect(result.script_args["--model"]).toBe(result.provenance_hint.model);
    expect(result.script_args["--image-size"]).toBe("1280x720");
    expect(result.script_args).not.toHaveProperty("--image-urls");
  });

  test("image variants pass their source as a Sunburst edit and preserve lineage", () => {
    const result = payload(buildGenerationNotification({ mode: "variant", params: { kind: "image", prompt: "A landscape", changeDirection: "Add snow" }, source: { id: "original", name: "Landscape", uri: "assets/landscape.png" } }));
    expect(result.provenance_hint.model).toBe("openai/gpt-image-2.6-sunburst");
    expect(result.provenance_hint.model).toBe(DEFAULT_EDIT_IMAGE_MODEL);
    expect(result.script_args["--model"]).toBe(result.provenance_hint.model);
    expect(result.provenance_hint.from_asset_id).toBe("original");
    expect(result.script_args["--image-urls"]).toBe("assets/landscape.png");
  });
});
