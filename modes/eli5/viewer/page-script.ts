/**
 * The script injected into every explainer page's iframe.
 *
 * Two jobs, both dormant until the parent asks:
 *
 *  1. the shared selection library (`core/iframe-selection`) — hover
 *     outline, click-to-pick, thumbnail, CSS-selector building — which is
 *     what turns a paragraph the reader points at into a
 *     `<viewer-context>` line the agent can act on;
 *  2. one eli5-specific handler: scroll to an anchor.
 *
 * The anchor handler exists because the page iframe is sandboxed with
 * `allow-scripts` only (slide's attributes). That gives the document an
 * OPAQUE origin, so the parent cannot reach into `contentDocument` to find
 * an element — `postMessage` is the only door, and it has to carry the
 * verdict back or a `navigate-to` that missed its anchor would look
 * exactly like one that landed.
 *
 * ES5, no template literals: this string is spliced into pages we do not
 * control and must parse everywhere the shared sections do.
 */

import { buildSelectionScript } from "../../../core/iframe-selection/index.js";

/** Message the parent sends to scroll a page to an anchor. */
export const SCROLL_TO_MESSAGE = "pneuma:eli5:scrollTo";
/** Message the page sends back, carrying whether the anchor resolved. */
export const SCROLL_RESULT_MESSAGE = "pneuma:eli5:scrollResult";

const ANCHOR_EXTENSION = `
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== '${SCROLL_TO_MESSAGE}') return;
    var requestId = e.data.requestId;
    var anchor = typeof e.data.anchor === 'string' ? e.data.anchor : '';
    var target = null;
    if (anchor) {
      // An anchor is an element id OR a CSS selector; try both, in the
      // order the skill documents them.
      try { target = document.getElementById(anchor.replace(/^#/, '')); } catch (ex) {}
      if (!target) { try { target = document.querySelector(anchor); } catch (ex) {} }
    }
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (ex) { target.scrollIntoView(true); }
    }
    window.parent.postMessage({
      type: '${SCROLL_RESULT_MESSAGE}',
      requestId: requestId,
      found: !!target
    }, '*');
  });
`;

/** Built once — the same string for every page, so srcdoc diffing stays cheap. */
export const PAGE_SCRIPT = buildSelectionScript({ extensions: [ANCHOR_EXTENSION] });
