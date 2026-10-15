/**
 * Message-handler section — postMessage listener, click/hover/mouseout handlers.
 * Wires up the selection interaction and message protocol.
 * ES5-compatible JavaScript injected into slide iframes.
 *
 * Depends on all other sections being loaded first (uses their functions).
 */
export const SECTION_MESSAGE_HANDLER = `
  var selectModeStyle = null;
  var selectionDocument = null;
  var selectionCaptureGeneration = 0;
  var pendingSelectionCapture = null;
  function cancelSelectionCapture() {
    selectionCaptureGeneration++;
    if (pendingSelectionCapture) pendingSelectionCapture.controller.abort();
    pendingSelectionCapture = null;
  }
  var selectionActive = false;
  var selectionTool = null;
  var commentEnabled = false;
  var commentLatched = false;
  var commentHeld = false;
  // Keyboard/parent evidence outlives inconsistent pointer modifier flags.
  // Pointer-only entry remains inferred, so an unmodified move can retire it.
  var commentExplicitHeld = false;
  var commentPointerHeld = false;
  var commentInhibited = false;
  var commentPointer = null;
  var suppressCommentClick = false;
  var navigationHighlight = null;
  var navigationHighlightTimer = null;
  var commentCursor = null;

  function clearCommentCursor() {
    if (commentCursor) commentCursor.remove();
    commentCursor = null;
  }
  function clearCommentPointer() { commentPointer = null; clearCommentCursor(); }
  function updateCommentCursor() {
    if (!commentPicking() || document.hidden || !commentPointer || editableEvent({ target: commentPointer.target }) ||
        commentPointer.x < 0 || commentPointer.y < 0 || commentPointer.x >= window.innerWidth || commentPointer.y >= window.innerHeight) {
      clearCommentCursor();
      return;
    }
    if (!commentCursor) {
      commentCursor = document.createElement('div');
      commentCursor.setAttribute('data-pneuma-comment-cursor', '');
      commentCursor.setAttribute('data-pneuma-overlay', 'true');
      commentCursor.setAttribute('data-pneuma-preview', '');
      commentCursor.setAttribute('aria-hidden', 'true');
      commentCursor.style.cssText = 'all:initial;position:fixed;width:25px;height:25px;pointer-events:none;z-index:2147483647;';
      commentCursor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" style="all:initial;display:block;width:25px;height:25px;pointer-events:none"><circle cx="12.5" cy="12.5" r="11.5" style="fill:#f97316;stroke:#09090b;stroke-width:2"/><path d="M8.5 12.5h8m-4-4v8" style="fill:none;stroke:#09090b;stroke-width:1.8;stroke-linecap:round"/></svg>';
      // Keep viewer chrome outside every selectable/captured content element.
      document.documentElement.appendChild(commentCursor);
    }
    // The native arrow remains at the hit point; the badge sits beside it.
    // Flip each axis independently when its preferred side would be clipped.
    var left = commentPointer.x + 32.5 > window.innerWidth ? commentPointer.x - 32.5 : commentPointer.x + 7.5;
    var top = commentPointer.y + 32.5 > window.innerHeight ? commentPointer.y - 32.5 : commentPointer.y + 7.5;
    commentCursor.style.left = Math.max(0, Math.min(window.innerWidth - 25, left)) + 'px';
    commentCursor.style.top = Math.max(0, Math.min(window.innerHeight - 25, top)) + 'px';
  }
  function rememberCommentPointer(e) {
    commentPointer = { target: e.target, x: e.clientX, y: e.clientY };
  }

  function commentPicking() { return commentEnabled && (commentLatched || commentHeld); }
  function editableEvent(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (node && node.nodeType === 1) {
        var editable = node.closest('[contenteditable]:not([contenteditable="false"])');
        if (node.matches('input,textarea,select,[role="textbox"]') || editable && !editable.hasAttribute(INLINE_EDIT_MARK)) return true;
      }
    }
    var focused = document.activeElement;
    return !!(focused && focused.nodeType === 1 && (focused.matches('input,textarea,select,[role="textbox"]') || focused.isContentEditable || focused.closest('[contenteditable]:not([contenteditable="false"])')));
  }
  function refreshSelectionMode() {
    var previous = active;
    if (hoverOverlay && (hoverOverlay.hasAttribute('data-pneuma-comment-hover') !== commentPicking())) clearHover();
    active = selectionActive || commentPicking();
    document.body.style.cursor = commentPicking() ? 'default' : active ? 'crosshair' : '';
    if (active) {
      if (!selectModeStyle) {
        selectModeStyle = document.createElement('style');
        selectModeStyle.setAttribute('data-pneuma-select-mode', '');
        document.head.appendChild(selectModeStyle);
      }
      selectModeStyle.textContent = '*, *::before, *::after { user-select: none !important; -webkit-user-select: none !important;' + (commentPicking() ? ' cursor: default !important;' : '') + '}';
      if (commentPointer) updateHoverAt(commentPointer.target);
    } else {
      if (selectModeStyle) { selectModeStyle.remove(); selectModeStyle = null; }
      clearHover();
      if (previous) clearSelected();
    }
    updateCommentCursor();
  }
  function setCommentHeld(pressed, inhibited) {
    if (inhibited !== undefined) commentInhibited = inhibited;
    var next = commentEnabled && !commentInhibited && !!pressed;
    if (next === commentHeld) return;
    commentHeld = next;
    refreshSelectionMode();
    window.parent.postMessage({ type: 'pneuma:commentShortcut', doc: selectionDocument, pressed: commentHeld }, '*');
  }
  function setCommentControl(pressed, inhibited) {
    commentExplicitHeld = commentEnabled && !!pressed;
    if (!pressed) commentPointerHeld = false;
    setCommentHeld(commentExplicitHeld || commentPointerHeld, inhibited);
  }
  function updateCommentPointer(e) {
    if (!commentEnabled) return;
    var eligible = !e.altKey && !e.metaKey && !e.shiftKey && !editableEvent(e);
    commentPointerHeld = !!e.ctrlKey && eligible;
    // A negative pointer flag is weaker evidence than a Control keydown.
    // Escape/chord inhibition ends at release, never on mouse movement.
    setCommentHeld(eligible && (commentExplicitHeld || commentPointerHeld));
    updateCommentCursor();
  }
  function resetCommentHeld() { setCommentControl(false, false); }
  function clearNavigationHighlight() {
    if (navigationHighlightTimer) clearTimeout(navigationHighlightTimer);
    if (navigationHighlight) navigationHighlight.remove();
    navigationHighlight = null; navigationHighlightTimer = null;
  }
  function showNavigationHighlight(selector, anchor) {
    clearNavigationHighlight();
    var element = null;
    try { element = typeof selector === 'string' ? document.querySelector(selector) : document.getElementById(String(anchor || '').replace(/^#/, '')); } catch (ignore) {}
    if (!element || element.closest('[data-pneuma-preview],[data-pneuma-overlay]')) return;
    navigationHighlight = createOverlayDiv(element.getBoundingClientRect(), true);
    navigationHighlight.setAttribute('data-pneuma-navigation-highlight', '');
    navigationHighlightTimer = setTimeout(clearNavigationHighlight, 1800);
  }

  window.addEventListener('message', function(e) {
    if (!e.data || e.source && e.source !== window.parent) return;
    if (e.data.type === 'pneuma:selectMode') {
      var nextDocument = typeof e.data.doc === 'string' ? e.data.doc : null;
      var nextTool = typeof e.data.tool === 'string' ? e.data.tool : null;
      var nextCommentEnabled = !!(e.data.commenting && e.data.commenting.enabled && nextDocument);
      if (selectionDocument !== nextDocument || pendingSelectionCapture && (pendingSelectionCapture.forComment
        ? !nextCommentEnabled || commentLatched && !e.data.commenting.active
        : !e.data.enabled || selectionTool !== nextTool)) cancelSelectionCapture();
      if (selectionDocument !== nextDocument) { clearCommentPointer(); resetCommentHeld(); clearNavigationHighlight(); }
      selectionDocument = nextDocument;
      selectionActive = !!e.data.enabled;
      selectionTool = nextTool;
      commentEnabled = !!(e.data.commenting && e.data.commenting.enabled && selectionDocument);
      commentLatched = commentEnabled && !!e.data.commenting.active;
      if (!commentEnabled) { clearCommentPointer(); resetCommentHeld(); }
      refreshSelectionMode();
    }
    if (e.data.type === 'pneuma:commentControl' && e.data.doc === selectionDocument) {
      if (e.data.inhibited) cancelSelectionCapture();
      setCommentControl(!!e.data.pressed, !!e.data.inhibited);
    }
    if (e.data.type === 'pneuma:navigationHighlight' && e.data.doc === selectionDocument) {
      showNavigationHighlight(e.data.selector, e.data.anchor);
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
      cancelSelectionCapture();
      clearSelected();
      // Also clear annotation overlays
      var annotOverlays = document.querySelectorAll('[data-pneuma-annotation-overlay]');
      for (var ci = 0; ci < annotOverlays.length; ci++) {
        annotOverlays[ci].remove();
      }
    }
  });

  // Keyboard events do not bubble out of an iframe. Listen even in view mode.
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { clearCommentPointer(); cancelSelectionCapture(); }
    if (commentEnabled) {
      if (e.key === 'Escape' && commentHeld) {
        setCommentControl(false, true);
        e.preventDefault();
        return;
      }
      if (e.key === 'Control') {
        if (!e.isComposing && !editableEvent(e) && !e.altKey && !e.metaKey && !e.shiftKey) setCommentControl(true);
      } else if (commentExplicitHeld || e.ctrlKey && commentHeld) setCommentControl(false, true);
    }
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      window.parent.postMessage({ type: 'pneuma:escapeKey' }, '*');
    }
    if (e.key === 'Alt') window.parent.postMessage({ type: 'pneuma:altKey', pressed: true }, '*');
  }, true);
  document.addEventListener('keyup', function(e) {
    if (e.key === 'Control' || !e.ctrlKey) resetCommentHeld();
    if (active && e.key === 'Alt') window.parent.postMessage({ type: 'pneuma:altKey', pressed: false }, '*');
  }, true);
  window.addEventListener('blur', function() { clearCommentPointer(); cancelSelectionCapture(); resetCommentHeld(); });
  window.addEventListener('pagehide', function() { clearCommentPointer(); cancelSelectionCapture(); resetCommentHeld(); clearNavigationHighlight(); });
  document.addEventListener('visibilitychange', function() { if (document.hidden) { clearCommentPointer(); cancelSelectionCapture(); resetCommentHeld(); } });
  document.addEventListener('focusin', function(e) { if (editableEvent(e)) setCommentControl(false, true); });

  function updateHoverAt(target) {
    if (!active) return;
    var el = findMeaningfulElement(target);
    if (!el) { clearHover(); return; }
    if (el === hovered) return;          // no change
    if (hovered && hovered !== el) clearHover();
    if (el === selectedEl) return;       // selected element doesn't also get a hover ring
    hovered = el;
    var rect = el.getBoundingClientRect();
    hoverOverlay = createOverlayDiv(rect, false);
    if (commentPicking()) { hoverOverlay.style.outline = '2px solid #f97316'; hoverOverlay.setAttribute('data-pneuma-comment-hover', ''); }
  }

  document.addEventListener('mouseover', function(e) {
    rememberCommentPointer(e);
    updateCommentPointer(e);
    updateHoverAt(e.target);
  });

  document.addEventListener('mouseout', function(e) {
    // Only clear when the cursor actually leaves every hoverable element
    // (relatedTarget is null). mouseout also fires when entering a child,
    // which we don't want to treat as "hover lost".
    if (!e.relatedTarget) { clearCommentPointer(); clearHover(); }
  });

  // While the mouse button is held down the browser emits mousemove but
  // suppresses mouseover on some platforms (the drag is treated as a
  // capture). Sample the element under the cursor on every mousemove to
  // keep the hover overlay tracking the drag live.
  document.addEventListener('mousemove', function(e) {
    rememberCommentPointer(e);
    updateCommentPointer(e);
    if (!active) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (target) updateHoverAt(target);
  });

  // Client coordinates stay fixed through page and nested-container scrolling.
  // Re-hit-test underneath the indicator so the hover ring follows the content.
  window.addEventListener('scroll', function() {
    if (!commentPicking() || !commentPointer) return;
    var target = document.elementFromPoint(commentPointer.x, commentPointer.y);
    if (target) { commentPointer.target = target; clearHover(); updateHoverAt(target); }
    updateCommentCursor();
  }, true);
  window.addEventListener('resize', updateCommentCursor);

  // Stop the browser from kicking off any drag / caret-move gesture on
  // mousedown; without this Chrome still initiates a text-range drag on
  // some elements even with user-select: none on the body.
  document.addEventListener('mousedown', function(e) {
    if (!active || editableEvent(e) && commentPicking()) return;
    e.preventDefault();
  });
  document.addEventListener('pointerdown', function(e) {
    suppressCommentClick = false;
    rememberCommentPointer(e);
    updateCommentPointer(e);
    if (!commentPicking() || e.button !== 0 || editableEvent(e)) return;
    suppressCommentClick = true;
    e.preventDefault(); e.stopImmediatePropagation();
    pickElement(e, true);
  }, true);
  document.addEventListener('contextmenu', function(e) {
    if (!suppressCommentClick) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', function(e) {
    if (suppressCommentClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressCommentClick = false; return; }
    if (!active || commentPicking()) return;
    e.preventDefault(); e.stopPropagation();
    pickElement(e, false);
  });
  function pickElement(e, forComment) {
    cancelSelectionCapture();
    var captureGeneration = selectionCaptureGeneration;
    var captureDocument = selectionDocument;
    var captureTool = selectionTool;
    var el = findMeaningfulElement(e.target);
    if (!el) {
      clearSelected();
      window.parent.postMessage({ type: 'pneuma:select', doc: captureDocument, tool: captureTool === null ? undefined : captureTool, intent: forComment ? 'comment' : undefined, selection: null }, '*');
      return;
    }

    // Remove hover overlay before thumbnail capture (no blue border in preview)
    clearHover();

    // Capture thumbnail with clean styles
    var captureController = new AbortController();
    pendingSelectionCapture = { controller: captureController, forComment: forComment };
    var thumbnail = captureElementThumbnail(el, captureController.signal);

    // A discussion pick must not replace the existing authoring selection.
    if (!forComment) applySelectedStyle(el);

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

    var payload = {
      type: 'pneuma:select',
      doc: captureDocument,
      tool: captureTool === null ? undefined : captureTool,
      intent: forComment ? 'comment' : undefined,
      selection: {
        type: info.type,
        content: content,
        level: info.level,
        tag: tag,
        classes: classes,
        selector: selector,
        thumbnail: null,
        label: label,
        nearbyText: nearbyText,
        accessibility: accessibility,
        rect: { left: elRect.left, top: elRect.top, right: elRect.right, bottom: elRect.bottom, width: elRect.width, height: elRect.height }
      }
    };
    function publishSelection(value) {
      if (captureController.signal.aborted || captureGeneration !== selectionCaptureGeneration || captureDocument !== selectionDocument || !document.documentElement.contains(el)) return;
      pendingSelectionCapture = null;
      payload.selection.thumbnail = value;
      window.parent.postMessage(payload, '*');
    }
    // Keep ordinary selection synchronous. A CORS image retry publishes once,
    // and cannot replace a newer pick or survive cancellation/document changes.
    if (thumbnail && typeof thumbnail.then === 'function') thumbnail.then(publishSelection, function() { publishSelection(null); });
    else publishSelection(thumbnail);
  }
`;
