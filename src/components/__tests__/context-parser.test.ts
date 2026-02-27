/**
 * Tests for parseContextOutput — the /context visualization card parser.
 * Run: bun test src/components/__tests__/context-parser.test.ts
 */
import { describe, it, expect } from "bun:test";

// ── Inline the parser for unit testing ──────────────────────────────────────

interface ContextCategory {
  name: string;
  tokens: string;
  percent: number;
  type: "used" | "free" | "compacted";
}

interface ContextUsageData {
  model: string;
  usedTokens: string;
  totalTokens: string;
  overallPercent: number;
  categories: ContextCategory[];
}

function parseContextOutput(content: string): ContextUsageData | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  let model = "";
  let usedTokens = "";
  let totalTokens = "";
  let overallPercent = 0;

  for (const line of lines) {
    const m = line.match(/([\d,.]+k?)\s*\/\s*([\d,.]+k?)\s*(?:tokens?\s*)?\((\d+)%\)/i);
    if (m) {
      usedTokens = m[1];
      totalTokens = m[2];
      overallPercent = parseInt(m[3], 10);
      break;
    }
  }

  if (!usedTokens) return null;

  for (const line of lines) {
    const m = line.match(/\*{0,2}Model\*{0,2}[:\s]+\*{0,2}\s*([a-z][\w.-]+)/i);
    if (m) {
      model = m[1];
      break;
    }
  }

  const categories: ContextCategory[] = [];
  const tableRowRegex = /\|\s*(.+?)\s*\|\s*([\d,.]+k?)\s*\|\s*([\d.]+)%\s*\|?/;
  const bulletRegex = /([●○⊠▪▫◻■□•◦])\s*(.+?)\s+([\d,.]+k?)\s+([\d.]+)%/;
  const simpleRegex = /(.+?)\s{2,}([\d,.]+k?)\s+([\d.]+)%/;

  for (const line of lines) {
    if (line.match(/\|\s*-+/) || line.match(/\|\s*Category\s*\|/i)) continue;

    let match = line.match(tableRowRegex);
    if (match) {
      const name = match[1].replace(/\*\*/g, "").trim();
      if (!name || name.toLowerCase() === "category") continue;
      categories.push({
        name,
        tokens: match[2],
        percent: parseFloat(match[3]),
        type: name.toLowerCase().includes("free") ? "free"
          : name.toLowerCase().includes("compact") ? "compacted"
          : "used",
      });
      continue;
    }

    match = line.match(bulletRegex);
    if (match) {
      const marker = match[1];
      const name = match[2].trim();
      categories.push({
        name,
        tokens: match[3],
        percent: parseFloat(match[4]),
        type: marker === "○" || name.toLowerCase().includes("free") ? "free"
          : marker === "⊠" || name.toLowerCase().includes("compact") ? "compacted"
          : "used",
      });
      continue;
    }

    match = line.match(simpleRegex);
    if (match) {
      const name = match[1].replace(/^[^\w]+/, "").trim();
      if (!name) continue;
      categories.push({
        name,
        tokens: match[2],
        percent: parseFloat(match[3]),
        type: name.toLowerCase().includes("free") ? "free"
          : name.toLowerCase().includes("compact") ? "compacted"
          : "used",
      });
    }
  }

  return { model, usedTokens, totalTokens, overallPercent, categories };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("parseContextOutput", () => {
  it("parses markdown format (from screenshot)", () => {
    const content = `## Context Usage
**Model:** claude-opus-4-6
**Tokens:** 55.7k / 200k (28%)

## Estimated usage by category

| Category | Tokens | Percentage |
|---|---|---|
| System prompt | 3.8k | 1.9% |
| System tools | 20.2k | 10.1% |
| MCP tools | 5.8k | 2.9% |
| Custom agents | 49 | 0.0% |
| Memory files | 1.3k | 0.7% |
| Skills | 1k | 0.5% |
| Messages | 23.3k | 11.7% |
| Free space | 144.3k | 72.1% |`;

    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-opus-4-6");
    expect(result!.usedTokens).toBe("55.7k");
    expect(result!.totalTokens).toBe("200k");
    expect(result!.overallPercent).toBe(28);
    expect(result!.categories.length).toBeGreaterThanOrEqual(8);
    expect(result!.categories[0]).toEqual({
      name: "System prompt",
      tokens: "3.8k",
      percent: 1.9,
      type: "used",
    });
    // Free space should be tagged as "free"
    const freeSpace = result!.categories.find((c) => c.name === "Free space");
    expect(freeSpace).toBeDefined();
    expect(freeSpace!.type).toBe("free");
  });

  it("parses plain text format with tokens after fraction", () => {
    const content = `Context Usage
claude-opus-4-6
143,210 / 200,000 tokens (71%)
● System prompt     3,412   1.7%
● System tools     21,000  10.5%
● Messages        103,600  51.8%
○ Free space       24,000  11.8%
⊠ Autocompact      33,000  16.5%`;

    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.usedTokens).toBe("143,210");
    expect(result!.totalTokens).toBe("200,000");
    expect(result!.overallPercent).toBe(71);
    expect(result!.categories.length).toBe(5);

    const freeSpace = result!.categories.find((c) => c.name === "Free space");
    expect(freeSpace!.type).toBe("free");

    const autocompact = result!.categories.find((c) => c.name === "Autocompact");
    expect(autocompact!.type).toBe("compacted");
  });

  it("returns null for non-context content", () => {
    expect(parseContextOutput("hello world")).toBeNull();
    expect(parseContextOutput("some random output\nwith lines")).toBeNull();
  });

  it("handles content with no categories gracefully", () => {
    const content = `**Model:** claude-opus-4-6
**Tokens:** 10k / 200k (5%)`;
    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.overallPercent).toBe(5);
    expect(result!.categories).toEqual([]);
  });
});
