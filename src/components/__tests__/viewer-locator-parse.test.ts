/**
 * Viewer-locator chat-tag parse tests.
 *
 * A `<viewer-locator>` that reaches the user as raw text is a broken deep
 * link. The canonical form is `<viewer-locator label="..." address='{...}' />`,
 * but several mode skills (illustrate, draw, clipcraft) teach label-less
 * examples with a paired closing tag — and an agent following its own skill
 * verbatim must still get a card. These tests pin every accepted variant and
 * the label fallback derived from the address values.
 */

import { describe, expect, test } from "bun:test";
import { parseViewerLocators } from "../viewer-locator-parse.js";

describe("parseViewerLocators — accepted tag variants", () => {
  test("canonical: label + self-closing", () => {
    const { cleanText, locators } = parseViewerLocators(
      `Done. <viewer-locator label="Slide 3" address='{"slide":3}' />`,
    );
    expect(locators).toEqual([{ label: "Slide 3", address: { slide: 3 } }]);
    expect(cleanText).toBe("Done.");
  });

  test("label-less + paired closing tag (illustrate skill form)", () => {
    const { cleanText, locators } = parseViewerLocators(
      `<viewer-locator address='{"contentSet":"panda-logo"}'></viewer-locator>`,
    );
    expect(locators).toHaveLength(1);
    expect(locators[0].address).toEqual({ contentSet: "panda-logo" });
    expect(locators[0].label).toBe("panda-logo");
    expect(cleanText).toBe("");
  });

  test("label-less multi-key address derives a joined fallback label", () => {
    const { locators } = parseViewerLocators(
      `<viewer-locator address='{"contentSet":"panda-logo","rowId":"row-1787194864187"}'></viewer-locator>`,
    );
    expect(locators[0].label).toBe("panda-logo · row-1787194864187");
  });

  test("label + paired closing tag", () => {
    const { locators } = parseViewerLocators(
      `<viewer-locator label="Open the batch" address='{"rowId":"row-1"}'></viewer-locator>`,
    );
    expect(locators).toEqual([{ label: "Open the batch", address: { rowId: "row-1" } }]);
  });

  test("label-less self-closing", () => {
    const { locators } = parseViewerLocators(
      `<viewer-locator address='{"file":"images/hero.png"}' />`,
    );
    expect(locators[0].label).toBe("images/hero.png");
  });

  test("legacy data= attribute still parses", () => {
    const { locators } = parseViewerLocators(
      `<viewer-locator label="Old card" data='{"page":"about.html"}' />`,
    );
    expect(locators).toEqual([{ label: "Old card", address: { page: "about.html" } }]);
  });

  test("malformed JSON is skipped, surrounding text survives", () => {
    const { cleanText, locators } = parseViewerLocators(
      `Before <viewer-locator address='{not json}' /> after`,
    );
    expect(locators).toHaveLength(0);
    expect(cleanText).toContain("Before");
    expect(cleanText).toContain("after");
  });

  test("multiple tags in one message all parse", () => {
    const { locators } = parseViewerLocators(
      `A <viewer-locator label="One" address='{"slide":1}' /> B ` +
        `<viewer-locator address='{"slide":2}'></viewer-locator>`,
    );
    expect(locators.map((l) => l.label)).toEqual(["One", "2"]);
  });
});
