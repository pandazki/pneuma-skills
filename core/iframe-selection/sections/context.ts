/**
 * Context section — getNearbyText, getAccessibilityInfo.
 * Ported from agentation library, adapted to ES5 inline JS.
 * Provides sibling text context and accessibility info for agent understanding.
 */
export const SECTION_CONTEXT = `
  /**
   * Get text content from element and siblings for context.
   * Returns a string like '[before: "The Challenge"] Our Solution [after: "Key Benefits"]'.
   */
  function getNearbyText(el) {
    var texts = [];

    // Own text (skip if too long)
    var ownText = (el.textContent || '').trim();
    if (ownText && ownText.length < 100) {
      texts.push(ownText);
    }

    // Previous sibling text
    var prev = el.previousElementSibling;
    if (prev) {
      var prevText = (prev.textContent || '').trim();
      if (prevText && prevText.length < 50) {
        texts.unshift('[before: "' + prevText.slice(0, 40) + '"]');
      }
    }

    // Next sibling text
    var next = el.nextElementSibling;
    if (next) {
      var nextText = (next.textContent || '').trim();
      if (nextText && nextText.length < 50) {
        texts.push('[after: "' + nextText.slice(0, 40) + '"]');
      }
    }

    return texts.join(' ');
  }

  /**
   * Get accessibility information for an element.
   * Returns a string like 'role="heading", focusable'.
   */
  function getAccessibilityInfo(el) {
    var parts = [];

    var role = el.getAttribute('role');
    var ariaLabel = el.getAttribute('aria-label');
    var ariaDescribedBy = el.getAttribute('aria-describedby');
    var tabIndex = el.getAttribute('tabindex');
    var ariaHidden = el.getAttribute('aria-hidden');

    if (role) parts.push('role="' + role + '"');
    if (ariaLabel) parts.push('aria-label="' + ariaLabel + '"');
    if (ariaDescribedBy) parts.push('aria-describedby="' + ariaDescribedBy + '"');
    if (tabIndex) parts.push('tabindex=' + tabIndex);
    if (ariaHidden === 'true') parts.push('aria-hidden');

    // Check focusability
    var focusable = el.matches('a, button, input, select, textarea, [tabindex]');
    if (focusable) parts.push('focusable');

    return parts.join(', ');
  }
`;
