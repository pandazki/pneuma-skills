/**
 * Identify section — identifyElement, getElementClasses.
 * Ported from agentation library, adapted to ES5 inline JS.
 * Provides semantic element naming (e.g. 'button "Submit"', 'h2 "Our Solution"').
 */
export const SECTION_IDENTIFY = `
  /**
   * Get CSS class names cleaned of module hashes.
   * E.g. "card_a8f3x" -> "card", deduped.
   */
  function getElementClasses(el) {
    var cn = el.className;
    if (typeof cn !== 'string' || !cn) return '';
    var parts = cn.split(/\\s+/);
    var seen = {};
    var result = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      // Strip CSS module hash suffix (e.g. card_a8f3x -> card)
      var match = parts[i].match(/^([a-zA-Z][a-zA-Z0-9_-]*?)(?:_[a-zA-Z0-9]{5,})?$/);
      var clean = match ? match[1] : parts[i];
      if (!seen[clean]) {
        seen[clean] = true;
        result.push(clean);
      }
    }
    return result.join(', ');
  }

  /**
   * Identify an element with a human-readable label.
   * Returns a string like 'button "Submit"', 'h2 "Our Solution"', 'image "logo"'.
   */
  function identifyElement(el) {
    // Check data-element attribute first (explicit labeling)
    if (el.dataset && el.dataset.element) return el.dataset.element;

    var tag = el.tagName.toLowerCase();

    // SVG elements
    if (tag === 'svg') {
      var svgParent = el.parentElement;
      if (svgParent && svgParent.tagName.toLowerCase() === 'button') {
        var btnText = (svgParent.textContent || '').trim();
        return btnText ? 'icon in "' + btnText.slice(0, 25) + '" button' : 'button icon';
      }
      return 'icon';
    }

    // Interactive elements
    if (tag === 'button') {
      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return 'button [' + ariaLabel + ']';
      var text = (el.textContent || '').trim();
      return text ? 'button "' + text.slice(0, 25) + '"' : 'button';
    }
    if (tag === 'a') {
      var linkText = (el.textContent || '').trim();
      var href = el.getAttribute('href');
      if (linkText) return 'link "' + linkText.slice(0, 25) + '"';
      if (href) return 'link to ' + href.slice(0, 30);
      return 'link';
    }
    if (tag === 'input') {
      var inputType = el.getAttribute('type') || 'text';
      var placeholder = el.getAttribute('placeholder');
      var name = el.getAttribute('name');
      if (placeholder) return 'input "' + placeholder + '"';
      if (name) return 'input [' + name + ']';
      return inputType + ' input';
    }

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      var hText = (el.textContent || '').trim();
      return hText ? tag + ' "' + hText.slice(0, 35) + '"' : tag;
    }

    // Text elements
    if (tag === 'p') {
      var pText = (el.textContent || '').trim();
      if (pText) return 'paragraph: "' + pText.slice(0, 40) + (pText.length > 40 ? '...' : '') + '"';
      return 'paragraph';
    }
    if (tag === 'span' || tag === 'label') {
      var sText = (el.textContent || '').trim();
      if (sText && sText.length < 40) return '"' + sText + '"';
      return tag;
    }
    if (tag === 'li') {
      var liText = (el.textContent || '').trim();
      if (liText && liText.length < 40) return 'list item: "' + liText.slice(0, 35) + '"';
      return 'list item';
    }
    if (tag === 'blockquote') return 'blockquote';
    if (tag === 'code') {
      var codeText = (el.textContent || '').trim();
      if (codeText && codeText.length < 30) return 'code: \`' + codeText + '\`';
      return 'code';
    }
    if (tag === 'pre') return 'code block';

    // Media
    if (tag === 'img') {
      var alt = el.getAttribute('alt');
      return alt ? 'image "' + alt.slice(0, 30) + '"' : 'image';
    }

    // Containers — try to infer meaningful name
    if (/^(div|section|article|nav|header|footer|aside|main)$/.test(tag)) {
      var role = el.getAttribute('role');
      var cAriaLabel = el.getAttribute('aria-label');
      if (cAriaLabel) return tag + ' [' + cAriaLabel + ']';
      if (role) return role;

      var classes = getElementClasses(el);
      if (classes) {
        // Use first 2 cleaned class names
        var words = classes.split(', ').slice(0, 2);
        if (words.length > 0) return words.join(' ');
      }
      return tag === 'div' ? 'container' : tag;
    }

    return tag;
  }
`;
