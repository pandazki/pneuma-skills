/**
 * iframe-selection — Shared selection script builder for iframe-based viewers.
 *
 * Concatenates modular ES5-compatible script sections into a `<script>` tag
 * string for injection into slide (or other iframe-based) viewers.
 *
 * Mode-specific extensions (e.g. slide's checkContentFit) can be injected
 * via `options.extensions`.
 */

import { SECTION_BASE } from "./sections/base.js";
import { SECTION_FIND_ELEMENT } from "./sections/find-element.js";
import { SECTION_IDENTIFY } from "./sections/identify.js";
import { SECTION_CONTEXT } from "./sections/context.js";
import { SECTION_SELECTOR } from "./sections/selector.js";
import { SECTION_THUMBNAIL } from "./sections/thumbnail.js";
import { SECTION_CLASSIFY } from "./sections/classify.js";
import { SECTION_MESSAGE_HANDLER } from "./sections/message-handler.js";

export interface SelectionScriptOptions {
  /** Additional script sections to inject (mode-specific, e.g. checkContentFit handler) */
  extensions?: string[];
}

/**
 * Build the complete selection script for iframe injection.
 *
 * Returns a `<script>...</script>` string containing all selection logic:
 * state management, element finding, identification, context extraction,
 * CSS selector building, thumbnail capture, classification, and message handling.
 *
 * Extensions are injected between the message-handler's `window.addEventListener('message', ...)`
 * setup — specifically, they are placed before the message handler so they can define
 * additional message handlers that the main handler delegates to.
 */
export function buildSelectionScript(options?: SelectionScriptOptions): string {
  const sections = [
    SECTION_BASE,
    SECTION_FIND_ELEMENT,
    SECTION_IDENTIFY,
    SECTION_CONTEXT,
    SECTION_SELECTOR,
    SECTION_THUMBNAIL,
    SECTION_CLASSIFY,
    // Extensions go before message handler so they can define additional handlers
    ...(options?.extensions ?? []),
    SECTION_MESSAGE_HANDLER,
  ];

  return `<script>\n(function() {${sections.join("\n")}\n})();\n</script>`;
}
