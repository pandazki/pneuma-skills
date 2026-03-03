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
      // Clear previous annotation overlays
      var prevOverlays = document.querySelectorAll('[data-pneuma-annotation-overlay]');
      for (var pi = 0; pi < prevOverlays.length; pi++) {
        prevOverlays[pi].remove();
      }
      // Create overlay for each selector
      var selectors = e.data.selectors || [];
      for (var ai = 0; ai < selectors.length; ai++) {
        try {
          var ael = document.querySelector(selectors[ai]);
          if (ael) {
            var arect = ael.getBoundingClientRect();
            var adiv = createOverlayDiv(arect, true);
            adiv.setAttribute('data-pneuma-annotation-overlay', 'true');
            adiv.removeAttribute('data-pneuma-overlay');
          }
        } catch(ex) {}
      }
    }
    if (e.data.type === 'pneuma:clearHighlight') {
      clearSelected();
      // Also clear annotation overlays
      var annotOverlays = document.querySelectorAll('[data-pneuma-annotation-overlay]');
      for (var ci = 0; ci < annotOverlays.length; ci++) {
        annotOverlays[ci].remove();
      }
    }
  });

  // Forward keyboard events from iframe to parent (iframe events don't bubble)
  document.addEventListener('keydown', function(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      window.parent.postMessage({ type: 'pneuma:escapeKey' }, '*');
    }
    if (e.key === 'Alt') {
      window.parent.postMessage({ type: 'pneuma:altKey', pressed: true }, '*');
    }
  });

  document.addEventListener('keyup', function(e) {
    if (!active) return;
    if (e.key === 'Alt') {
      window.parent.postMessage({ type: 'pneuma:altKey', pressed: false }, '*');
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!active) return;
    var el = findMeaningfulElement(e.target);
    if (!el) return;
    if (hovered && hovered !== el) clearHover();
    if (el === selectedEl) return;
    hovered = el;
    var rect = el.getBoundingClientRect();
    hoverOverlay = createOverlayDiv(rect, false);
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

    // Remove hover overlay before thumbnail capture (no blue border in preview)
    clearHover();

    // Capture thumbnail with clean styles
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
