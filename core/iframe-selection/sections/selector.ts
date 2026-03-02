/**
 * Selector section — buildSelector.
 * Builds a unique CSS selector path for an element.
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_SELECTOR = `
  /** Build a unique CSS selector path for an element */
  function buildSelector(el) {
    var parts = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      var part = tag;
      if (current.id) {
        part = tag + '#' + current.id;
        parts.unshift(part);
        break;
      }
      var cls = (typeof current.className === 'string' ? current.className : '').trim();
      if (cls) {
        // Use first 2 classes max to keep selector readable
        var classes = cls.split(/\\s+/).slice(0, 2).join('.');
        part = tag + '.' + classes;
      }
      // Add nth-child if there are siblings with same tag
      var parent = current.parentElement;
      if (parent) {
        var siblings = parent.children;
        var sameTag = 0, position = 0;
        for (var i = 0; i < siblings.length; i++) {
          if (siblings[i].tagName === current.tagName) {
            sameTag++;
            if (siblings[i] === current) position = sameTag;
          }
        }
        if (sameTag > 1) part += ':nth-child(' + (Array.prototype.indexOf.call(siblings, current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
`;
