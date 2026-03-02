/**
 * Find-element section — findMeaningfulElement.
 * Determines which element to select/highlight when the user clicks or hovers.
 *
 * Strategy (inspired by agentation):
 * - Any element is a valid target — no hardcoded selector whitelist
 * - Start from the click target and work upward
 * - Skip invisible/tiny elements and bare text wrappers
 * - Prefer semantic elements, but accept any element with visual presence
 *
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_FIND_ELEMENT = `
  // Semantic HTML elements — always a good selection target
  var SEMANTIC_RE = /^(h[1-6]|p|li|ul|ol|pre|code|blockquote|img|section|article|nav|aside|header|footer|main|table|thead|tbody|tr|td|th|figure|figcaption|details|summary|a|button|svg)$/i;

  // Minimum size to consider an element "visible enough" to select
  var MIN_SELECT_SIZE = 8;

  /**
   * Find the meaningful element to select for a given click/hover target.
   *
   * Unlike the previous closest(SEL) approach, this starts from the target
   * itself and walks up only when the element is too small or invisible.
   * This means ANY element with visual presence can be selected — images
   * inside plain divs, cards without semantic tags, icons, etc.
   */
  function findMeaningfulElement(target) {
    var el = target;

    // Skip text nodes — move to parent element
    if (el.nodeType === 3) el = el.parentElement;
    if (!el || el === document.body || el === document.documentElement) return null;

    // Skip script/style elements
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return null;

    // Walk up until we find an element with reasonable visual size
    while (el && el !== document.body && el !== document.documentElement) {
      // data-selectable is always a valid target
      if (el.hasAttribute && el.hasAttribute('data-selectable')) return el;

      var rect = el.getBoundingClientRect();

      // Semantic elements are always good targets (even if small — e.g. inline code)
      if (SEMANTIC_RE.test(el.tagName)) return el;

      // Element has visual size — use it
      if (rect.width >= MIN_SELECT_SIZE && rect.height >= MIN_SELECT_SIZE) {
        // But if it's very small (< 24px both axes), try to find a better parent
        if (rect.width < 24 && rect.height < 24) {
          var parent = el.parentElement;
          if (parent && parent !== document.body) {
            var pRect = parent.getBoundingClientRect();
            // Parent is meaningfully larger — prefer it
            if (pRect.width > rect.width * 1.5 || pRect.height > rect.height * 1.5) {
              el = parent;
              continue;
            }
          }
        }
        return el;
      }

      // Element too small/invisible — walk up
      el = el.parentElement;
    }

    return null;
  }
`;
