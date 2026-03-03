/**
 * Base section — state variables, style constants, hover/select mechanics.
 * ES5-compatible JavaScript injected into slide iframes.
 *
 * Uses overlay divs (position:fixed, pointer-events:none) instead of modifying
 * target element styles, avoiding CSS compatibility issues.
 */
export const SECTION_BASE = `
  var active = false;
  var hovered = null;
  var selectedEl = null;
  var hoverOverlay = null;
  var selectOverlay = null;
  var HOVER_OUTLINE = '2px solid rgba(110, 168, 254, 0.6)';
  var SELECT_OUTLINE = '2px solid rgba(110, 168, 254, 0.9)';
  var SELECT_BG = 'rgba(110, 168, 254, 0.08)';
  var OUTLINE_RADIUS = '4px';

  function createOverlayDiv(rect, isSelect) {
    var div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.left = rect.left + 'px';
    div.style.top = rect.top + 'px';
    div.style.width = rect.width + 'px';
    div.style.height = rect.height + 'px';
    div.style.outline = isSelect ? SELECT_OUTLINE : HOVER_OUTLINE;
    div.style.outlineOffset = '2px';
    div.style.borderRadius = OUTLINE_RADIUS;
    if (isSelect) div.style.backgroundColor = SELECT_BG;
    div.style.pointerEvents = 'none';
    div.style.zIndex = '99999';
    div.setAttribute('data-pneuma-overlay', 'true');
    document.body.appendChild(div);
    return div;
  }

  function clearHover() {
    if (hoverOverlay) { hoverOverlay.remove(); hoverOverlay = null; }
    hovered = null;
  }

  function clearSelected() {
    if (selectOverlay) { selectOverlay.remove(); selectOverlay = null; }
    selectedEl = null;
  }

  function applySelectedStyle(el) {
    clearSelected();
    selectedEl = el;
    var rect = el.getBoundingClientRect();
    selectOverlay = createOverlayDiv(rect, true);
  }
`;
