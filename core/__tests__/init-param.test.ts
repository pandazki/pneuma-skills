import { describe, it, expect } from "bun:test";
import type {
  InitParam,
  InitParamOption,
  InitParamOptionsSource,
} from "../types/mode-manifest.js";

describe("InitParam", () => {
  it("accepts select type with string options", () => {
    const param: InitParam = {
      name: "paperSize",
      label: "Paper size",
      type: "select",
      options: ["A4", "A5", "Letter"],
      defaultValue: "A4",
    };
    expect(param.type).toBe("select");
    expect(param.options).toEqual(["A4", "A5", "Letter"]);
  });

  it("still accepts number type without options", () => {
    const param: InitParam = {
      name: "width",
      label: "Width",
      type: "number",
      defaultValue: 800,
    };
    expect(param.type).toBe("number");
    expect(param.options).toBeUndefined();
  });

  it("still accepts string type", () => {
    const param: InitParam = {
      name: "apiKey",
      label: "API key",
      type: "string",
      defaultValue: "",
      sensitive: true,
    };
    expect(param.type).toBe("string");
  });

  it("accepts rich options that say what a choice is, not only what it serializes to", () => {
    const param: InitParam = {
      name: "primerLibraries",
      label: "Primer libraries",
      type: "multi-select",
      options: [
        {
          value: "all",
          label: "Everything",
          description: "The bundled set plus every library on this machine",
          group: "Presets",
          exclusive: true,
        },
      ],
      defaultValue: "all",
    };
    const [option] = param.options as InitParamOption[];
    expect(option!.exclusive).toBe(true);
    expect(option!.group).toBe("Presets");
  });

  it("accepts a mixed list — bare strings alongside the object form", () => {
    const param: InitParam = {
      name: "mixed",
      label: "Mixed",
      type: "select",
      options: ["plain", { value: "rich", label: "Rich" }],
      defaultValue: "plain",
    };
    expect(param.options).toHaveLength(2);
  });

  it("accepts a parameter whose options are discovered at launch time", () => {
    // The manifest says what kind of thing to look for; it never looks.
    // Discovery lives in `core/init-param-resolver.ts`, so `manifest.ts` stays
    // free of both React and filesystem access.
    const source: InitParamOptionsSource = {
      kind: "directory-scan",
      roots: ["user-home", "project-root"],
      path: ".pneuma/primers",
      markerFile: "library.json",
      group: "Your libraries",
    };
    const param: InitParam = {
      name: "primerLibraries",
      label: "Primer libraries",
      type: "multi-select",
      options: [{ value: "all", exclusive: true }],
      optionsSource: source,
      defaultValue: "all",
    };
    expect(param.optionsSource?.kind).toBe("directory-scan");
    expect(param.optionsSource?.roots).toEqual(["user-home", "project-root"]);
  });

  it("leaves optionsSource undefined for every parameter that never asked for it", () => {
    const param: InitParam = {
      name: "slideWidth",
      label: "Slide width",
      type: "number",
      defaultValue: 1280,
    };
    expect(param.optionsSource).toBeUndefined();
  });
});
