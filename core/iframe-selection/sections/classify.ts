/**
 * Classify section — classifyElement.
 * Determines the semantic type of an element (heading, paragraph, container, etc.).
 * ES5-compatible JavaScript injected into slide iframes.
 */
export const SECTION_CLASSIFY = `
  /** Classify element type */
  function classifyElement(el) {
    var tag = el.tagName.toLowerCase();
    var type = 'container';
    var level;
    if (/^h[1-6]$/.test(tag)) { type = 'heading'; level = parseInt(tag[1]); }
    else if (tag === 'p') type = 'paragraph';
    else if (tag === 'li') type = 'list';
    else if (tag === 'ul' || tag === 'ol') type = 'list';
    else if (tag === 'pre' || tag === 'code') type = 'code';
    else if (tag === 'blockquote') type = 'blockquote';
    else if (tag === 'img') type = 'image';
    else if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th') type = 'table';
    else if (tag === 'section' || tag === 'article' || tag === 'nav' || tag === 'aside' || tag === 'header' || tag === 'footer' || tag === 'main') type = 'section';
    else if (tag === 'a') type = 'link';
    else if (tag === 'button') type = 'interactive';
    else if (tag === 'figure' || tag === 'figcaption') type = 'container';
    return { type: type, level: level };
  }
`;
