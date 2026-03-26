import { describe, test, expect } from "bun:test";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { generateProxySection } from "../skill-installer.js";

describe("generateProxySection", () => {
  test("returns empty string when no proxy config", () => {
    expect(generateProxySection(undefined)).toBe("");
  });

  test("returns empty string for empty proxy config", () => {
    expect(generateProxySection({})).toBe("");
  });

  test("generates markdown table for proxy routes", () => {
    const proxy: Record<string, ProxyRoute> = {
      github: {
        target: "https://api.github.com",
        description: "GitHub REST API",
      },
      weather: {
        target: "https://wttr.in",
        description: "Weather data",
      },
    };
    const result = generateProxySection(proxy);
    expect(result).toContain("### Proxy");
    expect(result).toContain("`github`");
    expect(result).toContain("https://api.github.com");
    expect(result).toContain("GitHub REST API");
    expect(result).toContain("`weather`");
    expect(result).toContain("/proxy/<name>/<path>");
    expect(result).toContain("proxy.json");
  });

  test("handles routes without description", () => {
    const proxy: Record<string, ProxyRoute> = {
      api: { target: "https://api.example.com" },
    };
    const result = generateProxySection(proxy);
    expect(result).toContain("`api`");
    expect(result).toContain("https://api.example.com");
  });
});
