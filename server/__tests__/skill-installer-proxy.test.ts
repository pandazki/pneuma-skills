import { describe, test, expect } from "bun:test";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { generateProxySection } from "../skill-installer.js";

describe("generateProxySection", () => {
  test("returns empty string when proxy is undefined", () => {
    expect(generateProxySection(undefined)).toBe("");
  });

  test("outputs core docs for empty proxy config (mode opted in but no presets)", () => {
    const result = generateProxySection({});
    expect(result).toContain("### Proxy");
    expect(result).toContain("proxy.json");
    expect(result).not.toContain("Available proxies");
  });

  test("includes preset routes table when config has entries", () => {
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
    expect(result).toContain("Available proxies (from mode defaults)");
    expect(result).toContain("`github`");
    expect(result).toContain("https://api.github.com");
    expect(result).toContain("GitHub REST API");
    expect(result).toContain("`weather`");
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
