import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { desktopPolicy } from "../src/main/build-policy.js";

describe("desktop build isolation", () => {
  test("release retains its identity, protocol registration, and updates", () => {
    for (const flag of [undefined, "0", "false"]) {
      expect(desktopPolicy(flag)).toEqual({
        appName: "Pneuma Skills",
        isolatedUserDataName: null,
        registerProtocol: true,
        updatesEnabled: true,
      });
    }
  });

  test("preview uses a separate identity and has no release integration", () => {
    const preview = desktopPolicy("1");
    const release = desktopPolicy(undefined);
    expect(preview.appName).not.toBe(release.appName);
    expect(preview).toEqual({
      appName: "Pneuma Skills Preview",
      isolatedUserDataName: "Pneuma Skills Preview",
      registerProtocol: false,
      updatesEnabled: false,
    });
  });

  test("the compiled preview retains isolation without a runtime environment flag", async () => {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../src/main/build-policy.ts")],
      target: "bun",
      define: { "process.env.PNEUMA_DESKTOP_PREVIEW": JSON.stringify("1") },
    });
    expect(result.success).toBe(true);
    const module = await import(`data:text/javascript;base64,${Buffer.from(await result.outputs[0]!.text()).toString("base64")}`);
    expect(module.desktopBuildPolicy).toEqual(desktopPolicy("1"));
  });
});
