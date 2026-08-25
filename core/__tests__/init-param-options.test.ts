/**
 * The selection algebra a `multi-select` init parameter runs on.
 *
 * What is pinned here is mostly the *wire format*: the launcher form and the
 * interactive CLI both call these functions, and whatever they produce lands
 * verbatim in `<stateDir>/config.json`, where mode scripts parse it. WordTaste's
 * `primerLibraries` has read `all` / `bundled` / `a,b` since it was a free-text
 * box; that string is a contract with
 * `modes/wordtaste/skill/scripts/lib/session.ts::primerSelection`, not an
 * implementation detail of the control that produces it.
 */
import { describe, expect, it } from "bun:test";
import type { InitParamOption } from "../types/mode-manifest.js";
import {
  INIT_PARAM_MULTI_SEPARATOR,
  groupInitParamOptions,
  initParamOptionLabel,
  normalizeInitParamOptions,
  orderInitParamSelection,
  parseInitParamSelection,
  serializeInitParamSelection,
  toggleInitParamSelection,
  visibleInitParamOptions,
} from "../init-param-options.js";

/** The wordtaste option list, presets first, two discovered libraries after. */
const OPTIONS: InitParamOption[] = [
  { value: "all", label: "Everything", group: "Presets", exclusive: true },
  { value: "bundled", label: "Bundled only", group: "Presets", exclusive: true },
  { value: "alpha", label: "Alpha Notes", group: "Your libraries" },
  { value: "beta", label: "Beta Clippings", group: "Your libraries" },
];

describe("normalizeInitParamOptions", () => {
  it("widens the bare-string shorthand every existing manifest uses", () => {
    expect(normalizeInitParamOptions(["A4", "A5", "Letter"])).toEqual([
      { value: "A4" },
      { value: "A5" },
      { value: "Letter" },
    ]);
  });

  it("keeps object options as declared and accepts a mixed list", () => {
    expect(normalizeInitParamOptions(["all", { value: "alpha", label: "Alpha" }])).toEqual([
      { value: "all" },
      { value: "alpha", label: "Alpha" },
    ]);
  });

  it("drops empty and duplicate values — a repeated value makes a set ambiguous", () => {
    expect(normalizeInitParamOptions(["a", "", "a", { value: "a", label: "again" }])).toEqual([
      { value: "a" },
    ]);
    expect(normalizeInitParamOptions(undefined)).toEqual([]);
  });

  it("labels fall back to the serialized value", () => {
    expect(initParamOptionLabel({ value: "alpha" })).toBe("alpha");
    expect(initParamOptionLabel({ value: "alpha", label: "Alpha Notes" })).toBe("Alpha Notes");
  });
});

describe("wire format", () => {
  it("serializes as comma-joined values — the format a text box already produced", () => {
    expect(INIT_PARAM_MULTI_SEPARATOR).toBe(",");
    expect(serializeInitParamSelection(["all"])).toBe("all");
    expect(serializeInitParamSelection(["bundled"])).toBe("bundled");
    expect(serializeInitParamSelection(["alpha", "beta"])).toBe("alpha,beta");
  });

  it("round-trips every value wordtaste's session.ts knows how to parse", () => {
    for (const stored of ["all", "bundled", "alpha", "alpha,beta"]) {
      expect(serializeInitParamSelection(parseInitParamSelection(stored))).toBe(stored);
    }
  });

  it("emits no spaces — session.ts strips them, but the bytes on disk are the contract", () => {
    expect(serializeInitParamSelection(["alpha", "beta", "gamma"])).toBe("alpha,beta,gamma");
  });

  it("tolerates a hand-edited config with spaces and blanks", () => {
    expect(parseInitParamSelection(" alpha ,  beta ,, ")).toEqual(["alpha", "beta"]);
    expect(parseInitParamSelection("")).toEqual([]);
    expect(parseInitParamSelection(undefined)).toEqual([]);
    expect(parseInitParamSelection(null)).toEqual([]);
  });

  it("orders by declaration, so the same set always produces the same bytes", () => {
    const clickedBackwards = orderInitParamSelection(OPTIONS, ["beta", "alpha"]);
    expect(serializeInitParamSelection(clickedBackwards)).toBe("alpha,beta");
    expect(serializeInitParamSelection(orderInitParamSelection(OPTIONS, ["alpha", "beta"]))).toBe(
      "alpha,beta",
    );
  });

  it("keeps a value no option matches rather than dropping it silently", () => {
    expect(orderInitParamSelection(OPTIONS, ["ghost", "alpha"])).toEqual(["alpha", "ghost"]);
  });
});

describe("toggleInitParamSelection", () => {
  it("an exclusive preset collapses the selection to itself", () => {
    expect(toggleInitParamSelection(OPTIONS, ["alpha", "beta"], "all")).toEqual(["all"]);
    expect(toggleInitParamSelection(OPTIONS, ["all"], "bundled")).toEqual(["bundled"]);
  });

  it("picking a library drops the preset — 'all plus this one' is not expressible", () => {
    expect(toggleInitParamSelection(OPTIONS, ["all"], "beta")).toEqual(["beta"]);
    expect(toggleInitParamSelection(OPTIONS, ["beta"], "alpha")).toEqual(["alpha", "beta"]);
  });

  it("re-picking a selected library removes it", () => {
    expect(toggleInitParamSelection(OPTIONS, ["alpha", "beta"], "alpha")).toEqual(["beta"]);
  });

  it("never empties the selection — a parameter has to answer something", () => {
    expect(toggleInitParamSelection(OPTIONS, ["alpha"], "alpha")).toEqual(["alpha"]);
    expect(toggleInitParamSelection(OPTIONS, ["all"], "all")).toEqual(["all"]);
  });

  it("the default value survives a full click cycle back to itself", () => {
    let selection = parseInitParamSelection("all");
    selection = toggleInitParamSelection(OPTIONS, selection, "alpha");
    selection = toggleInitParamSelection(OPTIONS, selection, "beta");
    expect(serializeInitParamSelection(selection)).toBe("alpha,beta");
    selection = toggleInitParamSelection(OPTIONS, selection, "all");
    expect(serializeInitParamSelection(selection)).toBe("all");
  });
});

describe("the CLI reduces clack's answer through the same algebra", () => {
  // `bin/pneuma.ts::promptInitParams` folds the array clack hands back through
  // `toggleInitParamSelection`, starting empty. That is what makes the CLI and
  // the launcher chips write identical bytes — clack's list has no notion of
  // an exclusive option, so the fold is where "all + a library" gets resolved.
  const fold = (answer: string[]): string =>
    serializeInitParamSelection(
      answer.reduce<string[]>((acc, value) => toggleInitParamSelection(OPTIONS, acc, value), []),
    );

  it("a lone preset stays a lone preset", () => {
    expect(fold(["all"])).toBe("all");
    expect(fold(["bundled"])).toBe("bundled");
  });

  it("several libraries serialize in declared order", () => {
    expect(fold(["beta", "alpha"])).toBe("alpha,beta");
  });

  it("a preset ticked alongside libraries resolves the same way a click would", () => {
    expect(fold(["all", "alpha"])).toBe("alpha");
    expect(fold(["alpha", "all"])).toBe("all");
  });

  it("an empty answer serializes to nothing, which the caller replaces with the default", () => {
    expect(fold([])).toBe("");
  });
});

describe("presentation helpers", () => {
  it("groups options with ungrouped first and groups in first-seen order", () => {
    const grouped = groupInitParamOptions([
      { value: "loose" },
      { value: "all", group: "Presets" },
      { value: "alpha", group: "Your libraries" },
      { value: "bundled", group: "Presets" },
    ]);
    expect(grouped.map((g) => g.group)).toEqual([undefined, "Presets", "Your libraries"]);
    expect(grouped[1]!.options.map((o) => o.value)).toEqual(["all", "bundled"]);
  });

  it("surfaces a selected value no option matches, so a stale pick stays visible", () => {
    const visible = visibleInitParamOptions(OPTIONS, ["ghost"], "Not found");
    expect(visible.at(-1)).toEqual({ value: "ghost", group: "Not found" });
    expect(visibleInitParamOptions(OPTIONS, ["alpha"])).toHaveLength(OPTIONS.length);
  });
});
