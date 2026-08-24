/**
 * Reading a selection back into the source the draft is written in.
 *
 * Once the viewer typesets math, what a reader selects and what
 * `draft.md` holds stop being the same string. Drag across
 * `固定租户 t=(user_id,agent_id) 与 schema 坐标 (σ,v) 后`, and
 * `Selection.toString()` hands back KaTeX's glyphs, while the file says
 * `固定租户 $t = (\mathit{user\_id}, \mathit{agent\_id})$ 与 schema 坐标
 * $(\sigma, v)$ 后`. The span address is a byte range into the file, so a
 * lookup by the rendered text finds nothing and the whole point-at-a-sentence
 * interaction dies quietly on exactly the essays this mode is for.
 *
 * KaTeX keeps the way out inside its own output: every formula carries its
 * verbatim TeX in `<annotation encoding="application/x-tex">`, escapes and
 * all. So instead of asking the Selection for text, this module walks the
 * range itself — prose contributes its characters, a formula contributes its
 * annotation between dollar signs, and the formula's own subtree is skipped
 * so the rendered glyphs never reach the string.
 *
 * Markdown's own inline markup opens the identical gap with no math in
 * sight, and on this mode's demo draft it cost more sentences than math did:
 * the page shows `recipe_json.py` where the file wrote `` `recipe_json.py` ``,
 * 强调 where it wrote `**强调**`, and a link's text where it wrote
 * `[text](url)`. Those constructs are therefore walked the same way — the
 * element is read back as the markup that produced it, nested ones compose
 * (`**`code`**` is bold wrapping code), and the walk never has to guess what
 * kind of thing it is looking at, because the tag says so.
 *
 * Two rules that are decisions, not details:
 *
 *   - **A construct is included whole or not at all.** A range that stops in
 *     the middle of a fraction — or halfway through a code span — would
 *     otherwise produce a truncated string that is in no file anywhere.
 *     Snapping to the construct's edges gives an address that is real,
 *     slightly wider than the drag.
 *   - **The reconstruction is a search key, not the answer.** `remark-math`
 *     normalises what it hands KaTeX — `$ x $` arrives as `x`, a `$$` block
 *     arrives without its newlines, `$$a+b$$` inline arrives as inline math —
 *     and the DOM keeps no record of which markers the author chose: `**x**`
 *     and `__x__` render the same element, a code span forgets how many
 *     backticks fenced it, and a link's `href` cannot say whether the file
 *     said `[x](u)`, `[x][ref]`, `<u>` or nothing at all. So the rebuilt
 *     string is often *equivalent to* rather than *equal to* the source.
 *     `locateSegments` therefore matches segment by segment with tolerance
 *     for each of those, and the caller takes the quote from the file, never
 *     from this module's join.
 *
 * No DOM is touched at module scope and nothing here imports React or CSS:
 * the walk takes a `Range` it is given, so `bun test` can drive it with
 * happy-dom, and `locateSegments` is plain string work with no DOM at all.
 */

/** `.katex` is a rendered formula; `.katex-error` is one KaTeX gave up on. */
const FORMULA_SELECTOR = ".katex, .katex-error";

/** rehype-katex wraps display math in this before the `.katex` itself. */
const DISPLAY_SELECTOR = ".katex-display";

const ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';

/**
 * Every tag markdown reaches for when it renders inline markup away. `<b>`
 * and `<i>` are here for drafts that carry raw HTML; `<code>` earns its place
 * only outside `<pre>`, because a fenced block already prints what the file
 * holds and wrapping it in backticks would invent them.
 */
const INLINE_SELECTOR = "code, strong, b, em, i, a";

const CONSTRUCT_SELECTOR = `${FORMULA_SELECTOR}, ${INLINE_SELECTOR}`;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * `Range.START_TO_END` / `Range.END_TO_START`, spelled out rather than read
 * off the global: this module is imported under `bun test`, where `Range`
 * exists only on the happy-dom window.
 *
 * Their names read backwards. Per the DOM spec, `a.compareBoundaryPoints(how,
 * b)` compares a point of `a` with a point of `b`: `START_TO_END` is *a's end*
 * against *b's start*, `END_TO_START` is *a's start* against *b's end*.
 */
const START_TO_END = 1;
const END_TO_START = 3;

/**
 * One run of the reconstruction: prose as typed, or a construct as the markup
 * that made it. The wrapping kinds nest, because the markup does.
 */
export type SourceSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "math"; readonly tex: string; readonly display: boolean }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly SourceSegment[] }
  | { readonly kind: "em"; readonly children: readonly SourceSegment[] }
  | {
      readonly kind: "link";
      readonly children: readonly SourceSegment[];
      readonly href: string;
      readonly title: string;
    };

/**
 * The segments a range covers, in document order.
 *
 * Text nodes contribute only the part inside the range; a construct
 * contributes all of itself the moment the range touches it. A formula whose
 * TeX cannot be read contributes nothing at all — an invented body would
 * produce an address pointing at text nobody wrote, and a missing one merely
 * makes the lookup fail, which is the honest outcome.
 */
export function readRangeSegments(range: Range): SourceSegment[] {
  const segments: SourceSegment[] = [];
  const enclosing = closestConstruct(range.commonAncestorContainer);
  if (enclosing) {
    // The drag never left one construct, so the selection *is* that construct.
    visit(enclosing, null, segments);
    return normalizeSegments(segments);
  }
  visit(range.commonAncestorContainer, range, segments);
  return normalizeSegments(segments);
}

/**
 * Whether the range crossed anything the page did not print verbatim — the
 * caller's switch between the literal `Selection.toString()` path and this
 * module's reconstruction.
 */
export function segmentsHaveConstruct(
  segments: readonly SourceSegment[],
): boolean {
  return segments.some((segment) => segment.kind !== "text");
}

/**
 * The segments joined back into source form: `$tex$`, `$$tex$$`, prose as is.
 *
 * Adjacent text segments are joined with nothing, which is right inside a
 * paragraph (an inline element split the text node) and short of the blank
 * line when the range crossed a block boundary. That gap is `locateSegments`'
 * problem, not this function's — the exact join exists to be looked up
 * verbatim first, because in the common case (one paragraph, inline math) it
 * is character for character what the file holds.
 */
export function segmentsToSource(segments: readonly SourceSegment[]): string {
  return segments.map(segmentSource).join("");
}

/**
 * One segment as source. Where the DOM cannot say which spelling the author
 * used, this picks the common one and leaves the rest to `locateSegments`:
 * one backtick, asterisks over underscores, and a link written out inline.
 */
function segmentSource(segment: SourceSegment): string {
  switch (segment.kind) {
    case "text":
      return segment.text;
    case "math":
      return segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`;
    case "code":
      return `\`${segment.text}\``;
    case "strong":
      return `**${segmentsToSource(segment.children)}**`;
    case "em":
      return `*${segmentsToSource(segment.children)}*`;
    case "link": {
      const text = segmentsToSource(segment.children);
      if (!segment.href) return text;
      const target = segment.title
        ? `${segment.href} "${segment.title}"`
        : segment.href;
      return `[${text}](${target})`;
    }
  }
}

/**
 * Where these segments sit in the markdown, allowing for what `remark-math`
 * normalised away.
 *
 * The tolerances, each paid for by something observed in real output:
 *   - between two segments, any whitespace or none (`\n\n` before a display
 *     block; the space around inline math that markdown keeps but the walk
 *     splits on);
 *   - inside a segment, one run of whitespace matches another (a soft line
 *     break in the source reaches the DOM as a space);
 *   - one or two dollar signs on each side of a formula (`$$a+b$$` written
 *     inline is inline math whose annotation says `a+b`);
 *   - whitespace just inside the delimiters (`$ \mathbb{J} $` is handed to
 *     KaTeX as `\mathbb{J}`, and a `$$` block loses its newlines);
 *   - any number of backticks around a code span, and either marker pair
 *     around bold and italic, since the element remembers neither;
 *   - every shape a link can have been written in — inline, reference,
 *     autolink — matched whole, so the returned slice never stops halfway
 *     through a `(...)`.
 *
 * Everything else must match literally. The one form a link can take that
 * carries no markup at all — a bare URL that GFM linkified — is held back to
 * a second pass, so a word that merely reads like a link's text can never
 * shadow the real, delimited one further along in the file.
 *
 * A returned range is a real byte range in `markdown`; the caller slices the
 * file rather than trusting the rebuild.
 */
export function locateSegments(
  markdown: string,
  segments: readonly SourceSegment[],
  hintStart = 0,
): { start: number; end: number } | null {
  if (segments.length === 0) return null;
  const from = Math.max(0, Math.min(hintStart, markdown.length));
  const delimited = buildPattern(segments, false);
  const hit = search(markdown, delimited, from);
  if (hit) return hit;
  const permissive = buildPattern(segments, true);
  return permissive === delimited
    ? null
    : search(markdown, permissive, from);
}

function search(
  markdown: string,
  source: string,
  from: number,
): { start: number; end: number } | null {
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, "g");
  } catch {
    // A pattern this module built should always compile; if the engine
    // refuses it (length limits on an enormous selection), no match is the
    // answer, and the caller turns that into a null address.
    return null;
  }
  // A failed `exec` resets `lastIndex` to 0, so where the search began has to
  // be remembered separately — reading it back off the regex would silently
  // turn "no match after the hint" into "already searched from the start".
  pattern.lastIndex = from;
  let match = pattern.exec(markdown);
  if (!match && from !== 0) {
    pattern.lastIndex = 0;
    match = pattern.exec(markdown);
  }
  if (!match || !match[0]) return null;
  return { start: match.index, end: match.index + match[0].length };
}

// ── the walk ────────────────────────────────────────────────────────────────

/**
 * One walk, two modes. With a range, text is clipped to it and only children
 * it touches are followed; with `null` the whole subtree is read, which is
 * what "a construct comes along whole" means in code — the walk drops the
 * range the moment it steps inside one.
 */
function visit(node: Node, range: Range | null, out: SourceSegment[]): void {
  if (node.nodeType === TEXT_NODE) {
    const text = node as Text;
    out.push({ kind: "text", text: range ? clipText(text, range) : text.data });
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  const element = node as Element;
  if (element.matches(FORMULA_SELECTOR)) {
    pushFormula(out, element);
    return;
  }
  const inline = inlineKind(element);
  if (inline) {
    pushInline(out, element, inline);
    return;
  }
  for (const child of Array.from(element.childNodes)) {
    if (!range || intersects(range, child)) visit(child, range, out);
  }
}

/** Only the characters inside the range — the ends of a drag land mid-node. */
function clipText(node: Text, range: Range): string {
  const data = node.data;
  const from = node === range.startContainer ? range.startOffset : 0;
  const to = node === range.endContainer ? range.endOffset : data.length;
  return data.slice(Math.max(0, from), Math.max(0, to));
}

function pushFormula(out: SourceSegment[], element: Element): void {
  const tex = formulaTex(element);
  if (tex === null) return;
  out.push({ kind: "math", tex, display: isDisplay(element) });
}

/**
 * The TeX a formula was built from.
 *
 * A rendered formula keeps it in its MathML annotation. A formula KaTeX could
 * not parse has no MathML at all — rehype-katex falls back to a
 * `.katex-error` span holding the source it was given, which is the same
 * string, so it is read directly.
 */
function formulaTex(element: Element): string | null {
  if (element.classList.contains("katex-error")) return element.textContent ?? "";
  const annotation = element.querySelector(ANNOTATION_SELECTOR);
  return annotation ? annotation.textContent ?? "" : null;
}

function isDisplay(element: Element): boolean {
  return element.closest(DISPLAY_SELECTOR) !== null;
}

/** Which construct this element is, if it is one the source spells out. */
type InlineKind = "code" | "strong" | "em" | "link";

function inlineKind(element: Element): InlineKind | null {
  switch (element.tagName.toLowerCase()) {
    case "code":
      // A fenced block prints what the file holds; only a span is markup.
      return element.closest("pre") ? null : "code";
    case "strong":
    case "b":
      return "strong";
    case "em":
    case "i":
      return "em";
    case "a":
      return "link";
    default:
      return null;
  }
}

function pushInline(
  out: SourceSegment[],
  element: Element,
  kind: InlineKind,
): void {
  if (kind === "code") {
    // A code span's content is literal by definition — nothing inside it can
    // be another construct, so its text is the whole story.
    out.push({ kind: "code", text: element.textContent ?? "" });
    return;
  }
  const inner: SourceSegment[] = [];
  for (const child of Array.from(element.childNodes)) visit(child, null, inner);
  const children = inner.filter(
    (segment) => segment.kind !== "text" || segment.text.length > 0,
  );
  if (kind === "link") {
    // `getAttribute`, not `href`: the property resolves `./x.md` against the
    // page, and the file wrote the relative form.
    out.push({
      kind: "link",
      children,
      href: element.getAttribute("href") ?? "",
      title: element.getAttribute("title") ?? "",
    });
    return;
  }
  out.push(
    kind === "strong" ? { kind: "strong", children } : { kind: "em", children },
  );
}

/**
 * The construct a drag never left, if there is one.
 *
 * `closest` stops at the first tag that *looks* like a construct, which for a
 * fenced block is its `<code>` — not one, so the search continues outward
 * from there rather than reporting a code span the file does not contain.
 */
function closestConstruct(node: Node): Element | null {
  let from =
    node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (from) {
    const candidate = from.closest(CONSTRUCT_SELECTOR);
    if (!candidate) return null;
    if (candidate.matches(FORMULA_SELECTOR) || inlineKind(candidate)) {
      return candidate;
    }
    from = candidate.parentElement;
  }
  return null;
}

/** Does the range overlap this node at all? Touching at a point does not. */
function intersects(range: Range, node: Node): boolean {
  const doc = node.ownerDocument;
  const parent = node.parentNode;
  if (!doc || !parent) return false;
  const nodeRange = doc.createRange();
  nodeRange.selectNode(node);
  const startsBeforeNodeEnds =
    range.compareBoundaryPoints(END_TO_START, nodeRange) < 0;
  const endsAfterNodeStarts =
    range.compareBoundaryPoints(START_TO_END, nodeRange) > 0;
  return startsBeforeNodeEnds && endsAfterNodeStarts;
}

// ── shaping the segment list ────────────────────────────────────────────────

/**
 * Drop the empty text runs a clipped walk leaves behind, and trim the outer
 * edges so a drag that overshot into surrounding whitespace still addresses
 * the sentence. Interior text segments are deliberately left unmerged: the
 * seam between two of them is where a block boundary hides, and
 * `locateSegments` glues each seam with optional whitespace.
 */
function normalizeSegments(segments: SourceSegment[]): SourceSegment[] {
  const kept = segments.filter(
    (segment) => segment.kind !== "text" || segment.text.length > 0,
  );
  const first = kept[0];
  if (first?.kind === "text") {
    const trimmed = first.text.replace(/^\s+/, "");
    if (trimmed) kept[0] = { kind: "text", text: trimmed };
    else kept.shift();
  }
  const last = kept[kept.length - 1];
  if (last?.kind === "text") {
    const trimmed = last.text.replace(/\s+$/, "");
    if (trimmed) kept[kept.length - 1] = { kind: "text", text: trimmed };
    else kept.pop();
  }
  return kept;
}

// ── the tolerant pattern ────────────────────────────────────────────────────

/** One or two dollar signs, preferring two where the source wrote two. */
const DOLLARS = "\\$\\$?";

/** However many the author needed to fence a backtick of their own. */
const BACKTICKS = "`+";

/** Both spellings of each emphasis, so the element need not remember. */
const STRONG_MARKERS = ["\\*\\*", "__"];
const EM_MARKERS = ["\\*", "_"];

/**
 * A link target, up to one level of nested parentheses — `X_(dis)` inside a
 * URL is ordinary, and stopping at the first `)` would return a slice with an
 * unclosed bracket. The alternation's two branches start on disjoint
 * characters, so this stays linear.
 */
const LINK_TARGET = "(?:[^()]|\\([^()]*\\))*";

function buildPattern(
  segments: readonly SourceSegment[],
  permissive: boolean,
): string {
  return segments
    .map((segment) => segmentPattern(segment, permissive))
    .join("\\s*");
}

function segmentPattern(segment: SourceSegment, permissive: boolean): string {
  switch (segment.kind) {
    case "text":
      return literal(segment.text);
    case "math":
      return `${DOLLARS}\\s*${literal(segment.tex)}\\s*${DOLLARS}`;
    case "code":
      return `${BACKTICKS}\\s*${literal(segment.text)}\\s*${BACKTICKS}`;
    case "strong":
      return paired(buildPattern(segment.children, permissive), STRONG_MARKERS);
    case "em":
      return paired(buildPattern(segment.children, permissive), EM_MARKERS);
    case "link":
      return linkPattern(
        buildPattern(segment.children, permissive),
        permissive && isBareLink(segment),
      );
  }
}

/**
 * Whether this link could be in the file with no markup around it at all.
 *
 * That happens exactly when GFM linkified something the author simply typed
 * — a URL, a `www.` host, an email — and it shows in the DOM as an `href`
 * that is the text back again. Every other link was written with brackets or
 * angles, so letting *those* match their bare text would only give a word
 * that reads the same a chance to win the search.
 */
function isBareLink(segment: {
  readonly children: readonly SourceSegment[];
  readonly href: string;
}): boolean {
  if (!segment.href) return true;
  const text = segmentsToSource(segment.children);
  return (
    segment.href === text
    || segment.href === `http://${text}`
    || segment.href === `https://${text}`
    || segment.href === `mailto:${text}`
  );
}

/**
 * Emphasis, with its markers kept in pairs: `*x*` or `_x_`, never `*x_`,
 * which is not emphasis in any markdown and would be a byte range over a
 * string the renderer never made.
 */
function paired(inner: string, markers: readonly string[]): string {
  return `(?:${markers.map((marker) => `${marker}${inner}${marker}`).join("|")})`;
}

/**
 * Every shape a link can have in the file. The DOM gives back a resolved
 * `href` and nothing about how it was written, so all of them are tried, and
 * each consumes the construct whole — the returned slice never stops halfway
 * through a `(...)`. The bare form is held back to the permissive pass, and
 * even there only for links that could have been written bare.
 */
function linkPattern(text: string, bare: boolean): string {
  const forms = [
    `\\[${text}\\]\\(${LINK_TARGET}\\)`,
    `\\[${text}\\]\\[[^\\]]*\\]`,
    `<${text}>`,
    `\\[${text}\\]`,
  ];
  if (bare) forms.push(text);
  return `(?:${forms.join("|")})`;
}

/**
 * A literal run, with every whitespace run left free to be any other.
 * Escaping first is safe: it never introduces whitespace, so the second pass
 * only ever rewrites whitespace the source segment actually contained.
 */
function literal(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}
