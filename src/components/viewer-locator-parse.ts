/**
 * `<viewer-locator>` chat-tag parsing — pure, DOM-free, imported by
 * MessageBubble and unit tests alike.
 *
 * The canonical form is `<viewer-locator label="..." address='{...}' />`, but
 * every documented variant must render as a card — a tag that reaches the
 * user as raw text is a broken deep link. Accepted variants: `label` is
 * optional (several mode skills teach label-less examples; the card then
 * derives its text from the address values), the closing may be self-closing
 * OR a paired `></viewer-locator>`, and `data='{...}'` is accepted so locator
 * cards in resumed sessions (history written before the ViewerAddress
 * contract) keep rendering.
 */

import type { ViewerLocator } from "../../core/types/viewer-contract.js";

const LOCATOR_RE =
  /<viewer-locator\s+(?:label="([^"]*)"\s+)?(?:address|data)='([^']+)'\s*(?:\/>|>\s*<\/viewer-locator>)/g;

function locatorFallbackLabel(address: Record<string, unknown>): string {
  const parts = Object.values(address).filter(
    (v): v is string | number => typeof v === "string" || typeof v === "number",
  );
  return parts.length ? parts.join(" · ") : "View";
}

export function parseViewerLocators(text: string): {
  cleanText: string;
  locators: ViewerLocator[];
} {
  const locators: ViewerLocator[] = [];
  for (const match of text.matchAll(LOCATOR_RE)) {
    try {
      const address = JSON.parse(match[2]);
      locators.push({ label: match[1] || locatorFallbackLabel(address), address });
    } catch {
      /* skip malformed */
    }
  }
  return { cleanText: text.replace(LOCATOR_RE, "").trim(), locators };
}

/**
 * Strip locator tags (both closing forms) so they don't render as raw HTML
 * while an assistant message is still streaming.
 */
export function stripViewerLocatorTags(text: string): string {
  return text.replace(/<viewer-locator\s[^>]*(?:\/>|>\s*<\/viewer-locator>)/g, "");
}
