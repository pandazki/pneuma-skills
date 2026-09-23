/**
 * source-edit — apply a text edit made in the preview to the page's SOURCE.
 *
 * Edit mode lets the user retype text in the rendered page. The rendered page
 * is not the source: the site's scripts have built parts of it (table rows,
 * prices, tab panels), removed or reordered others, and the viewer has added
 * its own tools. Saving the rendered `<body>` back — what this replaced —
 * wrote all of that into the file: it deleted authored `<script>` tags,
 * froze generated markup into the source, and, because the body was spliced
 * in with a `String.replace` template, turned rendered prices such as `$3.73`
 * into regex back-references that duplicated the page.
 *
 * An edit instead carries a handle the source can verify (see `TextEdit`).
 * The source element must hold the text the user started from, and:
 *
 * - an element with an `id` is the source element with that id, which must be
 *   unique;
 * - otherwise the page and the source must hold the same number of elements
 *   with that tag and text in the element's scope (its nearest ancestor with
 *   an id, or `<body>`) — a script that added or removed look-alikes makes
 *   every correspondence a guess — and exactly one of the source's look-alikes
 *   must fit the element's identity chain, the element and each ancestor up to
 *   the scope, tried in order of strength:
 *     1. tag and authored attributes at every level (a script may add classes
 *        and attributes, not change or remove them) — `data-product="pro"` on
 *        an ancestor tells two cards apart wherever the script moved them;
 *     2. the text of the siblings at every level, as a set — the heading next
 *        to the edited paragraph travels with its card when cards reorder;
 *     3. the order of those siblings at every level — position — but ONLY
 *        on a page without scripts (no `<script>`, no `on…` handler
 *        attributes), whose rendered DOM is its source DOM: nothing there can
 *        have moved an element. A page with scripts cannot prove its order
 *        was kept (two identical cards swapped by a script look exactly like
 *        two that were not), so look-alikes that attributes and text do not
 *        tell apart are refused there.
 *
 * Only the matched element's inner range of the source text is replaced, and
 * the result is accepted only if it parses to exactly the DOM of the source
 * with that one element changed. Anything else leaves the file untouched and
 * says why.
 */

/** A sibling as the identity chain sees it: its tag and (normalized) text. */
export type SiblingSig = [tag: string, text: string];

/** One step of the identity chain: the element itself, then each ancestor up to the scope. */
export interface ChainLevel {
  tag: string;
  /** Attributes as rendered (no `style`, no `contenteditable`). */
  attrs: Record<string, string>;
  /** Element siblings before / after, nearest last / first; the viewer's own nodes left out. */
  prev: SiblingSig[];
  next: SiblingSig[];
}

/** One text edit, as the in-page edit script reports it. */
export interface TextEdit {
  /** Lower-case tag name of the edited element. */
  tag: string;
  /** The element's inner HTML when editing began (viewer attributes removed). */
  before: string;
  /** Its inner HTML when editing ended. */
  after: string;
  /** The element's own `id`, when it has one. */
  id?: string;
  /** `id` of the nearest ancestor that has one; absent means `<body>`. */
  scope?: string;
  /** The identity chain, from the element (index 0) up to, not including, the scope. */
  chain?: ChainLevel[];
  /** Elements in the scope, the element included, with this tag and `before`. */
  twins?: number;
  /** Plain text before / after, for the activity log only. */
  beforeText?: string;
  afterText?: string;
}

/**
 * Describe an element being edited in the preview as a `TextEdit` handle.
 *
 * Runs INSIDE the preview page: the edit script embeds this function's source
 * (`describeEditSource`), so it must stay self-contained — no imports, no
 * helpers outside its body, ES2015 only. `clean` returns an element's inner
 * HTML with the viewer's own attributes and nodes removed, as authored.
 */
export function describeEdit(
  el: Element,
  before: string,
  after: string,
  clean: (e: Element) => string,
): TextEdit {
  const viewerNode = (n: Element) => n.hasAttribute("data-pneuma-preview") || n.hasAttribute("data-pneuma-overlay");
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  const attrsOf = (n: Element) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      const name = a.name.toLowerCase();
      if (name !== "style" && name !== "contenteditable") out[name] = a.value;
    }
    return out;
  };
  // Must match `siblingSig` in the source-side matcher.
  const sig = (n: Element): [string, string] => [
    n.tagName.toLowerCase(),
    (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
  ];
  let scopeEl: Element | null = null;
  for (let a = el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
    if (a.id) { scopeEl = a; break; }
  }
  const root: Element = scopeEl || doc.body;
  const chain: ChainLevel[] = [];
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    const prev: [string, string][] = [];
    const next: [string, string][] = [];
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (!viewerNode(s)) prev.unshift(sig(s));
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (!viewerNode(s)) next.push(sig(s));
    chain.push({ tag: n.tagName.toLowerCase(), attrs: attrsOf(n), prev, next });
  }
  let twins = 1; // the edited element, which now holds `after`
  const same = root.querySelectorAll(tag);
  for (let i = 0; i < same.length; i++) {
    if (same[i] !== el && !viewerNode(same[i]) && clean(same[i]) === before) twins++;
  }
  const text = (html: string) => {
    const t = doc.createElement("template");
    t.innerHTML = html;
    return (t.content.textContent || "").trim();
  };
  const edit: TextEdit = { tag, before, after, chain, twins, beforeText: text(before), afterText: text(after) };
  if (el.id) edit.id = el.id;
  if (scopeEl) edit.scope = scopeEl.id;
  return edit;
}

/** `describeEdit` as source text, for the in-page edit script. */
export const describeEditSource = describeEdit.toString();

export type EditResult = { ok: true; html: string } | { ok: false; reason: string };

type Parse = (html: string) => Document;

/** Elements whose content the tokenizer must skip without looking for tags. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe", "noembed", "noframes"]);

/**
 * Inner ranges `[start, end)` of every `<tag>` element in `src`, in the order
 * their start tags appear. `end` is -1 when no matching end tag was found (an
 * omitted end tag — the caller treats that as "cannot splice").
 */
export function innerRanges(src: string, tag: string): { start: number; end: number }[] {
  const want = tag.toLowerCase();
  const out: { start: number; end: number }[] = [];
  const open: number[] = []; // indexes into `out` of unclosed `want` elements
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (src.startsWith("<!--", lt)) {
      const endC = src.indexOf("-->", lt + 4);
      i = endC < 0 ? n : endC + 3;
      continue;
    }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") {
      const gt = src.indexOf(">", lt);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    const closing = src[lt + 1] === "/";
    const nameStart = lt + (closing ? 2 : 1);
    const m = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(src.slice(nameStart, nameStart + 64));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[0].toLowerCase();
    // Find the end of the tag, honoring quoted attribute values.
    let j = nameStart + m[0].length;
    let quote: string | null = null;
    for (; j < n; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
    }
    if (j >= n) break;
    const tagEnd = j + 1;
    if (closing) {
      if (name === want && open.length) out[open.pop()!].end = lt;
      i = tagEnd;
      continue;
    }
    const selfClosing = src[j - 1] === "/";
    if (name === want && !selfClosing) {
      out.push({ start: tagEnd, end: -1 });
      open.push(out.length - 1);
    }
    if (RAW_TEXT.has(name) && !selfClosing) {
      const close = src.toLowerCase().indexOf(`</${name}`, tagEnd);
      if (close < 0) break;
      if (name === want) out[open.pop()!].end = close;
      i = close;
      continue;
    }
    i = tagEnd;
  }
  return out;
}

/** Inner HTML as a fresh parse of it serializes — the form both sides compare. */
function normalizeInner(parse: Parse, html: string): string {
  const doc = parse(`<!DOCTYPE html><html><body><template>${html}</template></body></html>`);
  const t = doc.querySelector("template") as HTMLTemplateElement | null;
  return t ? t.innerHTML : html;
}

function serialize(doc: Document): string {
  return doc.documentElement.outerHTML;
}

const SKIP_ATTRS = new Set(["style", "contenteditable"]);

/**
 * Whether a source element's authored attributes survive on the rendered one.
 * Scripts routinely ADD classes and attributes (reveal states, aria-expanded),
 * so extra runtime attributes and classes are fine; a changed or missing one
 * means this is not the same element as authored.
 */
function attributesCompatible(source: Element, runtime: Record<string, string> | undefined): boolean {
  if (!runtime) return true;
  for (const attr of Array.from(source.attributes)) {
    const name = attr.name.toLowerCase();
    if (SKIP_ATTRS.has(name)) continue;
    const value = runtime[name];
    if (value === undefined) return false;
    if (name === "class") {
      const have = new Set(value.split(/\s+/).filter(Boolean));
      if (!attr.value.split(/\s+/).filter(Boolean).every((c) => have.has(c))) return false;
    } else if (value !== attr.value) {
      return false;
    }
  }
  return true;
}

function byId(doc: Document, id: string): Element[] {
  return Array.from(doc.querySelectorAll("[id]")).filter((el) => el.id === id);
}

/** A source sibling as the in-page `describeEdit` records it. */
function siblingSig(n: Element): SiblingSig {
  return [n.tagName.toLowerCase(), (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)];
}

const sigKey = (s: SiblingSig) => `${s[0]}\u0000${s[1]}`;

/** Every item of `sub` appears in `seq`, in the same order (others may be interleaved). */
function isSubsequence(sub: readonly SiblingSig[], seq: readonly SiblingSig[]): boolean {
  let j = 0;
  for (const item of seq) if (j < sub.length && sigKey(item) === sigKey(sub[j])) j++;
  return j === sub.length;
}

/** Every item of `sub` appears in `set` at least as often (order ignored). */
function isSubMultiset(sub: readonly SiblingSig[], set: readonly SiblingSig[]): boolean {
  const have = new Map<string, number>();
  for (const s of set) have.set(sigKey(s), (have.get(sigKey(s)) ?? 0) + 1);
  for (const s of sub) {
    const n = have.get(sigKey(s)) ?? 0;
    if (n === 0) return false;
    have.set(sigKey(s), n - 1);
  }
  return true;
}

type ChainTest = "attributes" | "sibling-text" | "sibling-order";

/** Whether the source can change its own DOM: any `<script>` or inline `on…` handler. */
function hasScripts(doc: Document): boolean {
  if (doc.querySelector("script")) return true;
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name)) return true;
  }
  return false;
}

/** Whether source element `el` fits the runtime identity chain under `test` (each includes the previous). */
function fitsChain(el: Element, scope: Element, chain: readonly ChainLevel[], test: ChainTest): boolean {
  let n: Element | null = el;
  for (const level of chain) {
    if (!n || n === scope) return false;
    if (n.tagName.toLowerCase() !== level.tag || !attributesCompatible(n, level.attrs)) return false;
    if (test !== "attributes") {
      const prev: SiblingSig[] = [];
      const next: SiblingSig[] = [];
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) prev.unshift(siblingSig(s));
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) next.push(siblingSig(s));
      if (!isSubMultiset([...prev, ...next], [...level.prev, ...level.next])) return false;
      if (test === "sibling-order" && !(isSubsequence(prev, level.prev) && isSubsequence(next, level.next))) return false;
    }
    n = n.parentElement;
  }
  return n === scope;
}

type Located = { ok: true; el: Element } | { ok: false; reason: string };

/** Find the source element an edit was made on, or say why it cannot be told. */
function locate(doc: Document, edit: TextEdit, tag: string, before: string): Located {
  const notInSource: Located = {
    ok: false,
    reason: `the edited <${tag}> is not in the page's source as shown (the page's own script may have built or changed it)`,
  };
  const sameText = (el: Element) => el.tagName.toLowerCase() === tag && el.innerHTML === before;

  if (edit.id) {
    const found = byId(doc, edit.id);
    if (found.length !== 1) {
      return found.length === 0
        ? notInSource
        : { ok: false, reason: `the page's source has ${found.length} elements with id "${edit.id}", so the edited one cannot be told apart` };
    }
    return sameText(found[0]) ? { ok: true, el: found[0] } : notInSource;
  }

  let scope: Element | null = doc.body;
  if (edit.scope) {
    const found = byId(doc, edit.scope);
    if (found.length !== 1) {
      return { ok: false, reason: `the edited <${tag}> sits inside #${edit.scope}, which the page's source does not have exactly once` };
    }
    scope = found[0];
  }
  if (!scope) return notInSource;

  const twins = Array.from(scope.querySelectorAll(tag)).filter(sameText);
  if (twins.length === 0) return notInSource;
  if (edit.twins !== undefined && edit.twins !== twins.length) {
    return {
      ok: false,
      reason: `the page shows ${edit.twins} <${tag}> element(s) with this text where its source has ${twins.length} (its script added or removed some), so the edited one cannot be matched to the source`,
    };
  }
  const chain = edit.chain ?? [];
  // Position is evidence only where nothing can have moved an element.
  const tests: ChainTest[] = hasScripts(doc) ? ["attributes", "sibling-text"] : ["attributes", "sibling-text", "sibling-order"];
  let fit = twins;
  for (const test of tests) {
    fit = fit.filter((el) => fitsChain(el, scope!, chain, test));
    if (fit.length === 1) return { ok: true, el: fit[0] };
    if (fit.length === 0) {
      return test === "attributes"
        ? { ok: false, reason: `the edited <${tag}> and its surroundings no longer match its source (the page's script changed them)` }
        : { ok: false, reason: `the page's script moved or changed the matching <${tag}> elements and their surroundings, so which one was edited cannot be told from the source` };
    }
  }
  return {
    ok: false,
    reason: `the page has ${fit.length} identical <${tag}> elements with this text that nothing but their position tells apart, and its script may have moved them, so the edited one cannot be told from the source`,
  };
}

/** Apply one edit; see the module comment for the contract. */
export function applyTextEdit(source: string, edit: TextEdit, parse: Parse): EditResult {
  const tag = edit.tag.toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return { ok: false, reason: `not an element name: ${edit.tag}` };
  const doc = parse(source);
  const before = normalizeInner(parse, edit.before);
  const found = locate(doc, edit, tag, before);
  if (!found.ok) return found;
  const target = found.el;
  const all = Array.from(doc.querySelectorAll(tag));
  const ordinal = all.indexOf(target);
  target.innerHTML = edit.after;
  const expected = serialize(doc);

  const ranges = innerRanges(source, tag);
  const range = ranges.length === all.length ? ranges[ordinal] : undefined;
  if (range && range.end >= range.start) {
    const spliced = source.slice(0, range.start) + edit.after + source.slice(range.end);
    if (serialize(parse(spliced)) === expected) return { ok: true, html: spliced };
  }
  return {
    ok: false,
    reason: `could not locate the edited <${tag}> in the source text exactly (an omitted end tag or unusual markup); the file was left unchanged`,
  };
}

/** Apply edits in order; stops at the first one that cannot be applied. */
export function applyTextEdits(
  source: string,
  edits: readonly TextEdit[],
  parse: Parse,
): { html: string; applied: number; failure?: { edit: TextEdit; reason: string } } {
  let html = source;
  let applied = 0;
  for (const edit of edits) {
    if (edit.before === edit.after) continue;
    const r = applyTextEdit(html, edit, parse);
    if (!r.ok) return { html, applied, failure: { edit, reason: r.reason } };
    html = r.html;
    applied++;
  }
  return { html, applied };
}
