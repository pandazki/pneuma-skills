/** @jsxImportSource react */
/**
 * The `multi-select` control on the launch sheet.
 *
 * Same happy-dom harness as `src/__tests__/app-settings-portal.test.tsx`. What
 * is pinned is what a user's clicks actually store, plus the two things that
 * would have made this a one-off patch instead of a control:
 *
 *   - it is NOT a native `<select>` (see `.claude/rules/frontend.md`: native
 *     form-control chrome is a defect in this UI), and
 *   - a `select` / `number` / `string` param renders exactly as it did before,
 *     so no existing mode's launch sheet moved.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { InitParamWithAutoFill } from "../InitParamForm.js";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(async () => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
  // `src/i18n/index.ts` reads its catalogue through Vite's `import.meta.glob`,
  // which does not exist outside the bundler; initialise the one namespace
  // this form reads from the same shipped file.
  const [{ default: i18n }, { initReactI18next }, { default: initParam }] = await Promise.all([
    import("i18next"),
    import("react-i18next"),
    import("../../i18n/locales/en/init-param.json"),
  ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { "init-param": initParam } },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => restore?.());

const LIBRARIES: InitParamWithAutoFill = {
  name: "primerLibraries",
  label: "Primer libraries",
  description: "the writing the writers read just before they write",
  type: "multi-select",
  options: [
    { value: "all", label: "Everything", description: "Bundled plus everything here", group: "Presets", exclusive: true },
    { value: "bundled", label: "Bundled only", group: "Presets", exclusive: true },
    { value: "amber-lib", label: "Amber Library", description: "Invented", group: "Your libraries" },
    { value: "basalt-lib", label: "Basalt Library", group: "Your libraries" },
  ],
  defaultValue: "all",
};

interface Mounted {
  chips(): HTMLElement[];
  chip(value: string): HTMLElement;
  click(value: string): Promise<void>;
  values(): Record<string, string | number>;
  host: HTMLElement;
  unmount(): Promise<void>;
}

async function mount(
  params: InitParamWithAutoFill[],
  initial?: Record<string, string | number>,
): Promise<Mounted> {
  const { act, createElement, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { InitParamForm } = await import("../InitParamForm.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const state = {
    values: initial ?? Object.fromEntries(params.map((p) => [p.name, p.defaultValue])),
  };

  function Harness() {
    const [values, setValues] = useState(state.values);
    state.values = values;
    return createElement(InitParamForm, { params, values, onChange: setValues });
  }

  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Harness));
  });

  const chips = () =>
    [...host.querySelectorAll('[role="checkbox"]')] as unknown as HTMLElement[];
  return {
    host,
    chips,
    chip: (value) => {
      const found = chips().find((el) => el.getAttribute("data-value") === value);
      if (!found) throw new Error(`no chip for ${value}`);
      return found;
    },
    click: async (value) => {
      const el = chips().find((c) => c.getAttribute("data-value") === value);
      if (!el) throw new Error(`no chip for ${value}`);
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    values: () => state.values,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("multi-select renders a real control, not native chrome", () => {
  test("renders one checkable chip per option — no <select> anywhere", async () => {
    mounted = await mount([LIBRARIES]);
    expect(mounted.chips().map((c) => c.getAttribute("data-value"))).toEqual([
      "all",
      "bundled",
      "amber-lib",
      "basalt-lib",
    ]);
    expect(mounted.host.querySelector("select")).toBeNull();
    expect(mounted.host.querySelector("input")).toBeNull();
  });

  test("shows each option's own name and blurb, so a library says what it is", async () => {
    mounted = await mount([LIBRARIES]);
    expect(mounted.chip("amber-lib").textContent).toContain("Amber Library");
    expect(mounted.chip("amber-lib").textContent).toContain("Invented");
    // The raw serialized value is never what the user reads.
    expect(mounted.chip("all").textContent).toContain("Everything");
  });

  test("makes the presets-vs-libraries distinction legible with group headings", async () => {
    mounted = await mount([LIBRARIES]);
    expect(mounted.host.textContent).toContain("Presets");
    expect(mounted.host.textContent).toContain("Your libraries");
  });

  test("the default selection is lit on first paint", async () => {
    mounted = await mount([LIBRARIES]);
    expect(mounted.chip("all").getAttribute("aria-checked")).toBe("true");
    expect(mounted.chip("bundled").getAttribute("aria-checked")).toBe("false");
  });
});

describe("what the clicks store", () => {
  test("picking libraries replaces the preset and stores a comma-separated list", async () => {
    mounted = await mount([LIBRARIES]);
    await mounted.click("basalt-lib");
    expect(mounted.values().primerLibraries).toBe("basalt-lib");
    await mounted.click("amber-lib");
    // Declared order, not click order.
    expect(mounted.values().primerLibraries).toBe("amber-lib,basalt-lib");
    expect(mounted.chip("all").getAttribute("aria-checked")).toBe("false");
  });

  test("a preset collapses the selection back to one word", async () => {
    mounted = await mount([LIBRARIES], { primerLibraries: "amber-lib,basalt-lib" });
    await mounted.click("bundled");
    expect(mounted.values().primerLibraries).toBe("bundled");
  });

  test("the selection never empties — a parameter has to answer something", async () => {
    mounted = await mount([LIBRARIES], { primerLibraries: "amber-lib" });
    await mounted.click("amber-lib");
    expect(mounted.values().primerLibraries).toBe("amber-lib");
  });

  test("a stored value no option matches stays visible instead of vanishing", async () => {
    // A library the user removed from disk since the session was configured.
    mounted = await mount([LIBRARIES], { primerLibraries: "ghost-lib" });
    const ghost = mounted.chip("ghost-lib");
    expect(ghost.getAttribute("aria-checked")).toBe("true");
    expect(mounted.host.textContent).toContain("Not found");
  });
});

describe("no regression for the params that did not change", () => {
  test("select still renders a <select> with one option per choice", async () => {
    const paperSize: InitParamWithAutoFill = {
      name: "paperSize",
      label: "Paper size",
      type: "select",
      options: ["A4", "A5", "Letter"],
      defaultValue: "A4",
    };
    mounted = await mount([paperSize]);
    const select = mounted.host.querySelector("select");
    expect(select).not.toBeNull();
    expect([...select!.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "A4",
      "A5",
      "Letter",
    ]);
    expect(mounted.chips()).toHaveLength(0);
  });

  test("number and password params still render their inputs", async () => {
    const params: InitParamWithAutoFill[] = [
      { name: "slideWidth", label: "Slide width", type: "number", defaultValue: 1280 },
      { name: "falApiKey", label: "fal.ai API Key", type: "string", defaultValue: "", sensitive: true },
    ];
    mounted = await mount(params);
    const inputs = [...mounted.host.querySelectorAll("input")];
    expect(inputs.map((i) => i.getAttribute("type"))).toEqual(["number", "password"]);
  });
});
