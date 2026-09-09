import { describe, expect, test } from "bun:test";
import { buildGenerationNotification } from "../viewer/generation/dispatchGeneration.js";

function payload(notification: ReturnType<typeof buildGenerationNotification>) {
  return JSON.parse(notification.message.match(/```json\n([\s\S]*?)\n```/)![1]!);
}

describe("ClipCraft image model dispatch", () => {
  test("new images request Sunburst with the composition dimensions", () => {
    const result = payload(buildGenerationNotification({ mode: "create", params: { kind: "image", prompt: "A landscape", width: 1280, height: 720 } }));
    expect(result.provenance_hint.model).toBe("openai/gpt-image-2.5-sunburst");
    expect(result.script_args["--image-size"]).toBe("1280x720");
    expect(result.script_args).not.toHaveProperty("--image-urls");
  });

  test("image variants pass their source as a Flare edit and preserve lineage", () => {
    const result = payload(buildGenerationNotification({ mode: "variant", params: { kind: "image", prompt: "A landscape", changeDirection: "Add snow" }, source: { id: "original", name: "Landscape", uri: "assets/landscape.png" } }));
    expect(result.provenance_hint.model).toBe("openai/gpt-image-2.5-flare");
    expect(result.provenance_hint.from_asset_id).toBe("original");
    expect(result.script_args["--image-urls"]).toBe("assets/landscape.png");
  });
});
