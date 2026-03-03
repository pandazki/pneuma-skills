/**
 * Thumbnail section — captureElementThumbnail.
 * Captures an SVG thumbnail of a selected element using foreignObject.
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_THUMBNAIL = `
  /** Capture an SVG thumbnail of an element using foreignObject */
  function captureElementThumbnail(el) {
    try {
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
