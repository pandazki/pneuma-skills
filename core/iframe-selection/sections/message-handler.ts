/**
 * Message-handler section — postMessage listener, click/hover/mouseout handlers.
 * Wires up the selection interaction and message protocol.
 * ES5-compatible JavaScript injected into slide iframes.
 *
 * Depends on all other sections being loaded first (uses their functions).
 */
export const SECTION_MESSAGE_HANDLER = `
  window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'pneuma:selectMode') {
      active = !!e.data.enabled;
      document.body.style.cursor = active ? 'crosshair' : '';
      if (!active) {
        clearHover();
        clearSelected();
      }
    }
    if (e.data.type === 'pneuma:highlight') {
      try {
        var target = document.querySelector(e.data.selector);
        if (target) {
          // Skip scrollIntoView if this element is already selected by the user's click
          // (avoids scroll flash when parent echoes back the selection as a highlight)
          var alreadySelected = (target === selectedEl);
          applySelectedStyle(target);
          if (!alreadySelected) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } catch(ex) {}
    }
    if (e.data.type === 'pneuma:highlightMultiple') {
      // Clear previous annotation highlights
      var prev = document.querySelectorAll('[data-pneuma-annotated]');
      for (var pi = 0; pi < prev.length; pi++) {
        prev[pi].style.outline = '';
        prev[pi].style.outlineOffset = '';
        prev[pi].style.borderRadius = '';
        prev[pi].removeAttribute('data-pneuma-annotated');
      }
      // Highlight each selector
      var selectors = e.data.selectors || [];
      for (var ai = 0; ai < selectors.length; ai++) {
        try {
          var ael = document.querySelector(selectors[ai]);
          if (ael) {
            ael.setAttribute('data-pneuma-annotated', 'true');
            ael.style.outline = SELECT_OUTLINE;
            ael.style.outlineOffset = '2px';
            ael.style.borderRadius = OUTLINE_RADIUS;
          }
        } catch(ex) {}
      }
    }
    if (e.data.type === 'pneuma:clearHighlight') {
      clearSelected();
      // Also clear annotation highlights
      var annotated = document.querySelectorAll('[data-pneuma-annotated]');
      for (var ci = 0; ci < annotated.length; ci++) {
        annotated[ci].style.outline = '';
        annotated[ci].style.outlineOffset = '';
        annotated[ci].style.borderRadius = '';
        annotated[ci].removeAttribute('data-pneuma-annotated');
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!active) return;
    var el = findMeaningfulElement(e.target);
    if (!el) return;
    if (hovered && hovered !== el) clearHover();
    if (el === selectedEl) return;
    hovered = el;
    el.style.outline = HOVER_OUTLINE;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = OUTLINE_RADIUS;
  });

  document.addEventListener('mouseout', function(e) {
    if (!active) return;
    clearHover();
  });

  document.addEventListener('click', function(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    var el = findMeaningfulElement(e.target);
    if (!el) {
      clearSelected();
      window.parent.postMessage({ type: 'pneuma:select', selection: null }, '*');
      return;
    }

    // Strip any hover/prior-selection outline before capturing thumbnail
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.borderRadius = '';

    // Capture thumbnail with clean styles (no blue outline in preview)
    var thumbnail = captureElementThumbnail(el);

    applySelectedStyle(el);

    var tag = el.tagName.toLowerCase();
    var info = classifyElement(el);
    var classes = (typeof el.className === 'string' ? el.className : '').trim();
    var selector = buildSelector(el);

    // New: rich identification from agentation-ported functions
    var label = identifyElement(el);
    var nearbyText = getNearbyText(el);
    var accessibility = getAccessibilityInfo(el);

    var content = tag === 'img'
      ? (el.getAttribute('alt') || el.getAttribute('src') || 'image')
      : (el.textContent || '').trim().slice(0, 200);

    var elRect = el.getBoundingClientRect();

    window.parent.postMessage({
      type: 'pneuma:select',
      selection: {
        type: info.type,
        content: content,
        level: info.level,
        tag: tag,
        classes: classes,
        selector: selector,
        thumbnail: thumbnail,
        label: label,
        nearbyText: nearbyText,
        accessibility: accessibility,
        rect: { left: elRect.left, top: elRect.top, right: elRect.right, bottom: elRect.bottom, width: elRect.width, height: elRect.height }
      }
    }, '*');
  });
`;
