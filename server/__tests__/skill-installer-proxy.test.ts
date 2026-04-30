import { describe, test, expect } from "bun:test";
import type { ProxyRoute } from "../../core/types/mode-manifest.js";
import { generateProxySection } from "../skill-installer.js";

describe("generateProxySection", () => {
  test("returns empty string when proxy is undefined", () => {
    expect(generateProxySection(undefined)).toBe("");
  });

  test("returns empty string for empty proxy config (no presets, no docs)", () => {
    // The new slim generator emits nothing when there are no presets — the
    // proxy-presets header only appears when concrete preconfigured routes
    // exist. Detailed proxy docs (proxy.json overrides etc.) live in the
    // mode's SKILL.md, not in CLAUDE.md.
    expect(generateProxySection({})).toBe("");
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
    expect(result).toContain("### Proxy presets");
    // Slim teaser uses fetch-style reminder + Name/Target table
    expect(result).toContain("fetch(\"/proxy/<name>/path\")");
    expect(result).toContain("`github`");
    expect(result).toContain("https://api.github.com");
    expect(result).toContain("`weather`");
    // Pointer to the mode's skill where deeper docs live (incl. proxy.json)
    expect(result).toContain("proxy.json");
    expect(result).toContain("mode's skill");
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
