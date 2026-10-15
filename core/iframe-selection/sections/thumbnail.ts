import { COMMENT_PREVIEW_LIMITS } from "../../collaboration/comment-preview.js";

/**
 * Thumbnail section — captureElementThumbnail.
 * Captures image pixels directly; other selections retain their SVG foreignObject preview.
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_THUMBNAIL = `
  /** A small raster contains its own pixels, unlike an img URL inside an SVG. */
  function rasterImageThumbnail(image) {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
    try {
      var scale = Math.min(1, 320 / image.naturalWidth, 192 / image.naturalHeight);
      var canvas = document.createElement('canvas');
      for (var attempt = 0; attempt < 3; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        var context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var png = canvas.toDataURL('image/png');
        if (png.indexOf('data:image/png;base64,') === 0 && png.length <= ${COMMENT_PREVIEW_LIMITS.thumbnail}) return png;
        var webp = canvas.toDataURL('image/webp', 0.8);
        if (webp.indexOf('data:image/webp;base64,') === 0 && webp.length <= ${COMMENT_PREVIEW_LIMITS.thumbnail}) return webp;
        scale *= 0.5;
      }
    } catch (ignore) { /* An opaque/non-CORS image taints its canvas. */ }
    return null;
  }

  function captureImageThumbnail(image, signal) {
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight || signal && signal.aborted) return null;
    var immediate = rasterImageThumbnail(image);
    if (immediate) return immediate;
    // Published pages have opaque origins. Reload only the already displayed
    // URL with anonymous CORS; the existing asset grant must permit readback.
    var source = image.currentSrc || image.src;
    if (!source) return null;
    return new Promise(function(resolve) {
      var cleanImage = new Image();
      var settled = false;
      var timer = setTimeout(function() { finish(null); }, 2500);
      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanImage.onload = null;
        cleanImage.onerror = null;
        if (signal) signal.removeEventListener('abort', abort);
        if (!value) cleanImage.src = '';
        resolve(value);
      }
      function abort() { finish(null); }
      cleanImage.onload = function() { finish(rasterImageThumbnail(cleanImage)); };
      cleanImage.onerror = function() { finish(null); };
      cleanImage.crossOrigin = 'anonymous';
      if (signal) signal.addEventListener('abort', abort, { once: true });
      cleanImage.src = source;
    });
  }

  /** String/null normally; only an image needing clean CORS readback is async. */
  function captureElementThumbnail(el, signal) {
    try {
      var tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'picture') return captureImageThumbnail(tag === 'img' ? el : el.querySelector('img'), signal);
      var elRect = el.getBoundingClientRect();
      var elW = Math.ceil(elRect.width);
      var elH = Math.ceil(elRect.height);
      if (elW <= 0 || elH <= 0) return null;

      // Clone the element
      var clone = el.cloneNode(true);
      // Remove scripts from clone
      var scripts = clone.querySelectorAll('script');
      for (var s = 0; s < scripts.length; s++) scripts[s].remove();

      // Measure actual content size by rendering clone off-screen in the iframe
      // Use position:fixed to avoid expanding scrollable area (prevents scroll flash)
      var measure = document.createElement('div');
      measure.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:fit-content;max-width:' + elW + 'px;pointer-events:none;visibility:hidden;';
      measure.appendChild(clone);
      document.body.appendChild(measure);
      var fitRect = clone.getBoundingClientRect();
      var fitW = Math.ceil(fitRect.width) || elW;
      var fitH = Math.ceil(fitRect.height) || elH;
      document.body.removeChild(measure);

      // Collect all CSS rules
      var cssText = '';
      try {
        var sheets = document.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
          try {
            var rules = sheets[i].cssRules;
            for (var j = 0; j < rules.length; j++) {
              cssText += rules[j].cssText + '\\n';
            }
          } catch(ex) { /* cross-origin */ }
        }
      } catch(ex) {}

      // Reset clone's margin so it renders at (0,0) in the standalone SVG context
      // (the original element may have margin/position from its parent layout)
      clone.style.margin = '0';
      if (clone.style.position === 'absolute' || clone.style.position === 'fixed') {
        clone.style.position = 'relative';
      }
      clone.style.top = '0';
      clone.style.left = '0';

      // Serialize clone directly in iframe context (preserves SVG namespaces)
      var cloneHtml = new XMLSerializer().serializeToString(clone);

      // Escape CSS for XHTML CDATA
      var safeCss = cssText.replace(/]]>/g, ']]]]><![CDATA[>');
      var sizeCSS = 'html,body{margin:0;padding:0;overflow:hidden;width:' + fitW + 'px;height:' + fitH + 'px;}';

      var xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><head>'
        + '<style><![CDATA[' + safeCss + ']]></style>'
        + '<style>' + sizeCSS + '</style>'
        + '</head><body>' + cloneHtml + '</body></html>';

      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + fitW + '" height="' + fitH + '">' +
        '<foreignObject width="' + fitW + '" height="' + fitH + '">' + xhtml + '</foreignObject></svg>';
      var encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

      // Skip if too large (> 200KB)
      if (encoded.length > 200 * 1024) return null;
      return encoded;
    } catch(ex) {
      return null;
    }
  }
`;
