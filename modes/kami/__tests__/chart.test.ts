import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChartError,
  checkCharts,
  compareChart,
  findCharts,
  fmt,
  main,
  niceScale,
  renderChart,
} from "../skill/scripts/chart.mjs";

const DIAGRAMS_DIR = join(import.meta.dir, "..", "seed", "_shared", "assets", "diagrams");
const CHART_DEMOS = ["bar-chart", "line-chart", "donut-chart", "candlestick", "waterfall"];

// The five demos are upstream tw93/kami's own generated files (chart.py@210f3bc),
// copied unchanged apart from their header comment. Regenerating each from its
// embedded spec and landing on the same marks is the parity proof for the port:
// one drifted coordinate, rounding rule or font stack fails it.
describe("chart.mjs parity with upstream chart.py", () => {
  for (const name of CHART_DEMOS) {
    it(`${name}.html regenerates to upstream's marks`, () => {
      const charts = findCharts(readFileSync(join(DIAGRAMS_DIR, `${name}.html`), "utf8"));
      expect(charts.length).toBe(1);
      expect(compareChart(charts[0]!)).toBeNull();
    });
  }
});

describe("chart.mjs drift gate", () => {
  const spec = {
    type: "bar",
    categories: ["2022", "2023", "2024"],
    series: [{ name: "Revenue", values: [44, 60, 72] }],
  };

  it("passes a chart restyled at the root tag", () => {
    const svg = renderChart(spec).replace("<svg ", '<svg style="width:100%" ');
    expect(compareChart(svg)).toBeNull();
  });

  it("fails a hand-edited value label", () => {
    const svg = renderChart(spec).replace(">72<", ">80<");
    expect(compareChart(svg)).toMatch(/drawn mark \d+ differs from the spec/);
  });

  it("fails a bar whose height was retyped", () => {
    const svg = renderChart(spec);
    const edited = svg.replace(/(<rect x="[^"]+" y="[^"]+" width="[^"]+" height=")([^"]+)"/, '$1999"');
    expect(edited).not.toBe(svg);
    expect(compareChart(edited)).toMatch(/differs from the spec/);
  });

  it("fails a chart whose spec no longer parses", () => {
    const svg = renderChart(spec).replace(/data-kami-spec="[^"]*"/, 'data-kami-spec="{broken"');
    expect(compareChart(svg)).toMatch(/^embedded spec is invalid/);
  });

  it("reports per file through the CLI exit code", () => {
    const dir = mkdtempSync(join(tmpdir(), "kami-chart-"));
    const good = join(dir, "good.html");
    const bad = join(dir, "bad.html");
    writeFileSync(good, `<figure>${renderChart(spec)}</figure>`);
    writeFileSync(bad, `<figure>${renderChart(spec).replace(">60<", ">61<")}</figure>`);
    const lines: string[] = [];
    expect(checkCharts([good], (l) => lines.push(l))).toBe(0);
    expect(checkCharts([good, bad], (l) => lines.push(l))).toBe(1);
    expect(lines.some((l) => l.startsWith(`ERROR: ${bad}: chart 1 (bar)`))).toBe(true);
    expect(checkCharts([join(dir, "missing.html")], () => {})).toBe(2);
  });
});

describe("chart.mjs refuses data it cannot draw honestly", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["a candle outside its range", { type: "candlestick", points: [{ label: "D1", open: 10, high: 9, low: 8, close: 9 }] }, /do not contain open/],
    ["a waterfall total off its running sum", { type: "waterfall", items: [{ label: "s", value: 100, total: true }, { label: "a", value: 5 }, { label: "e", value: 90, total: true }] }, /does not equal the running sum/],
    ["a seventh donut share", { type: "donut", items: Array.from({ length: 7 }, (_, i) => ({ label: `c${i}`, value: 1 })) }, /use hbar for 7\+ shares/],
    ["a fourth bar series", { type: "bar", categories: ["a"], series: [1, 2, 3, 4].map((v) => ({ name: `s${v}`, values: [v] })) }, /4 series, at most 3/],
    ["a negative hbar value", { type: "hbar", items: [{ label: "a", value: -1 }] }, /zero or positive/],
    ["an unknown size", { type: "bar", size: "huge", categories: ["a"], series: [{ name: "x", values: [1] }] }, /size must be/],
    ["an unknown type", { type: "pie" }, /type must be one of/],
  ];
  for (const [what, spec, message] of cases) {
    it(what, () => {
      expect(() => renderChart(spec)).toThrow(ChartError);
      expect(() => renderChart(spec)).toThrow(message);
    });
  }
});

describe("chart.mjs number and language handling", () => {
  // Upstream formats through Python, which rounds exact binary ties to even.
  it("rounds exact ties to even, like Python", () => {
    expect(fmt(2.5, 0)).toBe("2");
    expect(fmt(3.5, 0)).toBe("4");
    expect(fmt(0.25, 1)).toBe("0.2");
    expect(fmt(1234567.891, 2, "$")).toBe("$1,234,567.89");
    expect(fmt(-0.004, 2)).toBe("0.00");
    expect(fmt(12, 0, "", "%", true)).toBe("+12%");
  });

  it("rounds an axis out to a 1/2/2.5/5 step", () => {
    expect(niceScale(0, 88, true)).toEqual([0, 100, 20]);
    expect(niceScale(116, 136, false)).toEqual([115, 140, 5]);
  });

  it("picks the font chain from the labels", () => {
    const cn = renderChart({ type: "hbar", items: [{ label: "华东", value: 3 }] });
    const ko = renderChart({ type: "hbar", items: [{ label: "서울", value: 3 }] });
    const en = renderChart({ type: "hbar", items: [{ label: "East", value: 3 }] });
    expect(cn).toInclude(`font-family="'TsangerJinKai02'`);
    expect(ko).toInclude(`font-family="'Source Han Serif K'`);
    expect(en).toInclude('font-family="Charter');
  });

  it("donut shares always sum to 100 at the shown precision", () => {
    const svg = renderChart({ type: "donut", items: [1, 1, 1].map((v, i) => ({ label: `c${i}`, value: v })) });
    const shares = [...svg.matchAll(/>(\d+)%</g)].slice(1).map((m) => Number(m[1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("chart.mjs CLI", () => {
  it("writes the SVG with -o and reports usage errors with exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "kami-chart-cli-"));
    const specPath = join(dir, "spec.json");
    const out = join(dir, "chart.svg");
    writeFileSync(specPath, JSON.stringify({ type: "line", categories: ["a", "b"], series: [{ name: "x", values: [1, 2] }] }));
    const lines: string[] = [];
    expect(main([specPath, "-o", out], (l) => lines.push(l))).toBe(0);
    expect(readFileSync(out, "utf8")).toStartWith("<svg ");
    expect(lines).toEqual([`OK: wrote ${out} (line)`]);
    expect(main([], () => {})).toBe(2);
    expect(main(["-o"], () => {})).toBe(2);
    writeFileSync(specPath, "{not json");
    expect(main([specPath], () => {})).toBe(2);
  });
});
