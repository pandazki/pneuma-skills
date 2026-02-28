/**
 * Layout overflow detection script.
 *
 * Run this in the slide's iframe context (via chrome-devtools MCP evaluate_script
 * or browser console) to check if content overflows the 1280×720 viewport.
 *
 * Returns: { overflow: boolean, details: string }
 *
 * Usage with chrome-devtools MCP:
 *   1. Navigate to the slide (or use the export page)
 *   2. evaluate_script with this function
 *   3. If overflow is true, fix the slide and re-check
 */
(() => {
  const results = [];
  const viewportW = window.innerWidth || document.documentElement.clientWidth;
  const viewportH = window.innerHeight || document.documentElement.clientHeight;

  // Check if the main content container overflows the viewport
  const bodyChildren = Array.from(document.body.children);
  const nonAbsoluteChildren = bodyChildren.filter(child => {
    const position = window.getComputedStyle(child).position;
    return position !== 'absolute' && position !== 'fixed';
  });

  for (const el of nonAbsoluteChildren) {
    const rect = el.getBoundingClientRect();

    // Check viewport overflow
    if (rect.right > viewportW + 1 || rect.bottom > viewportH + 1) {
      results.push(
        `Element <${el.tagName.toLowerCase()}> overflows viewport: ` +
        `right=${Math.round(rect.right)}px (max ${viewportW}px), ` +
        `bottom=${Math.round(rect.bottom)}px (max ${viewportH}px)`
      );
    }

    // Check child overflow within this container
    for (const child of el.children) {
      const childRect = child.getBoundingClientRect();
      const parentRect = rect;

      if (
        childRect.right > parentRect.right + 1 ||
        childRect.bottom > parentRect.bottom + 1
      ) {
        const childTag = child.tagName.toLowerCase();
        const childClass = child.className ? `.${child.className.split(' ')[0]}` : '';
        results.push(
          `Child <${childTag}${childClass}> overflows parent: ` +
          `bottom=${Math.round(childRect.bottom)}px (parent bottom=${Math.round(parentRect.bottom)}px)`
        );
      }
    }
  }

  return {
    overflow: results.length > 0,
    details: results.length > 0
      ? results.join('\n')
      : 'No overflow detected. Layout is clean.'
  };
})()
