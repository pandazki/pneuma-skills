import { describe, it, expect } from "bun:test";
import type { InitParam } from "../types/mode-manifest.js";

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
});
