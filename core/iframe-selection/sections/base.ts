/**
 * Base section — state variables, style constants, hover/select mechanics.
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_BASE = `
  var active = false;
  var hovered = null;
  var selectedEl = null;
  var HOVER_OUTLINE = '2px solid rgba(110, 168, 254, 0.6)';
  var SELECT_OUTLINE = '2px solid rgba(110, 168, 254, 0.9)';
  var SELECT_BG = 'rgba(110, 168, 254, 0.08)';
  var OUTLINE_RADIUS = '4px';

  function clearHover() {
    if (hovered && hovered !== selectedEl) {
      hovered.style.outline = '';
      hovered.style.outlineOffset = '';
      hovered.style.borderRadius = '';
    }
    hovered = null;
  }

  function clearSelected() {
    if (selectedEl) {
      selectedEl.style.outline = '';
      selectedEl.style.outlineOffset = '';
      selectedEl.style.borderRadius = '';
      selectedEl.style.backgroundColor = selectedEl._pneumaOrigBg || '';
      delete selectedEl._pneumaOrigBg;
      selectedEl = null;
    }
  }

  function applySelectedStyle(el) {
    clearSelected();
    selectedEl = el;
    el._pneumaOrigBg = el.style.backgroundColor || '';
    el.style.outline = SELECT_OUTLINE;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = OUTLINE_RADIUS;
    el.style.backgroundColor = SELECT_BG;
  }
`;
