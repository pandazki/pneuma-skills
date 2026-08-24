import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const viewer = readFileSync(
  join(import.meta.dir, "..", "viewer", "WordtastePreview.tsx"),
  "utf8",
);

describe("WordTaste viewer chrome", () => {
  it("does not let the control reset override component typography", () => {
    expect(viewer).not.toContain(
      ".wordtaste-v2 button, .wordtaste-v2 textarea, .wordtaste-v2 select { font: inherit; }",
    );
    expect(viewer).toContain(
      ".wordtaste-v2 button, .wordtaste-v2 textarea, .wordtaste-v2 select { font-family: inherit; }",
    );
  });

  it("keeps model-family readiness out of the reader-facing header", () => {
    expect(viewer).not.toContain("writing voices ready");
    expect(viewer).not.toContain("wordtaste-family-count");
  });

  it("light-dismisses the selection menu without swallowing its own actions", () => {
    expect(viewer).toContain(
      'document.addEventListener("pointerdown", handlePointerDown, true)',
    );
    expect(viewer).toContain("event.composedPath().includes(menu)");
    expect(viewer).toContain(
      'document.removeEventListener("pointerdown", handlePointerDown, true)',
    );
  });
});

describe("plan table chrome", () => {
  it("scrolls the units sideways inside its own container, never the page", () => {
    expect(viewer).toContain(".wordtaste-plan-scroll {\n  overflow-x: auto;");
    expect(viewer).toContain("overscroll-behavior-x: contain;");
    // The min-width is what makes the row stay a row: without it the table
    // squeezes its columns to fit and the span headings collapse to nothing.
    expect(viewer).toMatch(/\.wordtaste-plan-table \{[^}]*min-width: \d+px;/);
  });

  it("keeps the scrollable region reachable and named for a keyboard", () => {
    expect(viewer).toContain('className="wordtaste-plan-scroll"');
    expect(viewer).toContain('aria-labelledby="wordtaste-plan-heading"');
    expect(viewer).toContain("tabIndex={0}");
    expect(viewer).toContain(".wordtaste-plan-scroll:focus-visible");
  });

  it("offers no plan/prose view switch — the session either has a plan or it does not", () => {
    expect(viewer).not.toMatch(/prose view/i);
    expect(viewer).not.toMatch(/plan view/i);
    expect(viewer).toContain("plan ? (\n        <PlanUnits plan={plan} />");
  });

  it("carries no emoji in the plan surface", () => {
    expect(viewer).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("emphasis bounds", () => {
  it("bounds the marks against the claim list on screen, not the legacy thesis", () => {
    // A planned session lists `plan.claims`; a legacy one lists `layout.thesis`.
    // Bounding against `thesis.length` would clip a mark the user could see and
    // press the moment the two ever differ.
    expect(viewer).toContain(
      "workflow?.layout?.plan?.claims.length ?? workflow?.layout?.thesis.length ?? 0",
    );
    expect(viewer).toContain("normalizeEmphasis(next, claimCount)");
    expect(viewer).toContain("normalizeEmphasis(emphasis, claimCount)");
    expect(viewer).not.toContain("normalizeEmphasis(emphasis, workflow.layout?.thesis.length");
  });
});

// ── The reading surface: one token set, two value sets ───────────────────────

/**
 * The viewer component cannot be imported here — it pulls in
 * `katex/dist/katex.min.css`, which only a bundler resolves (same reason as
 * the rest of this file). The skin's *decisions* are unit-tested as pure logic
 * in `font-theme.test.ts`; what is left to pin is the stylesheet contract the
 * switch rides on, and that is a property of this file's text.
 */
const DARK_TOKENS = ".wordtaste-v2, .wordtaste-selection-menu";
const LIGHT_TOKENS =
  '.wordtaste-v2[data-skin="light"], .wordtaste-selection-menu[data-skin="light"]';

/** The `--wt-*` declarations inside one selector's block. */
function tokenDecls(selector: string): Map<string, string> {
  const start = viewer.indexOf(`\n${selector} {`);
  expect(start, `stylesheet block for ${selector}`).toBeGreaterThan(-1);
  const body = viewer.slice(start, viewer.indexOf("\n}", start));
  const decls = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--wt-[a-z-]+):\s*([^;]+);/g)) {
    decls.set(name, value.trim());
  }
  expect(decls.size, `token count for ${selector}`).toBeGreaterThan(0);
  return decls;
}

/** The stylesheet with both token blocks and all comments removed. */
function stylesWithoutTokenBlocks(): string {
  const styles = viewer.slice(viewer.indexOf("const STYLES = "));
  let rest = "";
  let cursor = 0;
  for (const selector of [DARK_TOKENS, LIGHT_TOKENS]) {
    const start = styles.indexOf(`\n${selector} {`);
    const end = styles.indexOf("\n}", start);
    rest += styles.slice(cursor, start);
    cursor = end;
  }
  rest += styles.slice(cursor);
  return rest.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("light / dark reading surface", () => {
  it("declares both surfaces on the studio root AND on the portaled menu", () => {
    // The selection menu renders through `createPortal(..., document.body)`,
    // so it inherits nothing from the studio root. If it is ever dropped from
    // these two selectors it silently keeps the dark palette on paper.
    expect(viewer).toContain(`\n${DARK_TOKENS} {`);
    expect(viewer).toContain(`\n${LIGHT_TOKENS} {`);
    expect(viewer).toContain('data-skin={skin}');
  });

  it("re-values every literal token in the light set — none may be forgotten", () => {
    const dark = tokenDecls(DARK_TOKENS);
    const light = tokenDecls(LIGHT_TOKENS);
    for (const [name, value] of dark) {
      // A token derived from another `--wt-*` follows the switch on its own.
      if (value.includes("var(--wt-")) continue;
      expect(light.has(name), `light surface must re-value ${name}`).toBe(true);
    }
    for (const name of light.keys()) {
      expect(dark.has(name), `${name} is light-only — the dark set needs it too`).toBe(
        true,
      );
    }
  });

  it("keeps the dark surface exactly as it shipped", () => {
    // Zero visual change for a user who never toggles. Half of these tokens
    // were literal colors sitting in individual rules before the skin axis;
    // each one was lifted to a token whose DARK value is the very literal it
    // replaced, which is what makes the lift a no-op on this surface. Pinning
    // the values is pinning that equivalence.
    const dark = tokenDecls(DARK_TOKENS);
    expect(dark.get("--wt-chrome")).toBe("var(--color-cc-bg, #09090b)");
    expect(dark.get("--wt-panel")).toBe("var(--color-cc-surface, #111113)");
    expect(dark.get("--wt-raised")).toBe("var(--color-cc-card, #18181b)");
    expect(dark.get("--wt-border")).toBe("var(--color-cc-border, #29292e)");
    expect(dark.get("--wt-ink")).toBe("var(--color-cc-fg, #f4f4f5)");
    expect(dark.get("--wt-muted")).toBe("var(--color-cc-muted, #a1a1aa)");
    expect(dark.get("--wt-accent")).toBe("var(--color-cc-primary, #f97316)");
    // Lifted out of rules, verbatim:
    expect(dark.get("--wt-accent-hover")).toBe("#fb923c"); // .wordtaste-primary:hover
    expect(dark.get("--wt-on-accent")).toBe("#111113"); // .wordtaste-primary color
    expect(dark.get("--wt-success-ink")).toBe("#a3e635"); // completed stage marker
    expect(dark.get("--wt-info")).toBe("#38bdf8"); // writing/review dot, progress, skeleton
    expect(dark.get("--wt-done")).toBe("#84cc16"); // final/distilled dot
    expect(dark.get("--wt-card-shadow")).toBe("0 18px 70px rgba(0,0,0,.18)"); // draft card
    expect(dark.get("--wt-menu-shadow")).toBe("0 18px 60px rgba(0,0,0,.5)"); // selection menu
  });

  it("paints the light surface on warm paper and warm ink — not white on black", () => {
    const light = tokenDecls(LIGHT_TOKENS);
    const channels = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    for (const name of ["--wt-chrome", "--wt-panel", "--wt-raised"]) {
      const [r, g, b] = channels(light.get(name)!);
      expect(r, `${name} is bright`).toBeGreaterThan(0xdd);
      expect(light.get(name), `${name} is not pure white`).not.toBe("#ffffff");
      // Warm: red leads, blue trails.
      expect(r, `${name} is warm`).toBeGreaterThan(b);
      expect(g, `${name} is warm`).toBeGreaterThan(b);
    }
    const [ir, , ib] = channels(light.get("--wt-ink")!);
    expect(ir, "ink is warm, not pure black").toBeGreaterThan(ib);
    expect(ir, "ink is dark").toBeLessThan(0x50);
  });

  it("leaves no dark-only color outside the token blocks", () => {
    // Every rule reads a token. A literal hex or rgba() anywhere else is a
    // color that was tuned for one surface and will be wrong on the other.
    let rest = stylesWithoutTokenBlocks();
    let previous = "";
    while (rest !== previous) {
      previous = rest;
      rest = rest.replace(/var\([^()]*\)/g, "");
    }
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/rgba?\(/);
  });

  it("declares every token the stylesheet reads", () => {
    const dark = tokenDecls(DARK_TOKENS);
    const styles = viewer.slice(viewer.indexOf("const STYLES = "));
    for (const [, name] of styles.matchAll(/var\((--wt-[a-z-]+)/g)) {
      expect(dark.has(name), `${name} is read but never declared`).toBe(true);
    }
  });
});

describe("the surface toggle", () => {
  it("sits in the header chrome as a labelled, pressable control", () => {
    expect(viewer).toContain('className="wordtaste-header-button wordtaste-skin-toggle"');
    expect(viewer).toContain("onClick={onToggleSkin}");
    expect(viewer).toContain('aria-pressed={skin === "light"}');
    expect(viewer).toContain("aria-label={skinLabel}");
    // A visible keyboard focus state already covers every button in the
    // studio; the toggle must stay inside that rule's reach.
    expect(viewer).toContain(".wordtaste-v2 button:focus-visible");
  });

  it("draws the surface it moves to, with an icon and never an emoji", () => {
    expect(viewer).toContain("{toLight ? <SunIcon /> : <MoonIcon />}");
    expect(viewer).toContain("function SunIcon()");
    expect(viewer).toContain("function MoonIcon()");
    expect(viewer).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("never speaks to the agent — pressing it is pure UI state", () => {
    // Viewer notifications are flushed to a live agent on idle and it acts on
    // them. Changing what the user is looking at must not enter that channel.
    const start = viewer.indexOf("const toggleSkin = useCallback(");
    expect(start).toBeGreaterThan(-1);
    // The whole declaration, however it is formatted: everything up to the
    // next top-level `const` in the component body.
    const body = viewer.slice(start, viewer.indexOf("\n  const ", start + 10));
    expect(body).toContain("setSkinChoice(otherSkin(skin))");
    expect(body).not.toContain("fireCommand");
    expect(body).not.toContain("onNotifyAgent");
    // ...and that pure handler is the one the button is actually given.
    expect(viewer).toContain("onToggleSkin={toggleSkin}");
  });

  it("touches Storage only through the guarded helpers", () => {
    // Every access has to carry the try/catch that keeps private mode and a
    // full quota from breaking the viewer — which lives in font-theme.ts.
    expect(viewer).not.toContain("localStorage");
    expect(viewer).toContain("readStoredSkin(skinKey)");
    expect(viewer).toContain("writeStoredSkin(skinKey");
  });

  it("syncs state and storage in one effect keyed on BOTH the key and the choice", () => {
    // `connect()` sets the session id, which can happen after this viewer
    // mounts — the storage key changes underneath it, so the key alone is not
    // enough and the choice alone would miss the late id. One writer, both
    // directions.
    expect(viewer).toContain("skinStorageKey(sessionId)");
    expect(viewer).toContain("}, [skinKey, skinChoice]);");
    const start = viewer.indexOf("useEffect(() => {\n    if (skinChoice) {");
    expect(start).toBeGreaterThan(-1);
    const body = viewer.slice(start, viewer.indexOf("}, [skinKey, skinChoice]);", start));
    expect(body).toContain("writeStoredSkin(skinKey, skinChoice)");
    expect(body).toContain("readStoredSkin(skinKey)");
  });
});
